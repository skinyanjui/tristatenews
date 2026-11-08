// Deterministic comment rules. Not a hate-speech model: slurs/profanity reject; a few violence+group
// phrases hold for a person. Identity mentions, mild damn/hell, anti-hate, and ordinary criticism stay ok.
// Whole tokens/phrases after normalize — never a substring scan of the compact string (Scunthorpe).
'use strict';

const ZW = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u180E]/g;
const LEET = { '@': 'a', '4': 'a', '$': 's', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '5': 's', '7': 't' };

const PROFANITY = split('fuck fucking fucked fucker fuckers motherfucker motherfuckers motherfucking shit shits bullshit asshole assholes cocksucker cocksuckers cunt cunts fck fuk');
const SLURS = split(
  'nigger niggers nigga niggas spic spics kike kikes chink chinks gook gooks wetback wetbacks beaner beaners paki pakis raghead ragheads towelhead towelheads faggot faggots fag fags dyke dykes tranny trannies shemale shemales retard retards retarded mongoloid mongoloids'
);
const PHRASES = ['heil hitler', 'white power', 'gas the jews', 'kill all jews', 'kill all muslims'];

const GROUP = 'black people|blacks|african americans|jews|jewish people|muslims|gays|gay people|lesbians|trans people|transgender people|mexicans|hispanics|asians|immigrants|refugees|disabled people';
const HOLD_RE = [
  new RegExp('\\b(?:kill|murder|lynch|gas|exterminate|deport)\\s+all\\s+(?:the\\s+)?(?:' + GROUP + ')\\b', 'i'),
  new RegExp('\\b(?:' + GROUP + ')\\s+(?:should|must|need to)\\s+(?:die|burn|hang|leave)\\b', 'i'),
  new RegExp('\\bi\\s+hate\\s+(?:all\\s+)?(?:' + GROUP + ')\\b', 'i')
];

function split(s) { return new Set(s.split(/\s+/).filter(Boolean)); }

function leetChar(c) { return LEET[c] || c; }

function normalize(text) {
  let s = String(text || '').normalize('NFKC').replace(ZW, '').toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) out += leetChar(s[i]);
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

function classify(text) {
  const norm = normalize(text);
  const toks = tokens(norm);
  const extra = phrases(toks);
  const spaced = toks.join(' ');
  for (const t of toks) {
    if (SLURS.has(t)) return { action: 'reject', rule: 'slur' };
    if (PROFANITY.has(t)) return { action: 'reject', rule: 'profanity' };
  }
  for (const t of extra) {
    if (SLURS.has(t) || PROFANITY.has(t.replace(/\s+/g, ''))) return { action: 'reject', rule: t.includes(' ') ? 'profanity' : 'slur' };
    if (PHRASES.indexOf(t) >= 0) return { action: 'reject', rule: 'hate' };
  }
  for (const t of PHRASES) {
    if ((' ' + spaced + ' ').indexOf(' ' + t + ' ') >= 0) return { action: 'reject', rule: 'hate' };
  }
  for (const re of HOLD_RE) {
    if (re.test(spaced)) return { action: 'hold', rule: 'hate' };
  }
  return { action: 'ok', rule: '' };
}

module.exports = { classify, normalize, tokens, PROFANITY, SLURS };
