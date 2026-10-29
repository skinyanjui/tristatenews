// HTML and inline-JSON escaping for every page and email the functions build (one rule set, so no copy drifts).
//   esc(s)        text or a double- or single-quoted attribute value: & < > " ' escaped; null/undefined -> ''
//   jsonScript(v) JSON for inside <script type="application/json">: nothing in it can end the element or the
//                 script (<, >, & as \u escapes, and U+2028/U+2029)
'use strict';
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => MAP[c]);
const jsonScript = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
module.exports = { esc, jsonScript };
