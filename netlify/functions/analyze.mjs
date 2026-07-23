import { HttpError, jsonResponse, parseExtractionRequest } from './lib/http.mjs';
import { requestGuide } from './lib/guide.mjs';
import { resolveRequestTimeoutMs } from './lib/openrouter.mjs';

const OUTPUT_LANGUAGES = Object.freeze({
  en: 'English',
  vi: 'Vietnamese',
  es: 'Spanish',
  zh: 'Simplified Chinese',
  fr: 'French',
  ko: 'Korean',
});
const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-26b-a4b-it:free';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export function createAnalyzeHandler({
  fetchImpl = globalThis.fetch,
  getEnv = name => globalThis.Netlify?.env?.get(name),
} = {}) {
  return async function analyze(request) {
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }

    try {
      const provider = (getEnv('EXTRACTION_PROVIDER') || 'openrouter').toLowerCase();
      if (!['gemini', 'openrouter'].includes(provider)) {
        throw new HttpError(503, 'unsupported_provider', 'Analysis is not configured.');
      }
      const apiKey = getEnv(provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY');
      if (!apiKey) throw new HttpError(503, 'not_configured', 'Analysis is not configured.');

      const { image, locale } = await parseExtractionRequest(request);
      const language = OUTPUT_LANGUAGES[locale] || OUTPUT_LANGUAGES.en;
      const guide = await requestGuide({
        fetchImpl,
        provider,
        apiKey,
        model: provider === 'gemini'
          ? getEnv('GEMINI_VISION_MODEL') || DEFAULT_GEMINI_MODEL
          : getEnv('OPENROUTER_VISION_MODEL') || DEFAULT_OPENROUTER_MODEL,
        image,
        language,
        timeoutMs: resolveRequestTimeoutMs(getEnv('OPENROUTER_REQUEST_TIMEOUT_MS')),
        referer: request.headers.get('origin') || 'https://scriptsimple.netlify.app',
      });
      return jsonResponse(200, guide);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(error.status, { error: error.publicMessage });
      }
      return jsonResponse(500, {
        error: 'We could not read that prescription safely. Try a clearer photo.',
      });
    }
  };
}

export default createAnalyzeHandler();
