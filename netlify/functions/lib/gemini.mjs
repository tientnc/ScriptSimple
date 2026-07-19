import {
  EXTRACTION_JSON_SCHEMA,
  parseAndValidateExtractionResult,
  ExtractionValidationError,
} from './extraction-schema.mjs';
import { HttpError } from './http.mjs';
import { DEFAULT_REQUEST_TIMEOUT_MS, EXTRACTION_PROMPT } from './openrouter.mjs';

function geminiSchema() {
  const schema = structuredClone(EXTRACTION_JSON_SCHEMA.schema);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'const')) {
      value.enum = [value.const];
      delete value.const;
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
  return schema;
}

function imagePart(image) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

export async function requestGeminiExtraction({
  fetchImpl,
  apiKey,
  model,
  image,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const upstream = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: EXTRACTION_PROMPT }, imagePart(image)],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 5000,
          responseMimeType: 'application/json',
          responseJsonSchema: geminiSchema(),
        },
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) throw new HttpError(429, 'provider_rate_limited', 'The extraction service is busy. Please try again later.');
      if (upstream.status >= 400 && upstream.status < 500) throw new HttpError(502, 'provider_client_error', 'The extraction service could not process the image.');
      if (upstream.status >= 500) throw new HttpError(502, 'provider_server_error', 'The extraction service is temporarily unavailable.');
      throw new HttpError(502, 'provider_http_error', 'The extraction service returned an unexpected response.');
    }

    try {
      return await upstream.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new HttpError(502, 'provider_malformed_json', 'The extraction service returned an invalid response.');
    }
  };

  let response;
  try {
    response = await Promise.race([upstreamRequest(), timeout]);
  } catch (error) {
    if (timedOut || controller.signal.aborted) throw new HttpError(504, 'upstream_timeout', 'The prescription took too long to read. Please try again.');
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'provider_unavailable', 'The extraction service is temporarily unavailable.');
  } finally {
    clearTimeoutImpl(timeoutId);
  }

  const content = response?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text)
    .filter(text => typeof text === 'string')
    .join('');
  if (!content) throw new HttpError(502, 'provider_missing_content', 'The extraction service returned an invalid response.');

  try {
    return parseAndValidateExtractionResult(content);
  } catch (error) {
    if (error instanceof ExtractionValidationError) throw new HttpError(502, 'schema_validation_failed', 'The extraction service returned an invalid response.');
    throw new HttpError(502, 'schema_validation_failed', 'The extraction service returned an invalid response.');
  }
}
