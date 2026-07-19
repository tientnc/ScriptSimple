import {
  EXTRACTION_JSON_SCHEMA,
  parseAndValidateExtractionResult,
  ExtractionValidationError,
} from './extraction-schema.mjs';
import { HttpError } from './http.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_REQUEST_TIMEOUT_MS = 24_000;
const MAX_REQUEST_TIMEOUT_MS = 26_000;

export function resolveRequestTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), MAX_REQUEST_TIMEOUT_MS);
}

export const EXTRACTION_PROMPT = `Extract visible text from this single prescription image. This is transcription and document structuring only.

Rules:
- Transcribe all legible visible text, including medication, patient, prescriber, facility, date, price, quantity, notes, stamps, and administrative content.
- Preserve source-language text. Do not translate the transcript.
- Preserve reading order and do not silently correct spelling.
- Do not infer a missing drug name, strength, dosage form, route, frequency, quantity, or duration.
- Do not provide medical knowledge or diagnoses.
- Do not add drug functions, indications, purposes, side effects, warnings, interactions, recommendations, or dosing advice.
- A printed description may be transcribed as visible text, but must not be rewritten as authoritative medical information.
- Represent a signature that is not readable as text as "[signature or handwritten mark]".
- Mark patient and prescriber identifiers as sensitive: true.
- Medication candidates may contain only the name when that is all the image provides.
- Return an empty medicationCandidates array when no medication candidate is supported by visible text.
- Preserve uncertainty explicitly with the allowed legibility and field status values. Use unreadable only when a field/region is visibly present but cannot be read; use not_present only when it is absent.
- Every medication candidate must reference one or more existing source block IDs.
- Use null for bbox unless the region can be localized reliably. Never fabricate precise coordinates.
- Include only image-supported information in every response field.`;

export async function requestExtraction({
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
      reject(new HttpError(
        504,
        'upstream_timeout',
        'The prescription took too long to read. Please try again.',
      ));
    }, timeoutMs);
  });

  const upstreamRequest = async () => {
    const upstream = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://scriptsimple.netlify.app',
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: image, detail: 'high' } },
          ],
        }],
        temperature: 0,
        max_tokens: 5000,
        response_format: {
          type: 'json_schema',
          json_schema: EXTRACTION_JSON_SCHEMA,
        },
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) {
        throw new HttpError(429, 'provider_rate_limited', 'The extraction service is busy. Please try again later.');
      }
      if (upstream.status >= 400 && upstream.status < 500) {
        throw new HttpError(502, 'provider_client_error', 'The extraction service could not process the image.');
      }
      if (upstream.status >= 500) {
        throw new HttpError(502, 'provider_server_error', 'The extraction service is temporarily unavailable.');
      }
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
    if (timedOut || controller.signal.aborted) {
      throw new HttpError(504, 'upstream_timeout', 'The prescription took too long to read. Please try again.');
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'provider_unavailable', 'The extraction service is temporarily unavailable.');
  } finally {
    clearTimeoutImpl(timeoutId);
  }

  const content = response?.choices?.[0]?.message?.content;
  if (content === undefined || content === null || content === '') {
    throw new HttpError(502, 'provider_missing_content', 'The extraction service returned an invalid response.');
  }

  try {
    return parseAndValidateExtractionResult(content);
  } catch (error) {
    if (error instanceof ExtractionValidationError) {
      throw new HttpError(502, 'schema_validation_failed', 'The extraction service returned an invalid response.');
    }
    throw new HttpError(502, 'schema_validation_failed', 'The extraction service returned an invalid response.');
  }
}
