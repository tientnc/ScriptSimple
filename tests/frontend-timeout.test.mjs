import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../extraction-client.js');
const { isExtractionTimeout, postPrescription } = globalThis.ScriptSimpleExtractionClient;

test('recognizes only the controlled extraction timeout response', () => {
  assert.equal(isExtractionTimeout({ status: 504 }, { error: 'extraction_timeout' }), true);
  assert.equal(isExtractionTimeout({ status: 502 }, { error: 'extraction_timeout' }), false);
  assert.equal(isExtractionTimeout({ status: 504 }, { error: 'other_error' }), false);
});

test('manual retry reuses the supplied in-memory normalized image', async () => {
  const normalizedImage = 'data:image/jpeg;base64,U1lOVEhFVElDX0lNQUdF';
  const requestBodies = [];
  const fetchImpl = async (_endpoint, options) => {
    requestBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      error: 'extraction_timeout',
      message: 'The prescription took too long to read. Please try again.',
    }), { status: 504, headers: { 'Content-Type': 'application/json' } });
  };

  await postPrescription({ endpoint: '/.netlify/functions/extract', image: normalizedImage, locale: 'en', fetchImpl });
  await postPrescription({ endpoint: '/.netlify/functions/extract', image: normalizedImage, locale: 'en', fetchImpl });

  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].image, normalizedImage);
  assert.equal(requestBodies[1].image, normalizedImage);
});

test('extraction requests never use persistent browser storage', async () => {
  let storageAccesses = 0;
  const storage = new Proxy({}, {
    get() {
      storageAccesses += 1;
      throw new Error('persistent storage must not be accessed');
    },
  });
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });

  try {
    await postPrescription({
      endpoint: '/.netlify/functions/extract',
      image: 'data:image/jpeg;base64,U1lOVEhFVElD',
      locale: 'en',
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    else delete globalThis.localStorage;
    if (sessionStorageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', sessionStorageDescriptor);
    else delete globalThis.sessionStorage;
  }

  assert.equal(storageAccesses, 0);
});

test('verify timeout UI is accessible, localized, focused, and manually retried', async () => {
  const [app, html, i18n] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../i18n.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="verify-error-screen"[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(html, /id="extraction-error-title"[^>]*tabindex="-1"[^>]*data-i18n="extractionTimeoutTitle"/);
  assert.match(html, /id="retry-extraction-button"[^>]*data-i18n="retryExtraction"/);
  assert.match(app, /retryExtractionButton\.addEventListener\('click', analyzePrescription\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => extractionErrorHeading\.focus\(\)\)/);
  assert.match(app, /verificationFlow && isExtractionTimeout\(response, payload\)/);
  assert.match(app, /postPrescription\(\{[\s\S]*?image: state\.image,[\s\S]*?locale,/);
  assert.match(app, /showExtractionTimeout\(\)[\s\S]*?showScreen\('verifyError'\)/);
  assert.deepEqual(
    [...app.matchAll(/localStorage\.setItem\('([^']+)'/g)].map(match => match[1]).sort(),
    ['scriptsimple-language', 'scriptsimple-text-size'],
  );
  assert.doesNotMatch(app, /sessionStorage|indexedDB|analytics|sendBeacon/);
  assert.doesNotMatch(app, /(?:URLSearchParams|location\.(?:search|hash))[^\n]*(?:state\.image|normalized|payload|extraction)/i);
  assert.equal((i18n.match(/retryExtraction:/g) || []).length, 6);
  assert.equal((i18n.match(/extractionTimeoutMessage:/g) || []).length, 6);
});
