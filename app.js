const screens = {
  start: document.querySelector('#start-screen'),
  review: document.querySelector('#review-screen'),
  loading: document.querySelector('#loading-screen'),
  results: document.querySelector('#results-screen'),
  verify: document.querySelector('#verify-screen'),
};

const state = { image: null, fileName: '', quality: null, result: null };
const verificationFlow = new URLSearchParams(window.location.search).get('flow') === 'verify';
const NORMALIZED_IMAGE_TARGET_BYTES = Math.round(3.5 * 1024 * 1024);
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const uploadInput = document.querySelector('#upload-input');
const cameraDialog = document.querySelector('#camera-dialog');
const cameraVideo = document.querySelector('#camera-video');
const cameraCanvas = document.querySelector('#camera-canvas');
const cameraMessage = document.querySelector('#camera-message');
const cameraCaptureButton = document.querySelector('#camera-capture');
const cameraSwitchButton = document.querySelector('#camera-switch');
let cameraStream = null;
let videoDevices = [];
let activeCameraIndex = 0;

async function openCamera() {
  if (typeof cameraDialog.showModal !== "function") {
    uploadInput.click();
    return;
  }
  cameraDialog.showModal();
  cameraMessage.classList.remove('hidden', 'error');
  cameraMessage.textContent = t('cameraStarting');
  cameraCaptureButton.disabled = true;
  cameraSwitchButton.classList.add('hidden');

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showCameraError('cameraSecureContext');
    return;
  }

  try {
    await startCamera();
  } catch (error) {
    const key = error?.name === 'NotAllowedError'
      ? 'cameraPermissionDenied'
      : error?.name === 'NotFoundError'
        ? 'cameraNotFound'
        : 'cameraUnavailable';
    showCameraError(key);
  }
}

async function startCamera(deviceId) {
  stopCameraStream();
  const video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };

  cameraStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  cameraVideo.srcObject = cameraStream;
  await cameraVideo.play();
  cameraMessage.classList.add('hidden');
  cameraCaptureButton.disabled = false;

  videoDevices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
  const activeId = cameraStream.getVideoTracks()[0]?.getSettings().deviceId;
  activeCameraIndex = Math.max(0, videoDevices.findIndex(device => device.deviceId === activeId));
  cameraSwitchButton.classList.toggle('hidden', videoDevices.length < 2);
}

async function switchCamera() {
  if (videoDevices.length < 2) return;
  activeCameraIndex = (activeCameraIndex + 1) % videoDevices.length;
  cameraMessage.classList.remove('hidden', 'error');
  cameraMessage.textContent = t('cameraStarting');
  cameraCaptureButton.disabled = true;
  try {
    await startCamera(videoDevices[activeCameraIndex].deviceId);
  } catch {
    showCameraError('cameraUnavailable');
  }
}

function captureCameraPhoto() {
  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) return;
  cameraCanvas.width = cameraVideo.videoWidth;
  cameraCanvas.height = cameraVideo.videoHeight;
  cameraCanvas.getContext('2d').drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
  cameraCanvas.toBlob(blob => {
    if (!blob) {
      showCameraError('cameraCaptureFailed');
      return;
    }
    const file = new File([blob], `scriptsimple-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    closeCamera();
    handleFile(file);
  }, 'image/jpeg', .95);
}

function showCameraError(key) {
  stopCameraStream();
  cameraMessage.textContent = t(key);
  cameraMessage.classList.remove('hidden');
  cameraMessage.classList.add('error');
  cameraCaptureButton.disabled = true;
}

function stopCameraStream() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
}

function closeCamera() {
  stopCameraStream();
  if (cameraDialog.open) cameraDialog.close();
}

function uploadFromCameraDialog() {
  closeCamera();
  uploadInput.click();
}
const previewImage = document.querySelector('#preview-image');
const qualityBadge = document.querySelector('#quality-badge');
const qualityTitle = document.querySelector('#quality-title');
const qualityList = document.querySelector('#quality-list');
const analyzeButton = document.querySelector('#analyze-button');
const toast = document.querySelector('#toast');
const languageSelect = document.querySelector('#language');
const readButton = document.querySelector('#read-button');
const textSizeButtons = [...document.querySelectorAll('[data-text-size]')];
const speechLanguages = { en: 'en-US', vi: 'vi-VN', es: 'es-ES', zh: 'zh-CN', fr: 'fr-FR', ko: 'ko-KR' };
let speechSession = 0;
let speechLoading = false;

function setTextSize(size) {
  const safeSize = ['small', 'normal', 'large', 'xlarge'].includes(size) ? size : 'normal';
  document.body.dataset.textSize = safeSize;
  localStorage.setItem('scriptsimple-text-size', safeSize);
  textSizeButtons.forEach(button => {
    const active = button.dataset.textSize === safeSize;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function stopReading() {
  speechSession += 1;
  window.speechSynthesis?.cancel();
  if (readButton) {
    readButton.classList.remove('active');
    readButton.textContent = t('readAloud');
  }
}

function waitForSpeechVoices(timeout = 1800) {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);

  return new Promise(resolve => {
    const started = Date.now();
    const timer = setInterval(() => {
      const nextVoices = window.speechSynthesis.getVoices();
      if (nextVoices.length || Date.now() - started >= timeout) {
        clearInterval(timer);
        resolve(nextVoices);
      }
    }, 100);
  });
}

function chooseSpeechVoice(voices, languageTag) {
  const normalizedTarget = languageTag.toLowerCase().replaceAll("_", "-");
  const languagePrefix = normalizedTarget.split("-")[0];
  const matchingVoices = voices.filter(voice => {
    const normalizedVoice = voice.lang.toLowerCase().replaceAll("_", "-");
    return normalizedVoice === normalizedTarget || normalizedVoice.startsWith(languagePrefix + "-");
  });

  return matchingVoices.find(voice => voice.lang.toLowerCase().replaceAll("_", "-") === normalizedTarget)
    || matchingVoices.find(voice => voice.default)
    || matchingVoices[0]
    || null;
}

async function toggleReadAloud() {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    showToast(t("speechUnavailable"));
    return;
  }
  if (window.speechSynthesis.speaking || readButton.classList.contains("active")) {
    stopReading();
    return;
  }
  if (!state.result || speechLoading) return;

  speechLoading = true;
  const languageTag = speechLanguages[locale] || speechLanguages.en;
  const matchingVoice = chooseSpeechVoice(await waitForSpeechVoices(), languageTag);
  speechLoading = false;

  if (!matchingVoice) {
    showToast(t("voiceUnavailable", { language: languages[locale]?.name || locale }));
    return;
  }

  const session = ++speechSession;
  const sections = speechSections();
  readButton.classList.add("active");
  readButton.textContent = t("stopReading");

  function speakSection(index) {
    if (session !== speechSession || index >= sections.length) {
      if (session === speechSession) stopReading();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(sections[index]);
    utterance.lang = matchingVoice.lang;
    utterance.voice = matchingVoice;
    utterance.rate = 0.84;
    utterance.onend = () => speakSection(index + 1);
    utterance.onerror = () => stopReading();
    window.speechSynthesis.speak(utterance);
  }

  speakSection(0);
}

function speechSections() {
  const sections = [t('textImportant')];
  state.result.medicines.forEach((medicine, index) => {
    sections.push(
      `${t('item')} ${index + 1}. ${medicine.name}. ${medicine.strength || ''}. ` +
      `${t('function')}: ${medicine.function}. ` +
      `${t('directions')}: ${medicine.directions}. ` +
      `${t('sideEffects')}: ${medicine.sideEffects}. ` +
      `${medicine.uncertainty ? `${t('verify')}: ${medicine.uncertainty}.` : ''}`
    );
  });
  if (state.result.notes) sections.push(`${t('otherNotesText')}: ${state.result.notes}`);
  return sections;
}
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
  if (window.speechSynthesis?.speaking) stopReading();
  locale = languages[nextLocale] ? nextLocale : 'en';
  languageSelect.value = locale;
  localStorage.setItem('scriptsimple-language', locale);
  document.documentElement.lang = locale;

  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
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
  const duration = message.length > 80 ? 5200 : 2400;
  setTimeout(() => toast.classList.remove('show'), duration);
}

document.querySelector('#camera-button').addEventListener('click', openCamera);
document.querySelector('#camera-close').addEventListener('click', closeCamera);
document.querySelector('#camera-capture').addEventListener('click', captureCameraPhoto);
document.querySelector('#camera-switch').addEventListener('click', switchCamera);
document.querySelector('#camera-upload-fallback').addEventListener('click', uploadFromCameraDialog);
cameraDialog.addEventListener('close', stopCameraStream);
cameraDialog.addEventListener('cancel', event => { event.preventDefault(); closeCamera(); });
document.querySelector('#upload-button').addEventListener('click', () => uploadInput.click());
document.querySelector('#retake-button').addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', event => handleFile(event.target.files?.[0]));
document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', reset));
document.querySelector('#demo-button').addEventListener('click', runDemo);
document.querySelector('#print-button').addEventListener('click', () => window.print());
document.querySelector('#copy-button').addEventListener('click', copyResults);
document.querySelector('#download-button').addEventListener('click', downloadResults);
readButton.addEventListener('click', toggleReadAloud);
textSizeButtons.forEach(button => button.addEventListener('click', () => setTextSize(button.dataset.textSize)));
analyzeButton.addEventListener('click', analyzePrescription);
languageSelect.addEventListener('change', event => applyLocale(event.target.value));
applyLocale(locale);
setTextSize(localStorage.getItem('scriptsimple-text-size') || 'normal');

function reset() {
  stopReading();
  state.image = null; state.fileName = ''; state.quality = null; state.result = null;
  document.querySelector('#verify-output').textContent = '';
  uploadInput.value = '';
  showScreen('start');
}

async function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast(t('fileTypeError')); return;
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    showToast(t('fileSizeError')); return;
  }

  try {
    const normalized = await normalizePrescriptionImage(file);
    state.fileName = file.name;
    state.image = normalized.dataUrl;
    previewImage.src = state.image;
    qualityBadge.textContent = t('qualityChecking');
    qualityBadge.className = 'quality-badge';
    showScreen('review');
    state.quality = await inspectImage(state.image);
    renderQuality(state.quality);
  } catch {
    state.image = null;
    showToast(t('imageNormalizeError'));
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
}

async function normalizePrescriptionImage(fileOrBlob) {
  if (!(fileOrBlob instanceof Blob)) throw new Error('invalid_image');

  const sourceUrl = URL.createObjectURL(fileOrBlob);
  const sourceImage = new Image();
  try {
    sourceImage.src = sourceUrl;
    await sourceImage.decode();

    const sourceWidth = sourceImage.naturalWidth;
    const sourceHeight = sourceImage.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('image_decode_failed');

    const initialScale = Math.min(1, 2200 / Math.max(sourceWidth, sourceHeight));
    let width = Math.max(1, Math.round(sourceWidth * initialScale));
    let height = Math.max(1, Math.round(sourceHeight * initialScale));
    const qualitySteps = [.82, .72, .62, .52];

    for (let dimensionAttempt = 0; dimensionAttempt < 6; dimensionAttempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(sourceImage, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
        if (blob.size <= NORMALIZED_IMAGE_TARGET_BYTES) {
          return { blob, dataUrl: await readFile(blob), width, height };
        }
      }

      width = Math.max(1, Math.round(width * .82));
      height = Math.max(1, Math.round(height * .82));
    }
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }

  throw new Error('image_cannot_be_reduced');
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('image_encode_failed')), type, quality);
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
    const endpoint = verificationFlow
      ? '/.netlify/functions/extract'
      : '/.netlify/functions/analyze';
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: state.image, locale })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || t('analyzeError'));
    await loadingPromise;
    if (verificationFlow) {
      renderExtractionDebug(payload);
    } else {
      state.result = payload;
      renderResults(payload, payload.demo === true);
    }
  } catch (error) {
    await loadingPromise;
    showScreen('review');
    showToast(error.message.includes('fetch') ? t('serviceError') : error.message);
  }
}

function renderExtractionDebug(result) {
  const output = document.querySelector('#verify-output');
  output.textContent = JSON.stringify(result, null, 2);
  showScreen('verify');
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
