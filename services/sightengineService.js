// sightengineService.js (backend, Node 18+)
// Poziva Sightengine API i vraća odluku: { ok, reasons }.
// Ključevi idu samo u env promenljive na serveru, nikad u mobilnu aplikaciju:
//   SIGHTENGINE_API_USER, SIGHTENGINE_API_SECRET
// Opciono: SIGHTENGINE_TEXT_LANG (podrazumevano 'en,sr')

const IMAGE_URL = 'https://api.sightengine.com/1.0/check.json';
const TEXT_URL = 'https://api.sightengine.com/1.0/text/check.json';

// Proveri tačne nazive modela u svom Sightengine dashboardu / dokumentaciji.
const IMAGE_MODELS = 'nudity-2.1,weapon,gore-2.0,offensive';

const TEXT_CATEGORIES =
  'profanity,drug,weapon,violence,extremism,spam,content-trade,money-transaction';

// Pragovi za slike (0 do 1). Podesi prema rezultatima na pravim podacima.
const IMAGE_THRESHOLDS = {
  nudity: 0.6,
  weapon: 0.7,
  gore: 0.6,
  offensive: 0.7,
};

// Tekst: ove kategorije odbijaju sadržaj. 'personal' i 'link' su namerno izostavljeni
// jer je razmena brojeva/linkova u dejting četu normalna; dodaj ih ako želiš stroža pravila.
const TEXT_REJECT_CATEGORIES = [
  'profanity',
  'drug',
  'weapon',
  'violence',
  'extremism',
  'spam',
  'content-trade',
  'money-transaction',
];

// Text is checked on every chat message, and the chat client marks a message
// as undelivered after 10s, so the text timeout stays well below that.
const IMAGE_TIMEOUT_MS = 10000;
const TEXT_TIMEOUT_MS = 4000;

class ModerationUnavailableError extends Error {
  constructor(message = 'Moderation service unavailable') {
    super(message);
    this.name = 'ModerationUnavailableError';
    this.code = 'MODERATION_UNAVAILABLE';
  }
}

const num = (v) => (typeof v === 'number' ? v : 0);

function credentials() {
  const api_user = process.env.SIGHTENGINE_API_USER;
  const api_secret = process.env.SIGHTENGINE_API_SECRET;
  if (!api_user || !api_secret) {
    throw new ModerationUnavailableError('Sightengine credentials are not configured');
  }
  return { api_user, api_secret };
}

async function post(url, form, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.status !== 'success') {
      throw new ModerationUnavailableError(json?.error?.message || `HTTP ${res.status}`);
    }
    return json;
  } catch (err) {
    if (err instanceof ModerationUnavailableError) throw err;
    throw new ModerationUnavailableError(err.message);
  } finally {
    clearTimeout(timer);
  }
}

function evaluateImage(r) {
  const reasons = [];
  const n = r.nudity || {};
  const nudityScore = Math.max(num(n.sexual_activity), num(n.sexual_display), num(n.erotica));
  if (nudityScore >= IMAGE_THRESHOLDS.nudity) reasons.push('nudity');

  const w = r.weapon?.classes || {};
  if (Math.max(num(w.firearm), num(w.knife)) >= IMAGE_THRESHOLDS.weapon) reasons.push('weapon');

  if (num(r.gore?.prob) >= IMAGE_THRESHOLDS.gore) reasons.push('gore');
  if (num(r.offensive?.prob) >= IMAGE_THRESHOLDS.offensive) reasons.push('offensive');

  return reasons;
}

/**
 * @param {Buffer} buffer      sadržaj slike (npr. multer memoryStorage)
 * @param {string} filename
 * @param {string} mimetype
 * @returns {Promise<{ ok: boolean, reasons: string[] }>}
 */
async function moderateImage(buffer, filename = 'photo.jpg', mimetype = 'image/jpeg') {
  const { api_user, api_secret } = credentials();
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mimetype }), filename);
  form.append('models', IMAGE_MODELS);
  form.append('api_user', api_user);
  form.append('api_secret', api_secret);

  const result = await post(IMAGE_URL, form, IMAGE_TIMEOUT_MS);
  const reasons = evaluateImage(result);
  return { ok: reasons.length === 0, reasons };
}

function evaluateText(r) {
  const reasons = [];
  for (const category of TEXT_REJECT_CATEGORIES) {
    const matches = r[category]?.matches;
    if (!Array.isArray(matches) || matches.length === 0) continue;

    if (category === 'profanity') {
      // 'low' intenzitet ignorišemo, odbijamo medium i high.
      if (matches.some((m) => m.intensity !== 'low')) reasons.push('profanity');
    } else {
      reasons.push(category === 'content-trade' || category === 'money-transaction' ? 'spam' : category);
    }
  }
  return [...new Set(reasons)];
}

/**
 * @param {string} text
 * @returns {Promise<{ ok: boolean, reasons: string[] }>}
 */
async function moderateText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: true, reasons: [] };

  const { api_user, api_secret } = credentials();
  const form = new FormData();
  form.append('text', trimmed);
  form.append('lang', process.env.SIGHTENGINE_TEXT_LANG || 'en,sr');
  form.append('mode', 'rules');
  form.append('categories', TEXT_CATEGORIES);
  form.append('api_user', api_user);
  form.append('api_secret', api_secret);

  const result = await post(TEXT_URL, form, TEXT_TIMEOUT_MS);
  const reasons = evaluateText(result);
  return { ok: reasons.length === 0, reasons };
}

// Response bodies matching what the app expects. Use the same objects for
// HTTP (res.status(422).json(...)) and for socket acks (callback(...)).
const rejectionPayload = (type, reasons) => ({
  error: 'CONTENT_REJECTED',
  status: 'rejected',
  type,
  reasons,
});

const unavailablePayload = (type) => ({
  error: 'MODERATION_UNAVAILABLE',
  status: 'error',
  type,
});

module.exports = {
  moderateImage,
  moderateText,
  rejectionPayload,
  unavailablePayload,
  ModerationUnavailableError,
};