// Metadata stripping for uploaded images that are shown publicly or passed on: listing photos and logos
// (api/listings.js), news-tip photos (api/_submit.js) and ad creatives (api/_creative.js). Browsers already re-encode
// listing and tip photos through a canvas, which drops metadata; this is the server-side guarantee for any request.
// Plain Buffer work: no dependency, no decoding, output never larger than the input (plus a few bytes at most).
//   clean(type, buf)      -> a Buffer without metadata, or null when buf isn't a well-formed image of that type
//   cleanDataUrl(url)     -> the same for a data:image/(jpeg|png|webp);base64 URL, or '' when it isn't one
// JPEG: drops Exif and XMP (APP1: GPS position, camera, time), every other APPn except JFIF (APP0), the ICC colour
//       profile (APP2) and Adobe colour (APP14), comments, and anything after the end-of-image marker. A non-upright
//       Exif orientation is kept as a minimal Exif block holding only that tag, so phone photos still display upright.
// PNG:  keeps only the chunks that affect how the image looks; drops text, eXIf, time and private chunks.
// WebP: keeps the image, alpha, colour-profile and animation chunks; drops EXIF, XMP and unknown chunks and clears the
//       EXIF and XMP flags.
'use strict';

const u16 = (b, i, le) => le ? b.readUInt16LE(i) : b.readUInt16BE(i);
const u32 = (b, i, le) => le ? b.readUInt32LE(i) : b.readUInt32BE(i);

// The Orientation tag (1-8) of an Exif APP1 payload (after "Exif\0\0"), or 1.
function exifOrientation(t) {
  if (t.length < 8) return 1;
  const tag = t.toString('ascii', 0, 2), le = tag === 'II';
  if (!le && tag !== 'MM') return 1;
  const ifd = u32(t, 4, le);
  if (ifd + 2 > t.length) return 1;
  const n = u16(t, ifd, le);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return 1;
    if (u16(t, e, le) === 0x0112) { const v = u16(t, e + 8, le); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}
// An APP1 segment with only the Orientation tag (big-endian TIFF, one IFD entry of type SHORT).
function orientationSegment(o) {
  const s = Buffer.alloc(36);
  s.writeUInt16BE(0xffe1, 0); s.writeUInt16BE(34, 2);
  s.write('Exif\0\0MM\0*', 4, 'binary'); s.writeUInt32BE(8, 14);
  s.writeUInt16BE(1, 18); s.writeUInt16BE(0x0112, 20); s.writeUInt16BE(3, 22); s.writeUInt32BE(1, 24); s.writeUInt16BE(o, 28);
  return s;
}

const isSof = m => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const startsWith = (b, i, s) => b.toString('binary', i, i + s.length) === s;
function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out = [b.subarray(0, 2)];
  let i = 2, frame = false, scan = false, end = false, orient = 1, jfif = false;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (i + 1 < b.length && b[i + 1] === 0xff) i++; // fill bytes
    if (i + 1 >= b.length) return null;
    const m = b[i + 1];
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); end = true; break; }
    if (m === 0xd8) return null;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (i + 4 > b.length) return null;
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    const body = i + 4, seg = b.subarray(i, i + 2 + len);
    let keep = true;
    if (m === 0xe1) { keep = false; if (orient === 1 && startsWith(b, body, 'Exif\0\0')) orient = exifOrientation(b.subarray(body + 6, i + 2 + len)); }
    else if (m === 0xe0) { keep = startsWith(b, body, 'JFIF\0'); if (keep && out.length === 1) jfif = true; }
    else if (m === 0xe2) keep = startsWith(b, body, 'ICC_PROFILE\0');
    else if (m === 0xee) keep = startsWith(b, body, 'Adobe');
    else if ((m >= 0xe3 && m <= 0xef) || m === 0xfe) keep = false;
    if (keep) out.push(seg);
    if (isSof(m)) frame = true;
    i += 2 + len;
    if (m === 0xda) { // entropy-coded data runs to the next marker that isn't stuffing (FF00) or a restart
      if (!frame) return null;
      scan = true;
      let j = i;
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++;
      if (j + 1 >= b.length) return null;
      out.push(b.subarray(i, j));
      i = j;
    }
  }
  if (!end || !frame || !scan) return null;
  if (orient !== 1) out.splice(jfif ? 2 : 1, 0, orientationSegment(orient));
  return Buffer.concat(out);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'cLLI', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT']);
function png(b) {
  if (b.length < 8 + 25 || !b.subarray(0, 8).equals(PNG_SIG)) return null;
  const out = [PNG_SIG];
  let i = 8, first = true, end = false, data = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), t = b.toString('latin1', i + 4, i + 8);
    if (!/^[A-Za-z]{4}$/.test(t) || len > 0x7fffffff || i + 12 + len > b.length) return null;
    if (first && t !== 'IHDR') return null;
    first = false;
    if (PNG_KEEP.has(t)) out.push(b.subarray(i, i + 12 + len));
    if (t === 'IDAT') data = true;
    i += 12 + len;
    if (t === 'IEND') { end = true; break; }
  }
  return end && data ? Buffer.concat(out) : null;
}

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'ALPH', 'ICCP', 'ANIM', 'ANMF']);
function webp(b) {
  if (b.length < 20 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const size = b.readUInt32LE(4);
  if (size < 4 || 8 + size > b.length) return null;
  const out = [];
  let i = 12, image = false;
  while (i + 8 <= 8 + size) {
    const t = b.toString('latin1', i, i + 4), len = b.readUInt32LE(i + 4), next = i + 8 + len + (len & 1);
    if (i + 8 + len > 8 + size) return null;
    if (t === 'VP8 ' || t === 'VP8L' || t === 'ANMF') image = true;
    if (t === 'VP8X') { const c = Buffer.from(b.subarray(i, next)); c[8] &= ~0x0c; out.push(c); }
    else if (WEBP_KEEP.has(t)) out.push(b.subarray(i, Math.min(next, 8 + size)));
    i = next;
  }
  if (!image) return null;
  const body = Buffer.concat(out), head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

function clean(type, buf) {
  if (!Buffer.isBuffer(buf)) return null;
  try {
    switch (type) {
      case 'jpeg': return jpeg(buf);
      case 'png': return png(buf);
      case 'webp': return webp(buf);
      default: return null;
    }
  } catch (e) { return null; } // a read past the end of a damaged file
}
const DATA_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
function cleanDataUrl(url) {
  const m = DATA_RE.exec(String(url || ''));
  if (!m) return '';
  const c = clean(m[1], Buffer.from(m[2], 'base64'));
  return c ? 'data:image/' + m[1] + ';base64,' + c.toString('base64') : '';
}

module.exports = { clean, cleanDataUrl, exifOrientation };
