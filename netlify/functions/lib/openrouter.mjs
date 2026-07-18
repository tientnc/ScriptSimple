import {
  EXTRACTION_JSON_SCHEMA,
  parseAndValidateExtractionResult,
  ExtractionValidationError,
} from './extraction-schema.mjs';
import { HttpError } from './http.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
}) {
  let upstream;
  try {
    upstream = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
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
  } catch {
    throw new HttpError(502, 'provider_unavailable', 'The extraction service is temporarily unavailable.');
  }

  if (!upstream.ok) {
    throw new HttpError(502, 'provider_rejected_request', 'The extraction service could not process the image.');
  }

  let response;
  try {
    response = await upstream.json();
  } catch {
    throw new HttpError(502, 'provider_invalid_response', 'The extraction service returned an invalid response.');
  }

  const content = response?.choices?.[0]?.message?.content;
  if (content === undefined || content === null || content === '') {
    throw new HttpError(502, 'provider_empty_response', 'The extraction service returned an empty response.');
  }

  try {
    return parseAndValidateExtractionResult(content);
  } catch (error) {
    if (error instanceof ExtractionValidationError) {
      throw new HttpError(502, `model_${error.code}`, 'The extraction service returned an invalid response.');
    }
    throw new HttpError(502, 'provider_invalid_response', 'The extraction service returned an invalid response.');
  }
}
