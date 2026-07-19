import {
  HttpError,
  errorResponse,
  jsonResponse,
  parseExtractionRequest,
} from './lib/http.mjs';
import { requestExtraction, resolveRequestTimeoutMs } from './lib/openrouter.mjs';
import { requestGeminiExtraction } from './lib/gemini.mjs';

const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

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
      const provider = (getEnv('EXTRACTION_PROVIDER') || 'openrouter').toLowerCase();
      const isGemini = provider === 'gemini';
      if (!isGemini && provider !== 'openrouter') {
        throw new HttpError(503, 'unsupported_provider', 'Extraction is not configured.');
      }
      const apiKey = getEnv(isGemini ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY');
      if (!apiKey) {
        throw new HttpError(503, 'not_configured', 'Extraction is not configured.');
      }

      const { image } = await parseExtractionRequest(request);
      const extractImage = isGemini ? requestGeminiExtraction : requestExtraction;
      const result = await extractImage({
        fetchImpl,
        apiKey,
        model: isGemini
          ? getEnv('GEMINI_VISION_MODEL') || DEFAULT_GEMINI_MODEL
          : getEnv('OPENROUTER_VISION_MODEL') || DEFAULT_MODEL,
        image,
        timeoutMs: resolveRequestTimeoutMs(getEnv('OPENROUTER_REQUEST_TIMEOUT_MS')),
      });
      return jsonResponse(200, result);
    } catch (error) {
      return errorResponse(error, debugEnabled);
    }
  };
}

export default createExtractHandler();
