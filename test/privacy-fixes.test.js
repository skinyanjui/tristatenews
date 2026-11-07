// Privacy fixes: image metadata stripped on the server (api/_imgmeta.js and the three upload paths), newsletter
// retention that doesn't wait for the admin (prune on signup and on the scheduled refresh, unsubscribe deletes the
// confirmation record, a bounded sweep of older ones), rate-limit keys that never hold a raw IP, and the policy text.
// No network: the store is a fake in-process pipeline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const M = require('../api/_imgmeta.js');

// ---------- JPEG fixtures ----------
const seg = (marker, payload) => { const p = Buffer.from(payload, 'latin1'), h = Buffer.alloc(4); h.writeUInt16BE(0xff00 | marker, 0); h.writeUInt16BE(p.length + 2, 2); return Buffer.concat([h, p]); };
// An Exif APP1 payload: IFD0 with Orientation and a GPS pointer, then a GPS IFD with a latitude reference.
function exifPayload(orientation, le) {
  const t = Buffer.alloc(64), w16 = (v, i) => le ? t.writeUInt16LE(v, i) : t.writeUInt16BE(v, i), w32 = (v, i) => le ? t.writeUInt32LE(v, i) : t.writeUInt32BE(v, i);
  t.write(le ? 'II' : 'MM', 0, 'latin1'); w16(42, 2); w32(8, 4);
  w16(2, 8); w16(0x0112, 10); w16(3, 12); w32(1, 14); w16(orientation, 18);
  w16(0x8825, 22); w16(4, 24); w32(1, 26); w32(38, 30); w32(0, 34);
  w16(1, 38); w16(0x0001, 40); w16(2, 42); w32(2, 44); t.write('N\0', 48, 'latin1'); w32(0, 52);
  return 'Exif\0\0' + t.toString('latin1') + 'GPS-37.9716N-87.5711W';
}
const sof = seg(0xc0, '\x08\x00\x10\x00\x10\x01\x01\x11\x00'), dqt = seg(0xdb, '\x00' + '\x01'.repeat(64)), dht = seg(0xc4, '\x00' + '\x01' + '\x00'.repeat(15) + '\x00');
const sos = seg(0xda, '\x01\x01\x00\x00\x3f\x00'), scanData = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);
function jpeg(extra = [], tail = Buffer.alloc(0)) {
  return Buffer.concat([SOI, seg(0xe0, 'JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00'), ...extra, dqt, sof, dht, sos, scanData, EOI, tail]);
}
const has = (b, s) => b.includes(Buffer.from(s, 'latin1'));

test('JPEG: Exif (GPS), XMP, Photoshop and comments are removed; the image data is untouched', () => {
  const dirty = jpeg([seg(0xe1, exifPayload(1, false)), seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Evansville</x:xmpmeta>'), seg(0xed, 'Photoshop 3.0\0IPTC by Jane'), seg(0xfe, 'shot at 1 Main St')], Buffer.from('trailing secret'));
  const c = M.clean('jpeg', dirty);
  assert.ok(c);
  for (const s of ['Exif', 'GPS-37', 'xmpmeta', 'Photoshop', 'IPTC', '1 Main St', 'trailing secret']) assert.ok(!has(c, s), s + ' removed');
  assert.ok(c.equals(jpeg()), 'what is left is exactly the clean file');
  assert.ok(c.subarray(-2).equals(EOI));
});

test('JPEG: a non-upright orientation survives as a minimal Exif block, big- or little-endian source', () => {
  for (const le of [false, true]) {
    const c = M.clean('jpeg', jpeg([seg(0xe1, exifPayload(6, le))]));
    assert.ok(c && !has(c, 'GPS'), 'no GPS');
    const at = c.indexOf(Buffer.from('Exif\0\0', 'latin1'));
    assert.ok(at > 0 && c.indexOf(Buffer.from('JFIF', 'latin1')) < at, 'kept after JFIF');
    assert.equal(c.readUInt16BE(at - 2), 34, 'segment holds only the orientation');
    assert.equal(M.exifOrientation(c.subarray(at + 6, at + 32)), 6);
  }
  assert.ok(!has(M.clean('jpeg', jpeg([seg(0xe1, exifPayload(1, true))])), 'Exif'), 'upright needs no Exif at all');
});

test('JPEG: ICC colour profile and Adobe colour segments stay; other APP2 data goes', () => {
  const c = M.clean('jpeg', jpeg([seg(0xe2, 'ICC_PROFILE\0\x01\x01profile'), seg(0xe2, 'MPF\0more pictures'), seg(0xee, 'Adobe\0\x64\x00\x00\x00\x00\x01')]));
  assert.ok(has(c, 'ICC_PROFILE') && has(c, 'Adobe'));
  assert.ok(!has(c, 'MPF'));
});

test('JPEG: malformed files are refused, a real progressive JPEG is unchanged', () => {
  const good = jpeg();
  assert.equal(M.clean('jpeg', good.subarray(0, good.length - 2)), null, 'no end marker');
  assert.equal(M.clean('jpeg', Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff, 0x00])])), null, 'segment longer than the file');
  assert.equal(M.clean('jpeg', Buffer.concat([SOI, sos, scanData, EOI])), null, 'scan before any frame');
  assert.equal(M.clean('jpeg', Buffer.concat([SOI, dqt, EOI])), null, 'no image');
  assert.equal(M.clean('jpeg', Buffer.from('not a jpeg at all')), null);
  assert.equal(M.clean('jpeg', 'string'), null);
  const og = fs.readFileSync(path.join(root, 'public/og-image.jpg'));
  assert.ok(M.clean('jpeg', og).equals(og), 'a file without metadata comes back byte for byte');
  const withExif = Buffer.concat([og.subarray(0, 20), seg(0xe1, exifPayload(1, false)), seg(0xfe, 'comment'), og.subarray(20)]);
  assert.ok(M.clean('jpeg', withExif).equals(og));
});

// ---------- PNG and WebP ----------
const chunk = (t, data) => { const d = Buffer.from(data, 'latin1'), h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); h.write(t, 4, 'latin1'); return Buffer.concat([h, d, Buffer.alloc(4)]); };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = chunk('IHDR', '\0\0\0\x10\0\0\0\x10\x08\x02\0\0\0');
test('PNG: text, eXIf, time and private chunks go; rendering chunks stay', () => {
  const clean = Buffer.concat([PNG_SIG, ihdr, chunk('sRGB', '\0'), chunk('pHYs', '\0'.repeat(9)), chunk('IDAT', 'pixels'), chunk('IEND', '')]);
  const dirty = Buffer.concat([PNG_SIG, ihdr, chunk('tEXt', 'Author\0Jane'), chunk('sRGB', '\0'), chunk('eXIf', 'MM\0*GPS'), chunk('pHYs', '\0'.repeat(9)), chunk('iTXt', 'XML:com.adobe.xmp\0'), chunk('tIME', '1234567'), chunk('prVt', 'x'), chunk('IDAT', 'pixels'), chunk('zTXt', 'c\0\0z'), chunk('IEND', ''), Buffer.from('after')]);
  assert.ok(M.clean('png', dirty).equals(clean));
  assert.equal(M.clean('png', Buffer.concat([PNG_SIG, ihdr, chunk('IDAT', 'p')])), null, 'no IEND');
  assert.equal(M.clean('png', Buffer.concat([PNG_SIG, chunk('IDAT', 'p'), ihdr, chunk('IEND', '')])), null, 'IHDR not first');
});

const riff = chunks => { const body = Buffer.concat(chunks), h = Buffer.alloc(12); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(body.length + 4, 4); h.write('WEBP', 8, 'latin1'); return Buffer.concat([h, body]); };
const wchunk = (t, data) => { const d = Buffer.from(data, 'latin1'), h = Buffer.alloc(8); h.write(t, 0, 'latin1'); h.writeUInt32LE(d.length, 4); return Buffer.concat([h, d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
test('WebP: EXIF and XMP chunks go, their flags are cleared, the RIFF size is right', () => {
  const vp8x = flags => wchunk('VP8X', String.fromCharCode(flags) + '\0\0\0' + '\x0f\0\0\x0f\0\0');
  const c = M.clean('webp', riff([vp8x(0x0c | 0x10), wchunk('ALPH', 'a'), wchunk('VP8 ', 'frame'), wchunk('EXIF', 'MM\0*GPS'), wchunk('XMP ', '<x:xmpmeta/>')]));
  assert.ok(c.equals(riff([vp8x(0x10), wchunk('ALPH', 'a'), wchunk('VP8 ', 'frame')])));
  assert.equal(c.readUInt32LE(4), c.length - 8);
  assert.equal(M.clean('webp', riff([wchunk('EXIF', 'x')])), null, 'no image');
});

test('cleanDataUrl keeps the type and refuses anything that isn\'t a well-formed image', () => {
  const url = 'data:image/jpeg;base64,' + jpeg([seg(0xe1, exifPayload(1, false))]).toString('base64');
  assert.equal(M.cleanDataUrl(url), 'data:image/jpeg;base64,' + jpeg().toString('base64'));
  assert.equal(M.cleanDataUrl('data:image/jpeg;base64,' + Buffer.from('nope'.repeat(40)).toString('base64')), '');
  assert.equal(M.cleanDataUrl('data:image/gif;base64,R0lGOD'), '');
});

// ---------- the upload paths ----------
test('listing photos and logos, and tip photos, are stored without metadata; damaged ones are dropped', () => {
  const L = require('../api/listings.js'), S = require('../api/_submit.js');
  const dirty = 'data:image/jpeg;base64,' + jpeg([seg(0xe1, exifPayload(3, false)), seg(0xfe, 'my address')]).toString('base64');
  for (const out of [L.goodImage(dirty, 190000), S.validate({ headline: 'Water main break', details: 'x'.repeat(40), town: 'Evansville', name: 'Jo', email: 'jo@example.com', consent: true, photos: [dirty] }).photos[0]]) {
    const b = Buffer.from(out.split(',')[1], 'base64');
    assert.ok(!has(b, 'my address') && !has(b, 'GPS'));
    assert.equal(M.exifOrientation(b.subarray(b.indexOf(Buffer.from('Exif\0\0', 'latin1')) + 6)), 3);
  }
  const broken = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 1)]).toString('base64');
  assert.equal(L.goodImage(broken, 190000), '');
  assert.equal(S.validate({ headline: 'Water main break', details: 'x'.repeat(40), town: 'Evansville', name: 'Jo', email: 'jo@example.com', consent: true, photos: [broken] }).photos.length, 0);
  const lsrc = read('api/listings.js'), csrc = read('api/_creative.js');
  assert.ok(lsrc.includes("out = cleanImage('jpeg', raw) || raw"), 'stored photos are cleaned on the way out');
  assert.ok(csrc.includes('cleanImage(m[1].slice(6), raw) || raw') && csrc.includes("['SET', K.img(id), files.image,"), 'creatives cleaned on upload and on the way out');
});

// ---------- newsletter retention ----------
function fakeStore() {
  const kv = new Map(), sets = new Map(), zsets = new Map(), log = [];
  const set = k => { if (!sets.has(k)) sets.set(k, new Set()); return sets.get(k); };
  const run = ([op, k, ...a]) => {
    log.push([op, k, ...a]);
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'SET': if (a.includes('NX') && kv.has(k)) return { result: null }; kv.set(k, a[0]); return { result: 'OK' };
      case 'DEL': return { result: kv.delete(k) ? 1 : 0 };
      case 'INCR': kv.set(k, (Number(kv.get(k)) || 0) + 1); return { result: kv.get(k) };
      case 'EXPIRE': return { result: 1 };
      case 'SADD': return { result: set(k).has(a[0]) ? 0 : (set(k).add(a[0]), 1) };
      case 'SREM': return { result: set(k).delete(a[0]) ? 1 : 0 };
      case 'SISMEMBER': return { result: set(k).has(a[0]) ? 1 : 0 };
      case 'SMISMEMBER': return { result: a.map(m => set(k).has(m) ? 1 : 0) };
      case 'SSCAN': { const all = [...set(k)], from = Number(a[0]), n = Number(a[2]); const next = from + n >= all.length ? 0 : from + n; return { result: [String(next), all.slice(from, from + n)] }; }
      case 'ZADD': { const z = zsets.get(k) || new Map(); zsets.set(k, z); z.set(a[1], Number(a[0])); return { result: 1 }; }
      case 'ZREM': return { result: (zsets.get(k) || new Map()).delete(a[0]) ? 1 : 0 };
      case 'ZREMRANGEBYSCORE': { const z = zsets.get(k) || new Map(); let n = 0; for (const [m, s] of z) if (s >= Number(a[0]) && s <= Number(a[1])) { z.delete(m); n++; } return { result: n }; }
      default: throw new Error('fake store: ' + op);
    }
  };
  return { kv, sets, zsets, log, pipeline: async cmds => cmds.map(run) };
}
function withNewsletter(fn) {
  const f = fakeStore(), store = require('../api/_store.js');
  const saved = { pipeline: store.pipeline, stored: store.stored };
  store.pipeline = f.pipeline; store.stored = () => true;
  for (const m of ['../api/_subscribe.js', '../api/unsubscribe.js']) delete require.cache[require.resolve(m)];
  const restore = () => { Object.assign(store, saved); for (const m of ['../api/_subscribe.js', '../api/unsubscribe.js']) delete require.cache[require.resolve(m)]; };
  return Promise.resolve(fn(f, require('../api/_subscribe.js'), require('../api/unsubscribe.js'))).finally(restore);
}
const res = () => { const r = { code: 0, body: null }; r.setHeader = () => {}; r.status = c => { r.code = c; return r; }; r.json = o => { r.body = o; return r; }; return r; };
const post = async (h, body, ip = '203.0.113.7') => { const r = res(); await h({ method: 'POST', body, query: {}, headers: { 'x-forwarded-for': ip } }, r); return r; };

test('newsletter: every signup prunes week-old pending entries and re-arms the pending set\'s own 7-day TTL', () => withNewsletter(async (f, S) => {
  const old = Date.now() - 8 * 864e5;
  f.zsets.set(S.K.pending, new Map([['stale@example.com', old], ['fresh@example.com', Date.now() - 864e5]]));
  const r = await post(S, { email: 'new@example.com' });
  assert.equal(r.code, 200);
  assert.deepEqual([...f.zsets.get(S.K.pending).keys()].sort(), ['fresh@example.com', 'new@example.com']);
  assert.ok(f.log.some(c => c[0] === 'EXPIRE' && c[1] === S.K.pending && c[2] === String(7 * 86400)));
  assert.match(r.body.message, /confirmation emails aren’t switched on yet/);
  assert.match(r.body.message, /deleted after 7 days/);
  assert.ok(!f.log.some(c => c.some(x => String(x).includes('203.0.113.7'))), 'no raw address reaches the store');
}));

test('newsletter: unsubscribe deletes the confirmation record and keeps only the do-not-email entry', () => withNewsletter(async (f, S, U) => {
  f.sets.set(S.K.subs, new Set(['reader@example.com'])); f.sets.set(S.K.confirmed, new Set(['reader@example.com']));
  f.kv.set(S.K.rec('reader@example.com'), JSON.stringify({ confirmedAt: '2026-11-01T00:00:00.000Z' }));
  const r = await post(U, { email: 'Reader@example.com' });
  assert.equal(r.code, 200);
  assert.ok(!f.kv.has(S.K.rec('reader@example.com')));
  assert.deepEqual([...f.sets.get(S.K.unsubs)], ['reader@example.com']);
  assert.ok(!f.sets.get(S.K.subs).has('reader@example.com'));
}));

test('newsletter: sweep clears records left by earlier unsubscribes in bounded batches, then stops', () => withNewsletter(async (f, S) => {
  const left = Array.from({ length: S.SWEEP_BATCH + 5 }, (_, i) => 'gone' + i + '@example.com');
  f.sets.set(S.K.unsubs, new Set(left));
  for (const e of left) f.kv.set(S.K.rec(e), '{}');
  f.sets.get(S.K.unsubs).delete('gone3@example.com'); // left, then confirmed again: off the list, record kept
  const first = await S.sweep();
  assert.ok(first.commands <= S.SWEEP_BATCH + 4, 'one batch per run');
  assert.notEqual(f.kv.get(S.K.sweep), 'done');
  await S.sweep();
  assert.equal(f.kv.get(S.K.sweep), 'done');
  assert.deepEqual(left.filter(e => f.kv.has(S.K.rec(e))), ['gone3@example.com']);
  const n = f.log.length;
  assert.deepEqual(await S.sweep(), { requests: 1, commands: 1 });
  assert.equal(f.log.length, n + 1, 'after a full pass, one GET');
  assert.deepEqual(S.pruneCmds(1e12), [['ZREMRANGEBYSCORE', S.K.pending, '0', String(1e12 - 7 * 864e5)]]);
  assert.ok(read('api/_refresh.js').includes('newsletter.pruneCmds(Date.now())') && read('api/_refresh.js').includes('await newsletter.sweep()'));
}));

// ---------- rate-limit keys ----------
test('rate-limit keys hold a keyed hash of the address, never the address; thresholds and TTLs unchanged', () => {
  const IP = require('../api/_ip.js');
  assert.match(IP.rlId('203.0.113.7', 'subscribe'), /^[0-9a-f]{24}$/);
  assert.notEqual(IP.rlId('203.0.113.7', 'subscribe'), IP.rlId('203.0.113.7', 'submit'), 'separate per endpoint');
  const saved = { ...process.env };
  try {
    for (const k of ['LISTINGS_ADMIN_KEY', 'CRON_SECRET', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN']) delete process.env[k];
    const local = IP.rlId('203.0.113.7', 'x');
    process.env.KV_REST_API_TOKEN = 'store-token';
    assert.notEqual(IP.rlId('203.0.113.7', 'x'), local, 'with a store, its server-only token keys the hash');
  } finally { process.env = saved; }
  for (const f of ['api/_subscribe.js', 'api/unsubscribe.js', 'api/listings.js', 'api/_submit.js', 'api/_advertise.js', 'api/_packages.js', 'api/_creative.js']) {
    const s = read(f);
    assert.ok(!/'tsn:[a-z:]+' \+ ip\b/.test(s) && !/rl(ip)?:' \+ ip\b/.test(s), f + ' has no raw-IP key');
    assert.ok(s.includes("'86400', 'NX'"), f + ' keeps the 24-hour window');
  }
  assert.ok(read('api/_subscribe.js').includes('DAILY_PER_IP = 5') && read('api/listings.js').includes('DAILY_PER_IP = 8') && read('api/_submit.js').includes('DAILY_PER_IP = 5'));
});

// ---------- policy text ----------
test('privacy notice: self-hosted fonts, metadata removal, hashed addresses, identity filled in the page itself', () => {
  const h = read('public/legal.html'), text = h.replace(/<[^>]+>/g, '');
  assert.ok(!h.includes('Google Fonts'));
  assert.ok(text.includes('Our fonts (Geist) are served from our own site, so no font service sees your visit.'));
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(h));
  assert.ok(text.includes('We remove location, camera and other hidden details (metadata) from photos and logos before we store them'));
  assert.ok(text.includes('we remove location, camera and other hidden details, or metadata, from them before we store or email them'));
  assert.ok(text.includes('We keep only a scrambled, one-way code made from the address'));
  assert.ok(text.includes('After you leave we keep only your address on a do-not-email list'));
  const body = h.slice(h.indexOf('<body'));
  assert.ok(!body.includes('[LEGAL ENTITY NAME]') && !body.includes('[MAILING ADDRESS]') && !body.includes('[COUNTY]'), 'readers without script see the real values');
  assert.ok(h.includes('<span data-ph="entity">TristateNow.com</span>') && h.includes('<span data-ph="address">P.O. Box 15, Evansville, Indiana 47714</span>'));
  assert.ok(body.includes('[DMCA AGENT NAME]') && body.includes('[DMCA AGENT EMAIL]'), 'unknown fields stay flagged for the owner');
});
