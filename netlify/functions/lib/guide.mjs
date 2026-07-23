import { HttpError } from './http.mjs';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './openrouter.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const GUIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    medicines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          strength: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          function: { type: 'string' },
          directions: { type: 'string' },
          sideEffects: { type: 'string' },
          uncertainty: { type: 'string' },
        },
        required: ['name', 'strength', 'confidence', 'function', 'directions', 'sideEffects', 'uncertainty'],
      },
    },
    notes: { type: 'string' },
    disclaimer: { type: 'string' },
  },
  required: ['medicines', 'notes', 'disclaimer'],
};

function guidePrompt(language) {
  return `Read this prescription image, regardless of the language printed on it, and create a medicine guide in ${language}.

Safety rules:
- Transcribe only what is actually visible. Never invent a medicine name, strength, dose, frequency, duration, or route.
- If handwriting or text is ambiguous, preserve that uncertainty, set confidence to medium/low, and say exactly what must be verified.
- "directions" must primarily reflect the visible prescription. Do not add dosing advice from general knowledge.
- Give a short plain-language general function and a few common side effects plus only the most important urgent warning. Do not diagnose, recommend treatment, or claim the medicine is appropriate for the patient.
- Do not infer the patient's condition, age, identity, or medical history.
- If no medicine can be read reliably, return an empty medicines array and explain why in notes.
- Keep names as printed; write all explanatory prose in ${language}.
- The disclaimer must tell the reader to compare every item to the original and confirm it with a pharmacist or doctor before taking anything.`;
}

function imagePart(image) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

function requestOptions({ provider, apiKey, model, image, language, signal, referer }) {
  if (provider === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      options: {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: guidePrompt(language) }, imagePart(image)] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2400,
            responseMimeType: 'application/json',
            responseJsonSchema: GUIDE_SCHEMA,
          },
        }),
      },
    };
  }

  return {
    url: OPENROUTER_URL,
    options: {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': referer,
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: guidePrompt(language) },
            { type: 'image_url', image_url: { url: image, detail: 'high' } },
          ],
        }],
        temperature: 0,
        max_tokens: 2400,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'prescription_guide', strict: true, schema: GUIDE_SCHEMA },
        },
      }),
    },
  };
}

function validateGuide(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.medicines)
    || typeof value.notes !== 'string'
    || typeof value.disclaimer !== 'string') {
    throw new HttpError(502, 'guide_schema_invalid', 'The AI provider returned an invalid response. Please try again.');
  }
  for (const medicine of value.medicines) {
    const fields = ['name', 'strength', 'confidence', 'function', 'directions', 'sideEffects', 'uncertainty'];
    if (!medicine || typeof medicine !== 'object' || Array.isArray(medicine)
      || fields.some(field => typeof medicine[field] !== 'string')
      || !['high', 'medium', 'low'].includes(medicine.confidence)) {
      throw new HttpError(502, 'guide_schema_invalid', 'The AI provider returned an invalid response. Please try again.');
    }
  }
  return value;
}

export async function requestGuide({
  fetchImpl,
  provider,
  apiKey,
  model,
  image,
  language,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  referer,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
}) {
  const controller = new AbortControllerImpl();
  let timedOut = false;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeoutImpl(() => {
      timedOut = true;
      controller.abort();
      reject(new HttpError(504, 'upstream_timeout', 'The prescription took too long to read. Please try again.'));
    }, timeoutMs);
  });

  const upstreamRequest = async () => {
    const { url, options } = requestOptions({
      provider, apiKey, model, image, language, signal: controller.signal, referer,
    });
    const upstream = await fetchImpl(url, options);
    if (!upstream.ok) {
      if (upstream.status === 429) throw new HttpError(429, 'provider_rate_limited', 'The analysis service is busy. Please try again later.');
      if (upstream.status >= 400 && upstream.status < 500) throw new HttpError(502, 'provider_client_error', 'The analysis service could not process the image.');
      throw new HttpError(502, 'provider_server_error', 'The analysis service is temporarily unavailable.');
    }
    try {
      return await upstream.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new HttpError(502, 'provider_malformed_json', 'The AI provider returned an invalid response. Please try again.');
    }
  };

  let response;
  try {
    response = await Promise.race([upstreamRequest(), timeout]);
  } catch (error) {
    if (timedOut || controller.signal.aborted) {
      throw new HttpError(504, 'upstream_timeout', 'The prescription took too long to read. Please try again.');
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'provider_unavailable', 'The analysis service is temporarily unavailable.');
  } finally {
    clearTimeoutImpl(timeoutId);
  }

  const content = provider === 'gemini'
    ? response?.candidates?.[0]?.content?.parts?.map(part => part?.text).filter(Boolean).join('')
    : response?.choices?.[0]?.message?.content;
  if (!content) {
    throw new HttpError(502, 'provider_missing_content', 'The AI provider returned an empty response. Please try again.');
  }

  let guide = content;
  if (typeof content === 'string') {
    try {
      guide = JSON.parse(content);
    } catch {
      throw new HttpError(502, 'provider_malformed_content', 'The AI provider returned an invalid response. Please try again.');
    }
  }
  return validateGuide(guide);
}
