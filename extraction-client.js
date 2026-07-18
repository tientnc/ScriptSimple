(function initializeExtractionClient(global) {
  async function postPrescription({ endpoint, image, locale, fetchImpl = global.fetch }) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, locale }),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  function isExtractionTimeout(response, payload) {
    return response.status === 504 && payload?.error === 'extraction_timeout';
  }

  global.ScriptSimpleExtractionClient = Object.freeze({
    isExtractionTimeout,
    postPrescription,
  });
})(globalThis);
