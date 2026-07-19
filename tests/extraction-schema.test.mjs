import test from 'node:test';
import assert from 'node:assert/strict';

import { createExtractHandler } from '../netlify/functions/extract.mjs';
import { HttpError } from '../netlify/functions/lib/http.mjs';
import { requestGeminiExtraction } from '../netlify/functions/lib/gemini.mjs';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  requestExtraction,
  resolveRequestTimeoutMs,
} from '../netlify/functions/lib/openrouter.mjs';
import {
  ExtractionValidationError,
  parseAndValidateExtractionResult,
  validateExtractionResult,
} from '../netlify/functions/lib/extraction-schema.mjs';

const notPresent = () => ({ value: null, status: 'not_present', rawText: null });
const present = value => ({ value, status: 'present', rawText: value });

function fields(overrides = {}) {
  return {
    name: notPresent(),
    strength: notPresent(),
    dosageForm: notPresent(),
    route: notPresent(),
    frequency: notPresent(),
    duration: notPresent(),
    quantity: notPresent(),
    ...overrides,
  };
}

function block(overrides = {}) {
  return {
    id: 'block_01',
    pageOrder: 1,
    category: 'facility',
    rawText: 'Example Hospital',
    legibility: 'clear',
    sensitive: false,
    bbox: null,
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    schemaVersion: '1.0',
    document: {
      languages: ['en'],
      fullTranscript: 'Example Hospital',
      blocks: [block()],
    },
    medicationCandidates: [],
    documentWarnings: [],
    ...overrides,
  };
}

function medicine(overrides = {}) {
  return {
    id: 'medication_01',
    sourceBlockIds: ['block_01'],
    rawText: 'Amoxicillin',
    fields: fields({ name: present('Amoxicillin') }),
    otherVisibleFields: [],
    ...overrides,
  };
}

function dataUrl(byteCount = 3) {
  return `data:image/jpeg;base64,${Buffer.alloc(byteCount).toString('base64')}`;
}

function expectValidationCode(callback, suffix) {
  assert.throws(callback, error => {
    assert.ok(error instanceof ExtractionValidationError);
    assert.ok(error.code.endsWith(suffix), `Expected "${error.code}" to end with "${suffix}"`);
    return true;
  });
}

function providerResponse(content = result()) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function extractionRequest(overrides = {}) {
  return requestExtraction({
    fetchImpl: async () => providerResponse(),
    apiKey: 'test-key',
    model: 'test/model',
    image: dataUrl(),
    timeoutMs: 50,
    ...overrides,
  });
}

function geminiProviderResponse(content = result()) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function geminiRequest(overrides = {}) {
  return requestGeminiExtraction({
    fetchImpl: async () => geminiProviderResponse(),
    apiKey: 'gemini-test-key',
    model: 'gemini-3.1-flash-lite',
    image: dataUrl(),
    timeoutMs: 50,
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

test('accepts a valid response with zero medications through a mocked provider', async () => {
  const expected = result();
  let providerCalls = 0;
  const handler = createExtractHandler({
    getEnv: name => name === 'OPENROUTER_API_KEY' ? 'test-key' : undefined,
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.temperature, 0);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(expected) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const response = await handler(new Request('http://localhost/.netlify/functions/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl(), locale: 'en' }),
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), expected);
  assert.equal(providerCalls, 1);
});

test('accepts one medicine with only a name', () => {
  const value = result({
    document: {
      languages: ['en'],
      fullTranscript: 'Amoxicillin',
      blocks: [block({ category: 'medication', rawText: 'Amoxicillin' })],
    },
    medicationCandidates: [medicine()],
  });
  assert.equal(validateExtractionResult(value), value);
});

test('accepts multiple medicines', () => {
  const value = result({
    document: {
      languages: ['en'],
      fullTranscript: 'Amoxicillin\nCetirizine',
      blocks: [
        block({ category: 'medication', rawText: 'Amoxicillin' }),
        block({ id: 'block_02', pageOrder: 2, category: 'medication', rawText: 'Cetirizine' }),
      ],
    },
    medicationCandidates: [
      medicine(),
      medicine({
        id: 'medication_02',
        sourceBlockIds: ['block_02'],
        rawText: 'Cetirizine',
        fields: fields({ name: present('Cetirizine') }),
      }),
    ],
  });
  assert.equal(validateExtractionResult(value).medicationCandidates.length, 2);
});

test('keeps not_present distinct from unreadable', () => {
  const value = result({
    document: {
      languages: ['en'],
      fullTranscript: 'Amoxicillin [unreadable]',
      blocks: [block({ category: 'medication', rawText: 'Amoxicillin [unreadable]', legibility: 'uncertain' })],
    },
    medicationCandidates: [medicine({
      fields: fields({
        name: present('Amoxicillin'),
        strength: { value: null, status: 'unreadable', rawText: null },
        route: notPresent(),
      }),
    })],
  });
  const validated = validateExtractionResult(value);
  assert.equal(validated.medicationCandidates[0].fields.strength.status, 'unreadable');
  assert.equal(validated.medicationCandidates[0].fields.route.status, 'not_present');
});

test('rejects an invalid category', () => {
  const value = result();
  value.document.blocks[0].category = 'diagnosis';
  expectValidationCode(() => validateExtractionResult(value), '_category');
});

test('rejects an invalid field status', () => {
  const value = result({ medicationCandidates: [medicine()] });
  value.medicationCandidates[0].fields.name.status = 'missing';
  expectValidationCode(() => validateExtractionResult(value), '_status');
});

test('rejects an out-of-range bounding box', () => {
  const value = result();
  value.document.blocks[0].bbox = { x: 1.1, y: 0, width: .5, height: .1 };
  expectValidationCode(() => validateExtractionResult(value), '_range');
});

test('rejects a missing source block reference', () => {
  const value = result({ medicationCandidates: [medicine({ sourceBlockIds: ['block_99'] })] });
  expectValidationCode(() => validateExtractionResult(value), '_source_blocks');
});

test('rejects malformed model JSON', () => {
  expectValidationCode(() => parseAndValidateExtractionResult('{"schemaVersion":'), 'malformed_model_json');
});

test('rejects oversized input before any mocked network call', async () => {
  let providerCalled = false;
  const handler = createExtractHandler({
    getEnv: name => name === 'OPENROUTER_API_KEY' ? 'test-key' : undefined,
    fetchImpl: async () => {
      providerCalled = true;
      throw new Error('network should not be called');
    },
  });
  const response = await handler(new Request('http://localhost/.netlify/functions/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl(4 * 1024 * 1024 + 1), locale: 'en' }),
  }));

  assert.equal(response.status, 413);
  assert.equal(providerCalled, false);
  assert.deepEqual(await response.json(), {
    error: 'The image is too large. Please choose a smaller image.',
  });
});

test('uses the safe default and bounds configured request timeouts', () => {
  assert.equal(resolveRequestTimeoutMs(undefined), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(resolveRequestTimeoutMs('12000'), 12000);
  assert.equal(resolveRequestTimeoutMs('invalid'), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(resolveRequestTimeoutMs('99999'), 26000);
});

test('accepts a successful OpenRouter response before timeout and passes an abort signal', async () => {
  let signal;
  const value = await extractionRequest({
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return providerResponse();
    },
  });
  assert.equal(value.schemaVersion, '1.0');
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test('aborts the OpenRouter request at the configured timeout', async () => {
  let capturedSignal;
  const promise = extractionRequest({
    timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  });
  await expectHttpError(promise, 504, 'upstream_timeout');
  assert.equal(capturedSignal.aborted, true);
});

test('does not misclassify an unrelated AbortError as the configured timeout', async () => {
  const abortError = new Error('upstream aborted independently');
  abortError.name = 'AbortError';
  await expectHttpError(extractionRequest({
    fetchImpl: async () => { throw abortError; },
  }), 502, 'provider_unavailable');
});

test('clears the request timer following success', async () => {
  const timerId = Symbol('timer');
  const cleared = [];
  await extractionRequest({
    setTimeoutImpl: () => timerId,
    clearTimeoutImpl: id => cleared.push(id),
  });
  assert.deepEqual(cleared, [timerId]);
});

test('clears the request timer following provider errors', async () => {
  const timerId = Symbol('timer');
  const cleared = [];
  await expectHttpError(extractionRequest({
    fetchImpl: async () => new Response('', { status: 500 }),
    setTimeoutImpl: () => timerId,
    clearTimeoutImpl: id => cleared.push(id),
  }), 502, 'provider_server_error');
  assert.deepEqual(cleared, [timerId]);
});

test('clears the request timer after it aborts the provider request', async () => {
  const timerId = Symbol('timer');
  const cleared = [];
  await expectHttpError(extractionRequest({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    setTimeoutImpl: callback => {
      queueMicrotask(callback);
      return timerId;
    },
    clearTimeoutImpl: id => cleared.push(id),
  }), 504, 'upstream_timeout');
  assert.deepEqual(cleared, [timerId]);
});

test('distinguishes OpenRouter HTTP 429', async () => {
  await expectHttpError(extractionRequest({
    fetchImpl: async () => new Response('', { status: 429 }),
  }), 429, 'provider_rate_limited');
});

test('distinguishes OpenRouter HTTP 400', async () => {
  await expectHttpError(extractionRequest({
    fetchImpl: async () => new Response('', { status: 400 }),
  }), 502, 'provider_client_error');
});

test('distinguishes OpenRouter HTTP 500', async () => {
  await expectHttpError(extractionRequest({
    fetchImpl: async () => new Response('', { status: 500 }),
  }), 502, 'provider_server_error');
});

test('distinguishes malformed upstream JSON', async () => {
  await expectHttpError(extractionRequest({
    fetchImpl: async () => new Response('{not-json', { status: 200 }),
  }), 502, 'provider_malformed_json');
});

test('distinguishes structurally invalid model responses with missing content', async () => {
  await expectHttpError(extractionRequest({
    fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
  }), 502, 'provider_missing_content');
});

test('distinguishes extraction-schema validation failures', async () => {
  await expectHttpError(extractionRequest({
    fetchImpl: async () => providerResponse({ schemaVersion: '1.0' }),
  }), 502, 'schema_validation_failed');
});

test('returns an exact safe timeout response without request contents', async () => {
  const sensitiveMarker = 'SENSITIVE_TEST_MARKER';
  const handler = createExtractHandler({
    getEnv: name => ({
      OPENROUTER_API_KEY: 'test-key',
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
  const response = await handler(new Request('http://localhost/.netlify/functions/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: `data:image/jpeg;base64,${Buffer.from(sensitiveMarker).toString('base64')}`,
      locale: 'en',
    }),
  }));
  const responseText = await response.text();

  assert.equal(response.status, 504);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(responseText), {
    error: 'extraction_timeout',
    message: 'The prescription took too long to read. Please try again.',
  });
  assert.equal(responseText.includes(sensitiveMarker), false);
  assert.equal(responseText.includes('test-key'), false);
});

test('selects Gemini and preserves structured extraction output', async () => {
  let requestUrl;
  let requestOptions;
  const handler = createExtractHandler({
    getEnv: name => ({
      EXTRACTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-key',
      GEMINI_VISION_MODEL: 'gemini-3.1-flash-lite',
      OPENROUTER_REQUEST_TIMEOUT_MS: '50',
    })[name],
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(result()) }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const response = await handler(new Request('http://localhost/.netlify/functions/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl(), locale: 'en' }),
  }));
  const requestBody = JSON.parse(requestOptions.body);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result());
  assert.match(requestUrl, /gemini-3\.1-flash-lite:generateContent$/);
  assert.equal(requestOptions.headers['x-goog-api-key'], 'gemini-test-key');
  assert.equal(requestBody.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.deepEqual(requestBody.generationConfig.responseJsonSchema.properties.schemaVersion.enum, ['1.0']);
  assert.equal('const' in requestBody.generationConfig.responseJsonSchema.properties.schemaVersion, false);
});

test('Gemini uses the same controlled timeout and clears its timer', async () => {
  const timerId = Symbol('gemini-timer');
  const cleared = [];
  await expectHttpError(requestGeminiExtraction({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    apiKey: 'gemini-test-key',
    model: 'gemini-3.1-flash-lite',
    image: dataUrl(),
    timeoutMs: 5,
    setTimeoutImpl: callback => {
      queueMicrotask(callback);
      return timerId;
    },
    clearTimeoutImpl: id => cleared.push(id),
  }), 504, 'upstream_timeout');
  assert.deepEqual(cleared, [timerId]);
});

test('Gemini clears its timer after success', async () => {
  const timerId = Symbol('gemini-success-timer');
  const cleared = [];
  const value = await geminiRequest({
    setTimeoutImpl: () => timerId,
    clearTimeoutImpl: id => cleared.push(id),
  });
  assert.equal(value.schemaVersion, '1.0');
  assert.deepEqual(cleared, [timerId]);
});

test('Gemini does not misclassify an unrelated AbortError as a timeout', async () => {
  const abortError = new Error('upstream aborted independently');
  abortError.name = 'AbortError';
  await expectHttpError(geminiRequest({
    fetchImpl: async () => { throw abortError; },
  }), 502, 'provider_unavailable');
});

test('Gemini distinguishes provider HTTP responses', async t => {
  for (const [status, expectedStatus, code] of [
    [429, 429, 'provider_rate_limited'],
    [400, 502, 'provider_client_error'],
    [500, 502, 'provider_server_error'],
  ]) {
    await t.test(String(status), async () => {
      await expectHttpError(geminiRequest({
        fetchImpl: async () => new Response('', { status }),
      }), expectedStatus, code);
    });
  }
});

test('Gemini distinguishes malformed upstream JSON', async () => {
  await expectHttpError(geminiRequest({
    fetchImpl: async () => new Response('{not-json', { status: 200 }),
  }), 502, 'provider_malformed_json');
});

test('Gemini distinguishes missing structured content', async () => {
  await expectHttpError(geminiRequest({
    fetchImpl: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
  }), 502, 'provider_missing_content');
});

test('Gemini distinguishes extraction-schema validation failures', async () => {
  await expectHttpError(geminiRequest({
    fetchImpl: async () => geminiProviderResponse({ schemaVersion: '1.0' }),
  }), 502, 'schema_validation_failed');
});

test('Gemini returns the exact safe timeout response without sensitive contents', async () => {
  const sensitiveMarker = 'SENSITIVE_GEMINI_TEST_MARKER';
  const handler = createExtractHandler({
    getEnv: name => ({
      EXTRACTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-key',
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
  const response = await handler(new Request('http://localhost/.netlify/functions/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: `data:image/jpeg;base64,${Buffer.from(sensitiveMarker).toString('base64')}`,
      locale: 'en',
    }),
  }));
  const responseText = await response.text();

  assert.equal(response.status, 504);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(responseText), {
    error: 'extraction_timeout',
    message: 'The prescription took too long to read. Please try again.',
  });
  assert.equal(responseText.includes(sensitiveMarker), false);
  assert.equal(responseText.includes('gemini-test-key'), false);
});
