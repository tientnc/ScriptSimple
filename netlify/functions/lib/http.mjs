export const ALLOWED_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_CHARACTERS = 5_700_000;

export class HttpError extends Error {
  constructor(status, code, publicMessage) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function parseExtractionRequest(request) {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_CHARACTERS) {
    throw new HttpError(413, 'request_too_large', 'The image is too large. Please choose a smaller image.');
  }

  let text;
  try {
    text = await request.text();
  } catch {
    throw new HttpError(400, 'request_read_failed', 'The request could not be read.');
  }

  if (text.length > MAX_REQUEST_CHARACTERS) {
    throw new HttpError(413, 'request_too_large', 'The image is too large. Please choose a smaller image.');
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body must be valid JSON.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_request', 'A prescription image is required.');
  }

  const image = validateImageDataUrl(body.image);
  const locale = typeof body.locale === 'string' && body.locale.trim()
    ? body.locale.trim().slice(0, 35)
    : 'en';

  return { image, locale };
}

export function validateImageDataUrl(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'image_required', 'A JPG, PNG, or WebP image is required.');
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !ALLOWED_IMAGE_MIME_TYPES.includes(match[1])) {
    throw new HttpError(400, 'unsupported_image_type', 'A JPG, PNG, or WebP image is required.');
  }

  const base64 = match[2];
  if (!base64 || base64.length % 4 !== 0) {
    throw new HttpError(400, 'invalid_image_data', 'The image data is invalid.');
  }

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedBytes = (base64.length / 4) * 3 - padding;
  if (decodedBytes > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'image_too_large', 'The image is too large. Please choose a smaller image.');
  }

  return value;
}

export function errorResponse(error, debugEnabled = false) {
  const known = error instanceof HttpError;
  const status = known ? error.status : 500;
  const message = known
    ? error.publicMessage
    : 'We could not extract text from that prescription safely. Try a clearer photo.';
  const body = { error: message };

  if (debugEnabled) {
    body.debug = { code: known ? error.code : 'internal_error' };
  }

  return jsonResponse(status, body);
}
