import test from 'node:test';
import assert from 'node:assert/strict';

import { createExtractHandler } from '../netlify/functions/extract.mjs';
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
