import {
  HttpError,
  errorResponse,
  jsonResponse,
  parseExtractionRequest,
} from './lib/http.mjs';
import { requestExtraction } from './lib/openrouter.mjs';

const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

export function createExtractHandler({
  fetchImpl = globalThis.fetch,
  getEnv = name => globalThis.Netlify?.env?.get(name),
} = {}) {
  return async function extract(request) {
    const debugEnabled = getEnv('EXTRACTION_DEBUG') === 'true';

    if (request.method !== 'POST') {
      return errorResponse(
        new HttpError(405, 'method_not_allowed', 'Method not allowed.'),
        debugEnabled,
      );
    }

    try {
      const apiKey = getEnv('OPENROUTER_API_KEY');
      if (!apiKey) {
        throw new HttpError(503, 'not_configured', 'Extraction is not configured.');
      }

      const { image } = await parseExtractionRequest(request);
      const result = await requestExtraction({
        fetchImpl,
        apiKey,
        model: getEnv('OPENROUTER_VISION_MODEL') || DEFAULT_MODEL,
        image,
      });
      return jsonResponse(200, result);
    } catch (error) {
      return errorResponse(error, debugEnabled);
    }
  };
}

export default createExtractHandler();
