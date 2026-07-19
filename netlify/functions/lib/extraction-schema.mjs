export const SCHEMA_VERSION = '1.0';

export const BLOCK_CATEGORIES = Object.freeze([
  'medication',
  'instruction',
  'patient',
  'prescriber',
  'facility',
  'administrative',
  'price_quantity',
  'date',
  'note',
  'signature_stamp',
  'unknown',
]);

export const LEGIBILITY_VALUES = Object.freeze(['clear', 'uncertain', 'unreadable']);
export const FIELD_STATUSES = Object.freeze(['present', 'uncertain', 'not_present', 'unreadable']);
export const MEDICATION_FIELD_NAMES = Object.freeze([
  'name',
  'strength',
  'dosageForm',
  'route',
  'frequency',
  'duration',
  'quantity',
]);

const fieldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: ['string', 'null'] },
    status: { type: 'string', enum: FIELD_STATUSES },
    rawText: { type: ['string', 'null'] },
  },
  required: ['value', 'status', 'rawText'],
};

export const EXTRACTION_JSON_SCHEMA = {
  name: 'prescription_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      schemaVersion: { type: 'string', const: SCHEMA_VERSION },
      document: {
        type: 'object',
        additionalProperties: false,
        properties: {
          languages: { type: 'array', items: { type: 'string' } },
          fullTranscript: { type: 'string' },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                pageOrder: { type: 'integer', minimum: 1 },
                category: { type: 'string', enum: BLOCK_CATEGORIES },
                rawText: { type: 'string' },
                legibility: { type: 'string', enum: LEGIBILITY_VALUES },
                sensitive: { type: 'boolean' },
                bbox: {
                  anyOf: [
                    { type: 'null' },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        x: { type: 'number', minimum: 0, maximum: 1 },
                        y: { type: 'number', minimum: 0, maximum: 1 },
                        width: { type: 'number', minimum: 0, maximum: 1 },
                        height: { type: 'number', minimum: 0, maximum: 1 },
                      },
                      required: ['x', 'y', 'width', 'height'],
                    },
                  ],
                },
              },
              required: ['id', 'pageOrder', 'category', 'rawText', 'legibility', 'sensitive', 'bbox'],
            },
          },
        },
        required: ['languages', 'fullTranscript', 'blocks'],
      },
      medicationCandidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            sourceBlockIds: { type: 'array', minItems: 1, items: { type: 'string' } },
            rawText: { type: 'string' },
            fields: {
              type: 'object',
              additionalProperties: false,
              properties: Object.fromEntries(MEDICATION_FIELD_NAMES.map(name => [name, fieldSchema])),
              required: MEDICATION_FIELD_NAMES,
            },
            otherVisibleFields: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string' },
                  value: { type: ['string', 'null'] },
                  status: { type: 'string', enum: FIELD_STATUSES },
                  rawText: { type: ['string', 'null'] },
                },
                required: ['label', 'value', 'status', 'rawText'],
              },
            },
          },
          required: ['id', 'sourceBlockIds', 'rawText', 'fields', 'otherVisibleFields'],
        },
      },
      documentWarnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['schemaVersion', 'document', 'medicationCandidates', 'documentWarnings'],
  },
};

export class ExtractionValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExtractionValidationError';
    this.code = code;
  }
}

function fail(code) {
  throw new ExtractionValidationError(code);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(value, keys, code) {
  if (!isObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function requireString(value, code) {
  if (typeof value !== 'string') fail(code);
}

function validateField(field, path) {
  requireExactKeys(field, ['value', 'status', 'rawText'], `${path}_shape`);
  if (!FIELD_STATUSES.includes(field.status)) fail(`${path}_status`);
  if (field.value !== null && typeof field.value !== 'string') fail(`${path}_value`);
  if (field.rawText !== null && typeof field.rawText !== 'string') fail(`${path}_raw_text`);

  if (field.status === 'not_present' && (field.value !== null || field.rawText !== null)) {
    fail(`${path}_not_present_value`);
  }
  if (field.status === 'present' && (typeof field.value !== 'string' || typeof field.rawText !== 'string')) {
    fail(`${path}_present_value`);
  }
}

function validateBbox(bbox, path) {
  if (bbox === null) return;
  requireExactKeys(bbox, ['x', 'y', 'width', 'height'], `${path}_shape`);
  for (const coordinate of ['x', 'y', 'width', 'height']) {
    if (typeof bbox[coordinate] !== 'number' || !Number.isFinite(bbox[coordinate])
      || bbox[coordinate] < 0 || bbox[coordinate] > 1) {
      fail(`${path}_range`);
    }
  }
}

export function validateExtractionResult(result) {
  requireExactKeys(result, ['schemaVersion', 'document', 'medicationCandidates', 'documentWarnings'], 'root_shape');
  if (result.schemaVersion !== SCHEMA_VERSION) fail('schema_version');

  requireExactKeys(result.document, ['languages', 'fullTranscript', 'blocks'], 'document_shape');
  if (!Array.isArray(result.document.languages)
    || result.document.languages.some(language => typeof language !== 'string')) fail('document_languages');
  requireString(result.document.fullTranscript, 'document_transcript');
  if (!Array.isArray(result.document.blocks)) fail('document_blocks');

  const blockIds = new Set();
  result.document.blocks.forEach((block, index) => {
    const path = `block_${index}`;
    requireExactKeys(block, ['id', 'pageOrder', 'category', 'rawText', 'legibility', 'sensitive', 'bbox'], `${path}_shape`);
    requireString(block.id, `${path}_id`);
    if (!block.id || blockIds.has(block.id)) fail(`${path}_id`);
    blockIds.add(block.id);
    if (!Number.isInteger(block.pageOrder) || block.pageOrder < 1) fail(`${path}_page_order`);
    if (!BLOCK_CATEGORIES.includes(block.category)) fail(`${path}_category`);
    requireString(block.rawText, `${path}_raw_text`);
    if (!LEGIBILITY_VALUES.includes(block.legibility)) fail(`${path}_legibility`);
    if (typeof block.sensitive !== 'boolean') fail(`${path}_sensitive`);
    if (['patient', 'prescriber'].includes(block.category) && !block.sensitive) fail(`${path}_sensitive`);
    validateBbox(block.bbox, `${path}_bbox`);
  });

  if (!Array.isArray(result.medicationCandidates)) fail('medication_candidates');
  const medicationIds = new Set();
  result.medicationCandidates.forEach((candidate, index) => {
    const path = `medication_${index}`;
    requireExactKeys(candidate, ['id', 'sourceBlockIds', 'rawText', 'fields', 'otherVisibleFields'], `${path}_shape`);
    requireString(candidate.id, `${path}_id`);
    if (!candidate.id || medicationIds.has(candidate.id)) fail(`${path}_id`);
    medicationIds.add(candidate.id);
    requireString(candidate.rawText, `${path}_raw_text`);
    if (!Array.isArray(candidate.sourceBlockIds) || candidate.sourceBlockIds.length === 0
      || candidate.sourceBlockIds.some(id => typeof id !== 'string' || !blockIds.has(id))) {
      fail(`${path}_source_blocks`);
    }

    requireExactKeys(candidate.fields, MEDICATION_FIELD_NAMES, `${path}_fields_shape`);
    MEDICATION_FIELD_NAMES.forEach(name => validateField(candidate.fields[name], `${path}_${name}`));

    if (!Array.isArray(candidate.otherVisibleFields)) fail(`${path}_other_fields`);
    candidate.otherVisibleFields.forEach((field, fieldIndex) => {
      requireExactKeys(field, ['label', 'value', 'status', 'rawText'], `${path}_other_${fieldIndex}_shape`);
      requireString(field.label, `${path}_other_${fieldIndex}_label`);
      validateField(
        { value: field.value, status: field.status, rawText: field.rawText },
        `${path}_other_${fieldIndex}`,
      );
    });
  });

  if (!Array.isArray(result.documentWarnings)
    || result.documentWarnings.some(warning => typeof warning !== 'string')) fail('document_warnings');

  return result;
}

export function parseAndValidateExtractionResult(content) {
  let result = content;
  if (typeof content === 'string') {
    try {
      result = JSON.parse(content);
    } catch {
      fail('malformed_model_json');
    }
  }
  return validateExtractionResult(result);
}
