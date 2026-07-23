import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnalyzeHandler } from '../netlify/functions/analyze.mjs';
import { requestGuide } from '../netlify/functions/lib/guide.mjs';
import { HttpError } from '../netlify/functions/lib/http.mjs';

const image = () => `data:image/jpeg;base64,${Buffer.from('synthetic').toString('base64')}`;
const guide = () => ({
  medicines: [{
    name: 'Example medicine',
    strength: '10 mg',
    confidence: 'high',
    function: 'Example function',
    directions: 'Visible directions',
    sideEffects: 'Example effects',
    uncertainty: '',
  }],
  notes: 'Example notes',
  disclaimer: 'Confirm with a pharmacist or doctor.',
});

function request(overrides = {}) {
  return requestGuide({
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(guide()) }] } }],
    }), { status: 200 }),
    provider: 'gemini',
    apiKey: 'test-key',
    model: 'gemini-3.1-flash-lite',
    image: image(),
    language: 'English',
    timeoutMs: 50,
    referer: 'https://example.test',
    ...overrides,
  });
}

async function expectHttpError(promise, status, code) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test('analyze selects Gemini and returns a structured guide', async () => {
  let url;
  let options;
  const handler = createAnalyzeHandler({
    getEnv: name => ({
      EXTRACTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_VISION_MODEL: 'gemini-3.1-flash-lite',
      OPENROUTER_REQUEST_TIMEOUT_MS: '50',
    })[name],
    fetchImpl: async (requestUrl, requestOptions) => {
      url = requestUrl;
      options = requestOptions;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(guide()) }] } }],
      }), { status: 200 });
    },
  });
  const response = await handler(new Request('https://example.test/.netlify/functions/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: image(), locale: 'en' }),
  }));
  const body = JSON.parse(options.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), guide());
  assert.match(url, /gemini-3\.1-flash-lite:generateContent$/);
  assert.equal(options.headers['x-goog-api-key'], 'test-key');
  assert.equal(body.generationConfig.temperature, 0);
  assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
});

test('Gemini empty content returns a controlled provider error', async () => {
  await expectHttpError(request({
    fetchImpl: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
  }), 502, 'provider_missing_content');
});

test('Gemini invalid guide shape is rejected', async () => {
  await expectHttpError(request({
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ medicines: [] }) }] } }],
    }), { status: 200 }),
  }), 502, 'guide_schema_invalid');
});

test('guide timeout aborts one request and clears its timer', async () => {
  const timerId = Symbol('timer');
  const cleared = [];
  let calls = 0;
  await expectHttpError(request({
    fetchImpl: async (_url, options) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
    setTimeoutImpl: callback => {
      queueMicrotask(callback);
      return timerId;
    },
    clearTimeoutImpl: id => cleared.push(id),
  }), 504, 'upstream_timeout');
  assert.equal(calls, 1);
  assert.deepEqual(cleared, [timerId]);
});

test('guide success clears its timer', async () => {
  const timerId = Symbol('success-timer');
  const cleared = [];
  await request({
    setTimeoutImpl: () => timerId,
    clearTimeoutImpl: id => cleared.push(id),
  });
  assert.deepEqual(cleared, [timerId]);
});

test('OpenRouter remains available without automatic fallback', async () => {
  let calls = 0;
  const value = await request({
    provider: 'openrouter',
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(guide()) } }],
      }), { status: 200 });
    },
  });
  assert.deepEqual(value, guide());
  assert.equal(calls, 1);
});

test('analyze timeout response contains no image or key', async () => {
  const marker = 'SENSITIVE_TEST_MARKER';
  const handler = createAnalyzeHandler({
    getEnv: name => ({
      EXTRACTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_VISION_MODEL: 'gemini-3.1-flash-lite',
      OPENROUTER_REQUEST_TIMEOUT_MS: '5',
    })[name],
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  const response = await handler(new Request('https://example.test/.netlify/functions/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: `data:image/jpeg;base64,${Buffer.from(marker).toString('base64')}`,
      locale: 'en',
    }),
  }));
  const responseText = await response.text();

  assert.equal(response.status, 504);
  assert.equal(responseText.includes(marker), false);
  assert.equal(responseText.includes('test-key'), false);
  assert.deepEqual(JSON.parse(responseText), {
    error: 'The prescription took too long to read. Please try again.',
  });
});
