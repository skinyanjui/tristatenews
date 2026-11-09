// Deterministic comment rules. Not a hate-speech model: explicit abuse rejects; slurs used as
// insults reject; quoting / "don't say X" / some medical-colloquial mentions HOLD for a person.
// A negation wrapper is not a publish bypass. Identity mentions without banned terms stay ok.
// Whole tokens/phrases after normalize — never a substring scan of the compact string (Scunthorpe).
'use strict';

const ZW = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u180E]/g;
const LEET = { '@': 'a', '4': 'a', '$': 's', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '5': 's', '7': 't' };
// Common Latin lookalikes (Cyrillic/Greek/dotless i). Not a full confusable list.
const HOMO = {
  'а': 'a', 'е': 'e', 'о': 'o', 'і': 'i', 'ї': 'i', 'ı': 'i', 'с': 'c', 'р': 'p', 'у': 'y', 'х': 'x',
  'к': 'k', 'н': 'h', 'в': 'b', 'м': 'm', 'т': 't', 'ԁ': 'd', 'ɡ': 'g', 'ѕ': 's',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ι': 'i', 'ρ': 'p', 'τ': 't', 'κ': 'k', 'χ': 'x'
};

const PROFANITY = split('fuck fucking fucked fucker fuckers motherfucker motherfuckers motherfucking shit shits bullshit asshole assholes cocksucker cocksuckers cunt cunts fck fuk');
const SLURS = split(
  'nigger niggers nigga niggas spic spics kike kikes chink chinks gook gooks wetback wetbacks beaner beaners paki pakis raghead ragheads towelhead towelheads faggot faggots fag fags dyke dykes tranny trannies shemale shemales retard retards retarded mongoloid mongoloids'
);
const PHRASES = ['heil hitler', 'white power', 'gas the jews', 'kill all jews', 'kill all muslims'];
const STOP = split('a an the is are was were this that those these you your ya they them he she it to of in on for and or but not dont do did no with from at be here');

const GROUP = 'black people|blacks|african americans|jews|jewish people|muslims|gays|gay people|lesbians|trans people|transgender people|mexicans|hispanics|asians|immigrants|refugees|disabled people';
const HOLD_RE = [
  new RegExp('\\b(?:kill|murder|lynch|gas|exterminate|deport)\\s+all\\s+(?:the\\s+)?(?:' + GROUP + ')\\b', 'i'),
  new RegExp('\\b(?:' + GROUP + ')\\s+(?:should|must|need to)\\s+(?:die|burn|hang|leave)\\b', 'i'),
  new RegExp('\\bi\\s+hate\\s+(?:all\\s+)?(?:' + GROUP + ')\\b', 'i')
];
const MENTION_RE = /\b(?:the\s+word|word|dont\s+(?:use|say|type|write)|do\s+not\s+(?:use|say|type|write)|called\s+(?:me|him|her|them|us)|used\s+the\s+word)\b/;
const VERSION = 2;

function split(s) { return new Set(s.split(/\s+/).filter(Boolean)); }

function leetChar(c) { return LEET[c] || c; }

function foldChar(c) { return HOMO[c] || leetChar(c); }

function normalize(text) {
  let s = String(text || '').normalize('NFKC').replace(ZW, '').toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) out += foldChar(s[i]);
  return out;
}

function tokens(norm) {
  // Strip punct in place (f*ck → fck) rather than turning it into a space (f ck), so disguises
  // stay one token. Spaces still split words. Runs of single letters (f u c k) join when ≥3.
  const raw = norm.replace(/[^a-z0-9\s]+/g, '').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const out = [];
  let run = '';
  function flush() {
    if (run.length >= 3) out.push(run);
    else if (run.length) {
      for (let i = 0; i < run.length; i++) out.push(run[i]);
    }
    run = '';
  }
  raw.forEach(t => {
    if (t.length === 1) { run += t; return; }
    flush();
    out.push(t);
  });
  flush();
  return out;
}

function phrases(toks) {
  const p = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i + 1]) p.push(toks[i] + toks[i + 1]);
    if (toks[i + 1] && toks[i + 2]) p.push(toks[i] + toks[i + 1] + toks[i + 2]);
    if (toks[i + 1]) p.push(toks[i] + ' ' + toks[i + 1]);
  }
  return p;
}

function flexRe(word) {
  let p = '', i = 0;
  while (i < word.length) {
    let j = i + 1;
    while (j < word.length && word[j] === word[i]) j++;
    const n = j - i;
    p += word[i] + (n > 1 ? '{' + n + ',}' : '+');
    i = j;
  }
  return new RegExp('^' + p + '$');
}
function flexIndex(set) { return [...set].map(w => [w, flexRe(w)]); }
const PROFANITY_FLEX = flexIndex(PROFANITY);
const SLURS_FLEX = flexIndex(SLURS);

function bannedForm(t, set) {
  if (set.has(t)) return t;
  const idx = set === SLURS ? SLURS_FLEX : set === PROFANITY ? PROFANITY_FLEX : flexIndex(set);
  for (let i = 0; i < idx.length; i++) {
    if (idx[i][1].test(t)) return idx[i][0];
  }
  return null;
}

function bannedHits(toks, extra, set) {
  const h = [];
  toks.forEach(t => { const m = bannedForm(t, set); if (m) h.push(m); });
  extra.forEach(t => {
    const c = t.replace(/\s+/g, '');
    const m = bannedForm(t, set) || bannedForm(c, set);
    if (m) h.push(m);
  });
  return h;
}

function insulting(hits, spaced) {
  for (let i = 0; i < hits.length; i++) {
    const w = hits[i];
    if (new RegExp('\\b(?:you|your|ya|those|these|them)\\s+' + w + '\\b').test(spaced)) return true;
  }
  return false;
}

function onlyBanned(toks, set) {
  const content = toks.filter(t => !STOP.has(t));
  return content.length > 0 && content.every(t => !!bannedForm(t, set));
}

function verdictSlur(toks, extra, spaced) {
  const hits = bannedHits(toks, extra, SLURS);
  if (!hits.length) return null;
  if (onlyBanned(toks, SLURS) || insulting(hits, spaced)) return { action: 'reject', rule: 'slur' };
  if (hits.length >= 2 && hits.length / Math.max(toks.length, 1) >= 0.4) return { action: 'reject', rule: 'slur' };
  return { action: 'hold', rule: 'slur' };
}

function verdictProfanity(toks, extra, spaced) {
  const hits = bannedHits(toks, extra, PROFANITY);
  if (!hits.length) return null;
  if (MENTION_RE.test(spaced) && !insulting(hits, spaced) && !onlyBanned(toks, PROFANITY)) {
    return { action: 'hold', rule: 'profanity' };
  }
  return { action: 'reject', rule: 'profanity' };
}

function classify(text) {
  const norm = normalize(text);
  const toks = tokens(norm);
  const extra = phrases(toks);
  const spaced = toks.join(' ');
  for (const t of extra) {
    if (PHRASES.indexOf(t) >= 0) return { action: 'reject', rule: 'hate' };
  }
  for (const t of PHRASES) {
    if ((' ' + spaced + ' ').indexOf(' ' + t + ' ') >= 0) return { action: 'reject', rule: 'hate' };
  }
  const slur = verdictSlur(toks, extra, spaced);
  if (slur) return slur;
  const prof = verdictProfanity(toks, extra, spaced);
  if (prof) return prof;
  for (const re of HOLD_RE) {
    if (re.test(spaced)) return { action: 'hold', rule: 'hate' };
  }
  return { action: 'ok', rule: '' };
}

function publicOk(text, restored) {
  if (restored) return true;
  return classify(text).action === 'ok';
}

module.exports = { classify, normalize, tokens, PROFANITY, SLURS, VERSION, publicOk };
