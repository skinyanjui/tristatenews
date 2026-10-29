// Advertiser lead tracking for the admin inquiry inbox (ads plan 4.2). Pure rules; api/_advertise.js stores them.
//   tsn:ads             the inquiries themselves (capped list, latest 300; unchanged)
//   tsn:lead:<ref>      one inquiry's status, our notes and its history:
//                       { ref, status, notes: [{ at, text }], history: [{ at, action, from, to, note }], updatedAt }
//                       kept KEEP_DAYS after the last change (the expiry is reset on every change)
//   tsn:lead:log        the activity log across all leads, latest LOG_MAX entries
// An inquiry with no record is 'new'. Only an admin (x-admin-key) can change a lead, and only for an inquiry that is
// in tsn:ads. Nothing here sends email: a status change or a note never contacts the advertiser.
const STATUSES = ['new', 'contacted', 'proposal_sent', 'won', 'lost', 'spam'];
const LABELS = { new: 'New', contacted: 'Contacted', proposal_sent: 'Proposal sent', won: 'Won', lost: 'Lost', spam: 'Spam' };
const REF_RE = /^AD-[0-9A-Z]{4,12}$/;
const KEEP_DAYS = 400;
const NOTE_MAX = 500, NOTES_MAX = 50, HISTORY_MAX = 100, LOG_MAX = 1000;
const K = { rec: ref => 'tsn:lead:' + ref, log: 'tsn:lead:log' };

const cleanNote = v => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOTE_MAX);

function blank(ref) { return { ref, status: 'new', notes: [], history: [], updatedAt: null }; }

// A stored record, or a blank one for an inquiry nobody has touched. Anything malformed falls back to safe values.
function normalize(ref, rec) {
  const r = rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : {};
  return {
    ref,
    status: STATUSES.includes(r.status) ? r.status : 'new',
    notes: Array.isArray(r.notes) ? r.notes.filter(n => n && typeof n.text === 'string').slice(-NOTES_MAX) : [],
    history: Array.isArray(r.history) ? r.history.filter(h => h && typeof h.action === 'string').slice(-HISTORY_MAX) : [],
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
  };
}

// One admin change. body: { action: 'status', ref, status, note? } or { action: 'note', ref, note }.
// -> { rec, entry } (the new record and its log entry) or { error, code }.
function change(current, body, now) {
  const at = new Date(now).toISOString();
  const rec = normalize(current.ref, current);
  const note = cleanNote(body && body.note);
  if (body.action === 'status') {
    const to = String(body.status || '');
    if (!STATUSES.includes(to)) return { error: 'Pick one of: ' + STATUSES.map(s => LABELS[s]).join(', ') + '.', code: 400 };
    if (to === rec.status) return { error: 'It’s already ' + LABELS[to] + '.', code: 409 };
    const entry = { at, ref: rec.ref, action: 'status', from: rec.status, to, note };
    rec.status = to;
    if (note) rec.notes = rec.notes.concat({ at, text: note }).slice(-NOTES_MAX);
    rec.history = rec.history.concat({ at, action: 'status', from: entry.from, to, note }).slice(-HISTORY_MAX);
    rec.updatedAt = at;
    return { rec, entry };
  }
  if (body.action === 'note') {
    if (note.length < 2) return { error: 'Write a note first.', code: 400 };
    const entry = { at, ref: rec.ref, action: 'note', from: rec.status, to: rec.status, note };
    rec.notes = rec.notes.concat({ at, text: note }).slice(-NOTES_MAX);
    rec.history = rec.history.concat({ at, action: 'note', from: rec.status, to: rec.status, note }).slice(-HISTORY_MAX);
    rec.updatedAt = at;
    return { rec, entry };
  }
  return { error: 'unknown action', code: 400 };
}

// The store commands that save one change.
function saveCommands(rec, entry) {
  return [
    ['SET', K.rec(rec.ref), JSON.stringify(rec), 'EX', String(KEEP_DAYS * 86400)],
    ['LPUSH', K.log, JSON.stringify(entry)],
    ['LTRIM', K.log, '0', String(LOG_MAX - 1)],
  ];
}

function counts(leads) {
  const out = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const l of leads) out[l.status]++;
  return out;
}

module.exports = { STATUSES, LABELS, REF_RE, NOTE_MAX, NOTES_MAX, HISTORY_MAX, K, blank, normalize, change, saveCommands, counts };
