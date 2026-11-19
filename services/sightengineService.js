// sightengineService.js (backend, Node 18+)
// Poziva Sightengine API i vraća odluku: { ok, reasons, matches }.
// Ključevi idu samo u env promenljive na serveru, nikad u mobilnu aplikaciju:
//   SIGHTENGINE_API_USER, SIGHTENGINE_API_SECRET
// Opciono: SIGHTENGINE_TEXT_LANG (podrazumevano 'en')
// Opciono: SIGHTENGINE_DEBUG=1 (loguje sirov odgovor API-ja, samo za testiranje)
//
// Napomena: Sightengine ne podržava srpski/hrvatski/bosanski, pa se za njih
// koristi lokalna lista (./serbianProfanity) pre poziva API-ja.

const { checkSerbianProfanity } = require('./serbianProfanity');

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
    if (process.env.SIGHTENGINE_DEBUG) {
      console.log('[sightengine raw]', url, JSON.stringify(json));
    }
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

// Vraća razloge i pogođene reči (matches), da se u logu vidi šta je tačno okinulo odbijanje.
function evaluateText(r) {
  const reasons = [];
  const matches = [];
  for (const category of TEXT_REJECT_CATEGORIES) {
    const found = r[category]?.matches;
    if (!Array.isArray(found) || found.length === 0) continue;

    if (category === 'profanity') {
      // 'low' intenzitet ignorišemo, odbijamo medium i high.
      const strong = found.filter((m) => m.intensity !== 'low');
      if (strong.length > 0) {
        reasons.push('profanity');
        strong.forEach((m) =>
          matches.push({
            source: 'sightengine',
            category,
            type: m.type,
            intensity: m.intensity,
            word: m.match ?? m.text ?? null,
          })
        );
      }
    } else {
      const reason = category === 'content-trade' || category === 'money-transaction' ? 'spam' : category;
      reasons.push(reason);
      found.forEach((m) =>
        matches.push({ source: 'sightengine', category, intensity: m.intensity, word: m.match ?? m.text ?? null })
      );
    }
  }
  return { reasons: [...new Set(reasons)], matches };
}

// Brojevi zalepljeni na kraj reči ("Test3", "Marko92") se ne šalju Sightengine-u:
// njegovo prepoznavanje prerušenih reči ih može pročitati kao slova i lažno odbiti poruku.
// Psovka sa brojem na kraju i dalje se hvata jer slova ostaju. Brojevi usred reči
// ("sh1t", "ab12cd") ostaju netaknuti: lookahead zabranjuje i slovo i cifru iza broja.
const stripTrailingDigits = (text) => text.replace(/(?<=\p{L})\d+(?![\p{L}\d])/gu, '');

/**
 * @param {string} text
 * @returns {Promise<{ ok: boolean, reasons: string[], matches: object[] }>}
 */
async function moderateText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: true, reasons: [], matches: [] };

  // 1. Lokalna lista za srpski/hrvatski/bosanski (bez poziva API-ja)
  const local = checkSerbianProfanity(trimmed);
  if (!local.ok) return local;

  // 2. Sightengine za ostale jezike i kategorije
  const { api_user, api_secret } = credentials();
  const form = new FormData();
  form.append('text', stripTrailingDigits(trimmed));
  form.append('lang', process.env.SIGHTENGINE_TEXT_LANG || 'en');
  form.append('mode', 'rules');
  form.append('categories', TEXT_CATEGORIES);
  form.append('api_user', api_user);
  form.append('api_secret', api_secret);

  const result = await post(TEXT_URL, form, TEXT_TIMEOUT_MS);
  const { reasons, matches } = evaluateText(result);
  return { ok: reasons.length === 0, reasons, matches };
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