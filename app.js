const screens = {
  start: document.querySelector('#start-screen'),
  review: document.querySelector('#review-screen'),
  loading: document.querySelector('#loading-screen'),
  results: document.querySelector('#results-screen'),
};

const state = { image: null, fileName: '', quality: null, result: null };
const cameraInput = document.querySelector('#camera-input');
const uploadInput = document.querySelector('#upload-input');
const previewImage = document.querySelector('#preview-image');
const qualityBadge = document.querySelector('#quality-badge');
const qualityTitle = document.querySelector('#quality-title');
const qualityList = document.querySelector('#quality-list');
const analyzeButton = document.querySelector('#analyze-button');
const toast = document.querySelector('#toast');

const demoResult = {
  medicines: [
    {
      name: 'Amoxicillin', strength: '500 mg capsule', confidence: 'high',
      function: 'An antibiotic used to treat certain bacterial infections. It does not treat colds or flu.',
      directions: 'Take 1 capsule by mouth 3 times daily for 7 days. Follow the prescription label exactly and finish the prescribed course unless your clinician tells you otherwise.',
      sideEffects: 'Common: nausea, diarrhea, or mild rash. Get urgent help for trouble breathing, swelling of the face or throat, or a severe skin reaction.',
      uncertainty: ''
    },
    {
      name: 'Acetaminophen', strength: '500 mg tablet', confidence: 'high',
      function: 'Relieves mild to moderate pain and reduces fever.',
      directions: 'Take 1 tablet every 6 hours as needed for pain or fever. The sample says no more than 4 tablets in 24 hours.',
      sideEffects: 'Usually well tolerated at the directed dose. Too much can cause serious liver damage. Check other medicines for acetaminophen (also called APAP).',
      uncertainty: ''
    },
    {
      name: 'Cetirizine', strength: '10 mg tablet', confidence: 'medium',
      function: 'An antihistamine used to relieve allergy symptoms such as sneezing, itching, and a runny nose.',
      directions: 'The handwriting appears to say: take 1 tablet once daily in the evening.',
      sideEffects: 'May cause sleepiness, dry mouth, or tiredness. Avoid driving until you know how it affects you.',
      uncertainty: 'The timing on this line is not fully clear. Please confirm it with the pharmacist.'
    }
  ],
  notes: 'Sample only — these are fictional demo results and are not instructions for you.',
  disclaimer: 'This guide may contain errors. Verify it against the original prescription with a pharmacist or doctor.'
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('hidden', key !== name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

document.querySelector('#camera-button').addEventListener('click', () => cameraInput.click());
document.querySelector('#upload-button').addEventListener('click', () => uploadInput.click());
document.querySelector('#retake-button').addEventListener('click', () => uploadInput.click());
[cameraInput, uploadInput].forEach(input => input.addEventListener('change', event => handleFile(event.target.files?.[0])));
document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', reset));
document.querySelector('#demo-button').addEventListener('click', runDemo);
document.querySelector('#print-button').addEventListener('click', () => window.print());
document.querySelector('#copy-button').addEventListener('click', copyResults);
document.querySelector('#download-button').addEventListener('click', downloadResults);
analyzeButton.addEventListener('click', analyzePrescription);

function reset() {
  state.image = null; state.fileName = ''; state.quality = null; state.result = null;
  cameraInput.value = ''; uploadInput.value = '';
  showScreen('start');
}

async function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast('Please choose a JPG, PNG, or WebP image.'); return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('That image is over 10 MB. Please choose a smaller one.'); return;
  }

  state.fileName = file.name;
  state.image = await readFile(file);
  previewImage.src = state.image;
  qualityBadge.textContent = 'Checking image…';
  qualityBadge.className = 'quality-badge';
  showScreen('review');

  try {
    state.quality = await inspectImage(state.image);
    renderQuality(state.quality);
  } catch {
    state.quality = { width: 0, height: 0, brightness: 128, sharpness: 20, issues: [] };
    renderQuality(state.quality);
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
}

function inspectImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      let brightnessTotal = 0, edges = 0, samples = 0;
      for (let y = 1; y < height - 1; y += 3) {
        for (let x = 1; x < width - 1; x += 3) {
          const index = (y * width + x) * 4;
          const gray = .299 * pixels[index] + .587 * pixels[index + 1] + .114 * pixels[index + 2];
          const right = .299 * pixels[index + 4] + .587 * pixels[index + 5] + .114 * pixels[index + 6];
          const belowIndex = index + width * 4;
          const below = .299 * pixels[belowIndex] + .587 * pixels[belowIndex + 1] + .114 * pixels[belowIndex + 2];
          brightnessTotal += gray; edges += Math.abs(gray - right) + Math.abs(gray - below); samples++;
        }
      }
      const brightness = brightnessTotal / samples;
      const sharpness = edges / samples;
      const issues = [];
      if (image.width < 1000 || image.height < 1000) issues.push('resolution');
      if (brightness < 65) issues.push('dark');
      if (brightness > 225) issues.push('bright');
      if (sharpness < 12) issues.push('blurry');
      resolve({ width: image.width, height: image.height, brightness, sharpness, issues });
    };
    image.onerror = reject; image.src = src;
  });
}

function renderQuality(q) {
  const checks = [
    { ok: !q.issues.includes('resolution'), title: 'Page size', detail: q.issues.includes('resolution') ? 'A larger photo may make small text easier to read.' : `${q.width} × ${q.height} pixels — enough detail.` },
    { ok: !q.issues.includes('dark') && !q.issues.includes('bright'), title: 'Lighting', detail: q.issues.includes('dark') ? 'The photo looks dark. Move closer to a window.' : q.issues.includes('bright') ? 'Some areas may be overexposed or have glare.' : 'The page appears evenly lit.' },
    { ok: !q.issues.includes('blurry'), title: 'Sharpness', detail: q.issues.includes('blurry') ? 'Text edges look soft. Hold still and retake if possible.' : 'Text edges appear reasonably sharp.' },
  ];
  const good = q.issues.length === 0;
  qualityBadge.textContent = good ? 'Photo looks ready' : 'A retake may help';
  qualityBadge.className = `quality-badge ${good ? 'good' : 'warn'}`;
  qualityTitle.textContent = good ? 'Nice, clear photo' : 'A few things to check';
  qualityList.innerHTML = checks.map(check => `<div class="quality-item ${check.ok ? '' : 'warn'}"><span>${check.ok ? '✓' : '!'}</span><div><strong>${check.title}</strong><small>${check.detail}</small></div></div>`).join('');
  analyzeButton.textContent = good ? 'Read my prescription →' : 'Use this photo anyway →';
}

async function runDemo() {
  showScreen('loading');
  await animateLoading(1900);
  state.result = demoResult;
  renderResults(demoResult, true);
}

async function analyzePrescription() {
  if (!state.image) return;
  showScreen('loading');
  const loadingPromise = animateLoading(1600);
  try {
    const response = await fetch('/.netlify/functions/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: state.image, language: document.querySelector('#language').value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The prescription could not be analyzed.');
    await loadingPromise;
    state.result = payload;
    renderResults(payload, payload.demo === true);
  } catch (error) {
    await loadingPromise;
    showScreen('review');
    showToast(error.message.includes('fetch') ? 'The analysis service is not running. Try the sample or start Netlify Dev.' : error.message);
  }
}

async function animateLoading(minimum) {
  const title = document.querySelector('#loading-title');
  const steps = [...document.querySelectorAll('.loading-steps span')];
  const messages = ['Finding medicine names…', 'Reading dosage instructions…', 'Making the guide easy to understand…'];
  steps.forEach((step, index) => step.classList.toggle('active', index === 0));
  messages.forEach((message, index) => setTimeout(() => {
    title.textContent = message; steps.forEach((step, stepIndex) => step.classList.toggle('active', stepIndex <= index));
  }, index * minimum / 3));
  return new Promise(resolve => setTimeout(resolve, minimum));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderResults(result, isDemo = false) {
  const medicines = Array.isArray(result.medicines) ? result.medicines : [];
  document.querySelector('#results-summary').textContent = isDemo ? 'Sample guide with fictional information.' : `${medicines.length} medicine${medicines.length === 1 ? '' : 's'} found. Review each one against the original prescription.`;
  document.querySelector('#medicine-list').innerHTML = medicines.map((medicine, index) => {
    const confidence = medicine.confidence === 'high' ? 'high' : 'low';
    const confidenceLabel = medicine.confidence === 'high' ? 'Clear match' : 'Please verify';
    return `<article class="medicine-card">
      <div class="medicine-header"><div class="medicine-number">${index + 1}</div><div><h2>${escapeHtml(medicine.name || 'Unclear medicine name')}</h2><p>${escapeHtml(medicine.strength || 'Strength not visible')}</p></div><span class="confidence ${confidence}">${confidenceLabel}</span></div>
      <div class="medicine-body">
        <div class="medicine-detail"><div class="detail-label"><span class="detail-icon">+</span>What it's for</div><p>${escapeHtml(medicine.function || 'Not enough information to explain safely.')}</p></div>
        <div class="medicine-detail"><div class="detail-label"><span class="detail-icon">◷</span>How to use</div><p>${escapeHtml(medicine.directions || 'Directions were not readable. Check the label or ask a pharmacist.')}</p></div>
        <div class="medicine-detail"><div class="detail-label"><span class="detail-icon">!</span>Side effects</div><p>${escapeHtml(medicine.sideEffects || 'Ask a pharmacist about side effects and interactions.')}</p></div>
      </div>
      ${medicine.uncertainty ? `<p class="uncertain-note"><strong>Please verify:</strong> ${escapeHtml(medicine.uncertainty)}</p>` : ''}
    </article>`;
  }).join('');
  const notesCard = document.querySelector('#notes-card');
  notesCard.classList.toggle('hidden', !result.notes);
  document.querySelector('#notes-text').textContent = result.notes || '';
  showScreen('results');
}

function resultAsText() {
  if (!state.result) return '';
  const lines = ['SCRIPTSIMPLE MEDICINE GUIDE', '', 'IMPORTANT: Verify every item with the original prescription and a pharmacist. Never change a dose based on this guide.', ''];
  state.result.medicines.forEach((medicine, index) => {
    lines.push(`Item ${index + 1}: ${medicine.name}${medicine.strength ? ` — ${medicine.strength}` : ''}`, `Function: ${medicine.function}`, `How to use: ${medicine.directions}`, `Side effects: ${medicine.sideEffects}`);
    if (medicine.uncertainty) lines.push(`Please verify: ${medicine.uncertainty}`);
    lines.push('');
  });
  if (state.result.notes) lines.push(`Other notes: ${state.result.notes}`, '');
  lines.push('Educational aid only — not medical advice.');
  return lines.join('\n');
}

async function copyResults() {
  await navigator.clipboard.writeText(resultAsText()); showToast('Guide copied to clipboard.');
}

function downloadResults() {
  const blob = new Blob([resultAsText()], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `scriptsimple-guide-${new Date().toISOString().slice(0, 10)}.txt`; link.click(); URL.revokeObjectURL(link.href);
  showToast('Guide downloaded.');
}
