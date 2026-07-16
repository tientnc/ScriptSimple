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
const languageSelect = document.querySelector('#language');
const { languages, messages } = window.ScriptSimpleI18n;
let locale = localStorage.getItem('scriptsimple-language') || getSuggestedLocale();

function getSuggestedLocale() {
  const browserLocale = navigator.language?.toLowerCase() || 'en';
  return Object.keys(languages).find(code => browserLocale === code || browserLocale.startsWith(`${code}-`)) || 'en';
}

function t(key, replacements = {}) {
  const template = messages[locale]?.[key] ?? messages.en[key] ?? key;
  return Object.entries(replacements).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    template
  );
}

function applyLocale(nextLocale) {
  locale = languages[nextLocale] ? nextLocale : 'en';
  languageSelect.value = locale;
  localStorage.setItem('scriptsimple-language', locale);
  document.documentElement.lang = locale;

  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(element => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });

  if (state.quality) renderQuality(state.quality);
  if (state.result) renderResults(state.result, state.result.demo === true);
}

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

const localizedDemoResults = {
  vi: {
    medicines: [{
      name: 'Amoxicillin', strength: 'Viên nang 500 mg', confidence: 'high',
      function: 'Kháng sinh dùng để điều trị một số bệnh nhiễm khuẩn. Thuốc không điều trị cảm lạnh hoặc cúm.',
      directions: 'Ví dụ: uống 1 viên, ngày 3 lần trong 7 ngày. Luôn làm theo đúng nhãn thuốc và xác nhận với dược sĩ.',
      sideEffects: 'Thường gặp: buồn nôn, tiêu chảy hoặc phát ban nhẹ. Cần trợ giúp khẩn cấp nếu khó thở hoặc sưng mặt, cổ họng.',
      uncertainty: ''
    }],
    notes: 'Chỉ là ví dụ — đây là thông tin giả định, không phải hướng dẫn dành cho bạn.',
    disclaimer: 'Hãy đối chiếu mọi thông tin với đơn gốc và dược sĩ.'
  },
  es: {
    medicines: [{
      name: 'Amoxicilina', strength: 'Cápsula de 500 mg', confidence: 'high',
      function: 'Antibiótico utilizado para tratar ciertas infecciones bacterianas. No trata resfriados ni gripe.',
      directions: 'Ejemplo: tomar 1 cápsula 3 veces al día durante 7 días. Sigue siempre la etiqueta y confírmalo con un farmacéutico.',
      sideEffects: 'Frecuentes: náuseas, diarrea o sarpullido leve. Busca ayuda urgente si tienes dificultad para respirar o hinchazón de la cara o garganta.',
      uncertainty: ''
    }],
    notes: 'Solo es un ejemplo: la información es ficticia y no son instrucciones para ti.',
    disclaimer: 'Compara toda la información con la receta original y un farmacéutico.'
  },
  zh: {
    medicines: [{
      name: '阿莫西林', strength: '500 毫克胶囊', confidence: 'high',
      function: '用于治疗某些细菌感染的抗生素，不能治疗感冒或流感。',
      directions: '示例：每日 3 次，每次 1 粒，共 7 天。务必按照药品标签使用，并向药剂师确认。',
      sideEffects: '常见副作用包括恶心、腹泻或轻微皮疹。如出现呼吸困难或面部、喉咙肿胀，请立即求助。',
      uncertainty: ''
    }],
    notes: '仅为示例——这些是虚构信息，并非给您的用药说明。',
    disclaimer: '请将所有信息与原处方核对，并向药剂师确认。'
  },
  fr: {
    medicines: [{
      name: 'Amoxicilline', strength: 'Gélule de 500 mg', confidence: 'high',
      function: "Antibiotique utilisé contre certaines infections bactériennes. Il ne traite ni le rhume ni la grippe.",
      directions: "Exemple : prendre 1 gélule 3 fois par jour pendant 7 jours. Suivez toujours l'étiquette et confirmez avec un pharmacien.",
      sideEffects: "Fréquents : nausées, diarrhée ou légère éruption. Demandez une aide urgente en cas de difficulté à respirer ou de gonflement du visage ou de la gorge.",
      uncertainty: ''
    }],
    notes: "Exemple uniquement : ces informations sont fictives et ne constituent pas des instructions pour vous.",
    disclaimer: "Comparez toutes les informations avec l'ordonnance originale et un pharmacien."
  },
  ko: {
    medicines: [{
      name: '아목시실린', strength: '500mg 캡슐', confidence: 'high',
      function: '일부 세균 감염을 치료하는 항생제입니다. 감기나 독감에는 효과가 없습니다.',
      directions: '예시: 7일 동안 하루 3회 1캡슐 복용. 항상 약 라벨을 따르고 약사에게 확인하세요.',
      sideEffects: '흔한 부작용은 메스꺼움, 설사 또는 가벼운 발진입니다. 호흡 곤란이나 얼굴·목 부종이 있으면 즉시 도움을 받으세요.',
      uncertainty: ''
    }],
    notes: '예시일 뿐이며 실제 복용 지침이 아닌 가상 정보입니다.',
    disclaimer: '모든 정보를 원본 처방전과 비교하고 약사에게 확인하세요.'
  }
};

function getDemoResult() {
  return { ...(localizedDemoResults[locale] || demoResult), demo: true };
}

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
languageSelect.addEventListener('change', event => applyLocale(event.target.value));
applyLocale(locale);

function reset() {
  state.image = null; state.fileName = ''; state.quality = null; state.result = null;
  cameraInput.value = ''; uploadInput.value = '';
  showScreen('start');
}

async function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast(t('fileTypeError')); return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast(t('fileSizeError')); return;
  }

  state.fileName = file.name;
  state.image = await readFile(file);
  previewImage.src = state.image;
  qualityBadge.textContent = t('qualityChecking');
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
    {
      ok: !q.issues.includes('resolution'),
      title: t('pageSize'),
      detail: q.issues.includes('resolution') ? t('lowResolution') : t('enoughDetail', { width: q.width, height: q.height })
    },
    {
      ok: !q.issues.includes('dark') && !q.issues.includes('bright'),
      title: t('lighting'),
      detail: q.issues.includes('dark') ? t('dark') : q.issues.includes('bright') ? t('bright') : t('evenLight')
    },
    {
      ok: !q.issues.includes('blurry'),
      title: t('sharpness'),
      detail: q.issues.includes('blurry') ? t('blurry') : t('sharp')
    },
  ];
  const good = q.issues.length === 0;
  qualityBadge.textContent = good ? t('photoReady') : t('retakeHelp');
  qualityBadge.className = `quality-badge ${good ? 'good' : 'warn'}`;
  qualityTitle.textContent = good ? t('clearPhoto') : t('thingsToCheck');
  qualityList.innerHTML = checks.map(check => `<div class="quality-item ${check.ok ? '' : 'warn'}"><span>${check.ok ? '✓' : '!'}</span><div><strong>${check.title}</strong><small>${check.detail}</small></div></div>`).join('');
  analyzeButton.textContent = good ? t('readPrescription') : t('useAnyway');
}

async function runDemo() {
  showScreen('loading');
  await animateLoading(1900);
  state.result = getDemoResult();
  renderResults(state.result, true);
}

async function analyzePrescription() {
  if (!state.image) return;
  showScreen('loading');
  const loadingPromise = animateLoading(1600);
  try {
    const response = await fetch('/.netlify/functions/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: state.image, locale })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || t('analyzeError'));
    await loadingPromise;
    state.result = payload;
    renderResults(payload, payload.demo === true);
  } catch (error) {
    await loadingPromise;
    showScreen('review');
    showToast(error.message.includes('fetch') ? t('serviceError') : error.message);
  }
}

async function animateLoading(minimum) {
  const title = document.querySelector('#loading-title');
  const steps = [...document.querySelectorAll('.loading-steps span')];
  const loadingMessages = [t('findingNames'), t('readingDose'), t('makingGuide')];
  steps.forEach((step, index) => step.classList.toggle('active', index === 0));
  loadingMessages.forEach((message, index) => setTimeout(() => {
    title.textContent = message; steps.forEach((step, stepIndex) => step.classList.toggle('active', stepIndex <= index));
  }, index * minimum / 3));
  return new Promise(resolve => setTimeout(resolve, minimum));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderResults(result, isDemo = false) {
  const medicines = Array.isArray(result.medicines) ? result.medicines : [];
  document.querySelector('#results-summary').textContent = isDemo
    ? t('sampleSummary')
    : t('resultSummary', { count: medicines.length });
  document.querySelector('#medicine-list').innerHTML = medicines.map((medicine, index) => {
    const confidence = medicine.confidence === 'high' ? 'high' : 'low';
    const confidenceLabel = medicine.confidence === 'high' ? t('clearMatch') : t('verify');
    return `<article class="medicine-card">
      <div class="medicine-header"><div class="medicine-number">${index + 1}</div><div><h2>${escapeHtml(medicine.name || t('unclearName'))}</h2><p>${escapeHtml(medicine.strength || t('strengthMissing'))}</p></div><span class="confidence ${confidence}">${confidenceLabel}</span></div>
      <div class="medicine-body">
        <div class="medicine-detail"><div class="detail-label"><span class="detail-icon">+</span>${t('purpose')}</div><p>${escapeHtml(medicine.function || t('purposeMissing'))}</p></div>
        <div class="medicine-detail"><div class="detail-label"><span class="detail-icon">◷</span>${t('directions')}</div><p>${escapeHtml(medicine.directions || t('directionsMissing'))}</p></div>
        <div class="medicine-detail"><div class="detail-label"><span class="detail-icon">!</span>${t('sideEffects')}</div><p>${escapeHtml(medicine.sideEffects || t('effectsMissing'))}</p></div>
      </div>
      ${medicine.uncertainty ? `<p class="uncertain-note"><strong>${t('verify')}:</strong> ${escapeHtml(medicine.uncertainty)}</p>` : ''}
    </article>`;
  }).join('');
  const notesCard = document.querySelector('#notes-card');
  notesCard.classList.toggle('hidden', !result.notes);
  document.querySelector('#notes-text').textContent = result.notes || '';
  showScreen('results');
}

function resultAsText() {
  if (!state.result) return '';
  const lines = [t('textTitle'), '', t('textImportant'), ''];
  state.result.medicines.forEach((medicine, index) => {
    lines.push(
      `${t('item')} ${index + 1}: ${medicine.name}${medicine.strength ? ` — ${medicine.strength}` : ''}`,
      `${t('function')}: ${medicine.function}`,
      `${t('directions')}: ${medicine.directions}`,
      `${t('sideEffects')}: ${medicine.sideEffects}`
    );
    if (medicine.uncertainty) lines.push(`${t('verify')}: ${medicine.uncertainty}`);
    lines.push('');
  });
  if (state.result.notes) lines.push(`${t('otherNotesText')}: ${state.result.notes}`, '');
  lines.push(t('educational'));
  return lines.join('\n');
}

async function copyResults() {
  await navigator.clipboard.writeText(resultAsText()); showToast(t('copied'));
}

function downloadResults() {
  const blob = new Blob([resultAsText()], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `scriptsimple-guide-${new Date().toISOString().slice(0, 10)}.txt`; link.click(); URL.revokeObjectURL(link.href);
  showToast(t('downloaded'));
}
