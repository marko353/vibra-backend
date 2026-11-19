// services/serbianProfanity.js
// Lokalna provera psovki na srpskom/hrvatskom/bosanskom (latinica i ćirilica).
// Sightengine ne podržava ove jezike, pa se ova provera radi PRE poziva njihovog API-ja.
//
// Kako radi: tekst se normalizuje (ćirilica -> latinica, bez kvačica, zamene brojeva
// za slova, skupljena ponovljena slova), pa se svaka reč poredi sa listom ispod.
//
// Svi obrasci moraju biti napisani normalizovano: mala slova, bez kvačica
// (č/ć -> c, š -> s, ž -> z, đ -> dj) i bez udvojenih slova.

// Reč se odbija ako ih SADRŽI bilo gde (hvata i "jebemtimater", "popizdeti")
const SUBSTRINGS = [
  'kurac', 'kurcin', 'kurcu', 'kurva', 'kurvo', 'kurvin', 'kurvetin',
  'pizd',
  'jebem', 'jebes', 'jebo', 'jebi', 'jebac', 'jebeni', 'jebeno', 'jebiga', 'jebote',
  'govn',
  'drolj',
];

// Reč se odbija ako POČINJE ovim (npr. "sranje", "sranja")
const PREFIXES = ['sran', 'pederc'];

// Reč se odbija samo ako je TAČNO ovakva (za reči koje bi inače pogodile bezazlene)
const EXACT = new Set([
  'picka', 'picku', 'pickom', 'pickice', 'pickica', 'pickin',
  'peder', 'pedera', 'pedere', 'pederu', 'pederi',
]);

const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's',
};

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function toTokens(text) {
  let t = String(text || '').toLowerCase();
  t = t.replace(/[\u0400-\u04ff]/g, (ch) => CYRILLIC[ch] ?? ch); // ćirilica -> latinica
  t = t.replace(/đ/g, 'dj');
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // č, ć, š, ž -> c, c, s, z
  t = t.replace(/[013457@$!]/g, (ch) => LEET[ch]); // j3b3m -> jebem
  const raw = t.replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);

  // "k u r a c" / "k.u.r.a.c": niz od 4+ pojedinačnih slova spaja se u jednu reč
  const tokens = [];
  let run = [];
  const flush = () => {
    if (run.length >= 4) tokens.push(run.join(''));
    run = [];
  };
  for (const tok of raw) {
    if (tok.length === 1) run.push(tok);
    else flush();
    tokens.push(tok);
  }
  flush();

  // "kuuuraaac" -> "kurac"
  return tokens.map((tok) => tok.replace(/(.)\1+/g, '$1'));
}

function matchToken(token) {
  if (EXACT.has(token)) return token;
  for (const p of PREFIXES) if (token.startsWith(p)) return p;
  for (const s of SUBSTRINGS) if (token.includes(s)) return s;
  return null;
}

/**
 * @param {string} text
 * @returns {{ ok: boolean, reasons: string[], matches: { source: string, word: string }[] }}
 */
function checkSerbianProfanity(text) {
  const found = new Set();
  for (const token of toTokens(text)) {
    const hit = matchToken(token);
    if (hit) found.add(hit);
  }
  const matches = [...found].map((word) => ({ source: 'local', word }));
  return { ok: matches.length === 0, reasons: matches.length ? ['profanity'] : [], matches };
}

module.exports = { checkSerbianProfanity };
