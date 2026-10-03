// Minimal PNG writer and reader (8-bit RGB / RGBA, not interlaced), on top of fflate's zlib.

import { unzlibSync, zlibSync } from '../vendor/fflate.js';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Encode RGBA bytes as a PNG. `channels` 4 writes RGBA ("32-bit"), 3 drops alpha.
 * Each row uses whichever filter gives the smallest sum of bytes, as libpng does.
 */
export function encodePNG(rgba, w, h, { channels = 4, level = 6 } = {}) {
  const bpp = channels, stride = w * bpp, raw = new Uint8Array(h * (stride + 1));
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride), cand = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let c = 0; c < bpp; c++) cur[x * bpp + c] = rgba[(y * w + x) * 4 + c];
    let best = 0, bestScore = Infinity, bestRow = null;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (cur[i] - pred) & 0xff;
        cand[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; bestRow = cand.slice(); }
    }
    raw[y * (stride + 1)] = best;
    raw.set(bestRow, y * (stride + 1) + 1);
    prev.set(cur);
  }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Width, height, bit depth and colour type from the IHDR chunk. */
export function pngInfo(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20), bitDepth: bytes[24], colorType: bytes[25] };
}

/** Decode an 8-bit RGB or RGBA PNG (the kind encodePNG writes) to RGBA bytes. */
export function decodePNG(bytes) {
  const info = pngInfo(bytes), { width: w, height: h } = info;
  if (info.bitDepth !== 8 || ![2, 6].includes(info.colorType)) throw new Error('only 8-bit RGB/RGBA PNGs are supported');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat = [];
  for (let o = 8; o < bytes.length;) {
    const len = v.getUint32(o), type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    if (type === 'IDAT') idat.push(bytes.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const z = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of idat) { z.set(p, o); o += p.length; }
  const raw = unzlibSync(z), bpp = info.colorType === 6 ? 4 : 3, stride = w * bpp;
  const px = new Uint8Array(h * stride), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0, b = y ? px[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y ? px[(y - 1) * stride + i - bpp] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      px[y * stride + i] = (row[i] + pred) & 0xff;
    }
  }
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = px[i * bpp + c];
    out[i * 4 + 3] = bpp === 4 ? px[i * 4 + 3] : 255;
  }
  return { width: w, height: h, rgba: out, colorType: info.colorType };
}
