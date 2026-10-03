// Image processing: one picture in, a finished 3x2 MCPatcher sky out.
//
// Stage order:
//   trim edges -> colour -> horizon on the centre line -> mirror-fill the gaps
//   -> panorama -> 3x2 template via MCPatcher geometry -> seam blend -> pole clean-up.
//
// Pure functions with no browser APIs, so the same code runs in the page's worker and in tests.

import { COMPASS_LON, dirToLonLat, lonLatToDir, tilePoint } from './geometry.js';
import {
  clamp, cloneImage, crop, flipH, flipV, gaussianBlur, lum, luminance, makeImage, resizeArea, smoothstep,
} from './image.js';

export const MAX_SOURCE_WIDTH = 4096;
export const FACE_SIZES = [256, 512, 1024, 2048];

export const DEFAULTS = Object.freeze({
  // "Upside down or mirrored"
  flip_h: false,
  flip_v: false,
  // "Odd line or black pixels at the edge": delete imperfect edge rows and black bars
  auto_trim: true,
  edge_trim: 0,            // extra pixels removed from every side
  // "Too dark or too bright"
  brightness: 0,           // -0.5 .. 0.5
  contrast: 1,             // 0.5 .. 1.5
  gamma: 1,                // 0.3 .. 3 (lower = brighter)
  saturation: 1,           // 0 .. 2
  // Horizon on the centre line, a little under the middle
  horizon_y: null,         // horizon row in the trimmed source, as a fraction of its height; null = auto
  horizon_offset: 0.015,   // where the horizon ends up: H/2 + offset*H (positive = lower)
  // "Stretched or squished"
  vscale: 1,               // vertical scale of the picture around the horizon
  coverage: 'stretch',     // "stretch" = one copy around 360 deg; "mirror" = image + mirrored copy
  // Mirror fill of the empty rows
  mirror_blend: 0,         // rows of cross-fade at the mirror line (0 = exact mirror)
  // "Sky rotated wrong" / "Sun or moon in a bad spot"
  yaw: 180,                // degrees around the vertical axis; 180 puts the picture's centre on Front
  sun_target: 'none',      // none / east / west / north / south: turn the sky so a painted sun faces this way
  sun_soften: 0,           // 0..1, tone down a painted sun
  // Blend of the wrap-around border
  seam_fix: true,
  seam_width: 256,         // half-width of the soft eraser, in pixels of a 1024 face
  seam_side: 'auto',       // auto (brighter) / left / right, as seen facing the seam
  // Ghost pixels at the zenith
  pole_radius: 24,         // pixels of a 1024 face
  // Pixels per square
  face_size: 1024,
});

const CHOICES = {
  coverage: ['stretch', 'mirror'],
  seam_side: ['auto', 'left', 'right'],
  sun_target: ['none', ...Object.keys(COMPASS_LON)],
};
const INTS = new Set(['edge_trim', 'mirror_blend', 'seam_width', 'pole_radius', 'face_size']);

/** Settings with every field present and of the right type (accepts strings from form controls). */
export function normalizeSettings(d) {
  const s = { ...DEFAULTS };
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (!d || !(k in d)) continue;
    let v = d[k];
    if (v === null || v === '') {
      if (k === 'horizon_y') s[k] = null;
      continue;
    }
    if (typeof def === 'boolean') v = typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
    else if (typeof def === 'string') v = String(v);
    else {
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      if (INTS.has(k)) v = Math.round(v);
    }
    s[k] = v;
  }
  if (!FACE_SIZES.includes(s.face_size)) s.face_size = 1024;
  for (const [k, opts] of Object.entries(CHOICES)) if (!opts.includes(s[k])) s[k] = DEFAULTS[k];
  return s;
}

// ---------------------------------------------------------------- trim edges

function lineStats(lumArr, w, h, axis, i) {
  // Mean and standard deviation of row i (axis 0) or column i (axis 1).
  const n = axis === 0 ? w : h;
  let s = 0, s2 = 0;
  for (let k = 0; k < n; k++) {
    const v = axis === 0 ? lumArr[i * w + k] : lumArr[k * w + i];
    s += v; s2 += v * v;
  }
  const mean = s / n;
  return [mean, Math.sqrt(Math.max(0, s2 / n - mean * mean))];
}

/** Number of leading lines that are letterbox black. */
function blackRun(lumArr, w, h, axis, fromEnd) {
  const n = axis === 0 ? h : w;
  let run = 0;
  for (let k = 0; k < n; k++) {
    const [mean, std] = lineStats(lumArr, w, h, axis, fromEnd ? n - 1 - k : k);
    if (mean < 0.06 && std < 0.05) run++;
    else break;
  }
  return run;
}

/** Mean absolute difference between lines a and b of the region (x0, y0, w, h). */
function lineDiff(img, x0, y0, w, h, axis, a, b) {
  const d = img.data, n = axis === 0 ? w : h;
  let s = 0;
  for (let k = 0; k < n; k++) {
    const ia = axis === 0 ? ((y0 + a) * img.w + x0 + k) * 3 : ((y0 + k) * img.w + x0 + a) * 3;
    const ib = axis === 0 ? ((y0 + b) * img.w + x0 + k) * 3 : ((y0 + k) * img.w + x0 + b) * 3;
    s += Math.abs(d[ia] - d[ib]) + Math.abs(d[ia + 1] - d[ib + 1]) + Math.abs(d[ia + 2] - d[ib + 2]);
  }
  return s / (n * 3);
}

/** Leading edge lines that differ much more from their neighbour than inner lines do. */
function outlierRun(img, x0, y0, w, h, axis, fromEnd, limit = 4) {
  const n = axis === 0 ? h : w;
  if (n < 16) return 0;
  const line = (k) => (fromEnd ? n - 1 - k : k);
  const inner = [];
  for (let k = 4; k < Math.min(n, 200) - 1; k++) inner.push(lineDiff(img, x0, y0, w, h, axis, line(k), line(k + 1)));
  inner.sort((a, b) => a - b);
  const typical = inner.length ? (inner.length % 2 ? inner[(inner.length - 1) / 2]
    : (inner[inner.length / 2 - 1] + inner[inner.length / 2]) / 2) : 0;
  let run = 0;
  while (run < limit && run + 1 < n) {
    if (lineDiff(img, x0, y0, w, h, axis, line(run), line(run + 1)) > 4 * typical + 0.02) run++;
    else break;
  }
  return run;
}

export function trimEdges(img, auto = true, extra = 0) {
  const { w, h } = img;
  let top = 0, bottom = 0, left = 0, right = 0;
  if (auto) {
    const l = luminance(img);
    top = blackRun(l, w, h, 0, false);
    bottom = blackRun(l, w, h, 0, true);
    left = blackRun(l, w, h, 1, false);
    right = blackRun(l, w, h, 1, true);
    if (top + bottom < h - 16 && left + right < w - 16) {
      const cw = w - left - right, ch = h - top - bottom;
      const t = outlierRun(img, left, top, cw, ch, 0, false), b = outlierRun(img, left, top, cw, ch, 0, true);
      const lf = outlierRun(img, left, top, cw, ch, 1, false), rt = outlierRun(img, left, top, cw, ch, 1, true);
      top += t; bottom += b; left += lf; right += rt;
    }
  }
  extra = Math.max(0, Math.trunc(extra));
  top += extra; bottom += extra; left += extra; right += extra;
  if (top + bottom >= h - 8 || left + right >= w - 8) return { img, trim: [0, 0, 0, 0] };
  return { img: crop(img, left, top, w - left - right, h - top - bottom), trim: [top, right, bottom, left] };
}

// ---------------------------------------------------------------- colour

export function adjustColors(img, s) {
  const out = makeImage(img.w, img.h), d = img.data, o = out.data;
  const g = Math.max(0.05, s.gamma);
  for (let i = 0; i < d.length; i += 3) {
    let r = d[i], gr = d[i + 1], b = d[i + 2];
    if (s.gamma !== 1) { r = Math.pow(clamp(r, 0, 1), g); gr = Math.pow(clamp(gr, 0, 1), g); b = Math.pow(clamp(b, 0, 1), g); }
    if (s.saturation !== 1) {
      const y = lum(r, gr, b);
      r = y + (r - y) * s.saturation; gr = y + (gr - y) * s.saturation; b = y + (b - y) * s.saturation;
    }
    if (s.contrast !== 1 || s.brightness !== 0) {
      r = (r - 0.5) * s.contrast + 0.5 + s.brightness;
      gr = (gr - 0.5) * s.contrast + 0.5 + s.brightness;
      b = (b - 0.5) * s.contrast + 0.5 + s.brightness;
    }
    o[i] = clamp(r, 0, 1); o[i + 1] = clamp(gr, 0, 1); o[i + 2] = clamp(b, 0, 1);
  }
  return out;
}

// ---------------------------------------------------------------- horizon

/**
 * Row of the horizon as a fraction of the height. Picks the row with the strongest change in
 * average colour between the band above and the band below (sky -> water / ground).
 */
export function detectHorizon(img) {
  const small = resizeArea(img, 256, Math.max(32, Math.round(img.h * 256 / img.w)));
  const hs = small.h, rows = new Float32Array(hs * 3), sat = new Float32Array(hs);
  for (let y = 0; y < hs; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 3, r = small.data[i], g = small.data[i + 1], b = small.data[i + 2];
      rows[y * 3] += r / 256; rows[y * 3 + 1] += g / 256; rows[y * 3 + 2] += b / 256;
      sat[y] += (Math.max(r, g, b) - Math.min(r, g, b)) / 256;
    }
  }
  const k = Math.max(2, Math.floor(hs / 40));
  const band = (a, b, c) => { let s = 0; for (let y = a; y < b; y++) s += c < 0 ? sat[y] : rows[y * 3 + c]; return s / (b - a); };
  let best = -1, bestY = Math.floor(hs / 2);
  for (let y = Math.max(k, Math.floor(hs * 0.12)); y < Math.min(hs - k, Math.floor(hs * 0.92)); y++) {
    let score = 0;
    for (let c = 0; c < 3; c++) score += Math.abs(band(y - k, y, c) - band(y, y + k, c));
    score += 0.5 * Math.abs(band(y - k, y, -1) - band(y, y + k, -1));
    score *= 1 - 0.3 * Math.abs(y / hs - 0.55); // mild preference for the middle of the picture
    if (score > best) { best = score; bestY = y; }
  }
  return bestY / hs;
}

/** Move (and optionally scale) the picture so the horizon lands on H/2 + offset*H. The rest is empty. */
export function placeHorizon(img, horizonFrac, offset, vscale) {
  const { w, h } = img;
  vscale = clamp(vscale, 0.25, 4);
  const hy = horizonFrac * h, target = h / 2 + offset * h;
  const canvas = makeImage(w, h), row = w * 3;
  let first = -1, last = -1;
  for (let y = 0; y < h; y++) {
    const ySrc = hy + (y + 0.5 - target) / vscale - 0.5;
    if (ySrc >= -0.5 && ySrc <= h - 0.5) { if (first < 0) first = y; last = y; }
    const ys = clamp(ySrc, 0, h - 1), y0 = Math.floor(ys), y1 = Math.min(y0 + 1, h - 1), t = ys - y0;
    const a = img.data.subarray(y0 * row, (y0 + 1) * row), b = img.data.subarray(y1 * row, (y1 + 1) * row);
    for (let i = 0; i < row; i++) canvas.data[y * row + i] = a[i] * (1 - t) + b[i] * t;
  }
  if (first < 0) return { canvas: cloneImage(img), top: 0, bottom: h - 1 };
  return { canvas, top: first, bottom: last };
}

/** Mirror index i back into [lo, hi] (repeating if the gap is larger than the picture). */
function reflectIndex(i, lo, hi) {
  const n = hi - lo + 1;
  if (n <= 1) return lo;
  const period = 2 * n;
  let j = ((i - lo) % period + period) % period;
  if (j >= n) j = period - 1 - j;
  return lo + j;
}

/**
 * Copy the strip next to each gap, flip it vertically and line it up (like reflecting water).
 * `blend` > 0 moves the mirror line `blend` rows into the picture and cross-fades.
 */
export function fillGaps(canvas, top, bottom, blend = 0) {
  const h = canvas.h, row = canvas.w * 3, out = cloneImage(canvas);
  const copyRow = (dst, src, srcRow, t = 1) => {
    const s = src.data.subarray(srcRow * row, (srcRow + 1) * row), o = dst * row;
    if (t >= 1) out.data.set(s, o);
    else for (let i = 0; i < row; i++) out.data[o + i] = out.data[o + i] * (1 - t) + s[i] * t;
  };
  blend = Math.max(0, Math.trunc(blend));
  if (bottom < h - 1) {
    const b = Math.max(top, bottom - blend);
    for (let y = bottom + 1; y < h; y++) copyRow(y, canvas, reflectIndex(2 * b + 1 - y, top, b));
    for (let y = b + 1; y <= bottom; y++) {
      copyRow(y, canvas, reflectIndex(2 * b + 1 - y, top, b), smoothstep((y - b) / (bottom - b + 1)));
    }
  }
  if (top > 0) {
    const a = Math.min(bottom, top + blend), snap = cloneImage(out);
    for (let y = 0; y < top; y++) copyRow(y, snap, reflectIndex(2 * a - 1 - y, a, bottom));
    for (let y = top; y < a; y++) {
      copyRow(y, snap, reflectIndex(2 * a - 1 - y, a, bottom), smoothstep((a - y) / (a - top + 1)));
    }
  }
  return out;
}

export function applyCoverage(img, coverage) {
  if (coverage !== 'mirror') return img;
  // Picture centre stays in the middle, mirrored copy behind you.
  const { w, h } = img, half = Math.floor(w / 2), out = makeImage(2 * w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 2 * w; x++) {
      let sx;
      if (x < w - half) sx = w - 1 - (half + x);            // flipped[:, w//2:]
      else if (x < 2 * w - half) sx = x - (w - half);       // img
      else sx = w - 1 - (x - (2 * w - half));               // flipped[:, :w//2]
      const s = (y * w + sx) * 3, t = (y * 2 * w + x) * 3;
      out.data[t] = img.data[s]; out.data[t + 1] = img.data[s + 1]; out.data[t + 2] = img.data[s + 2];
    }
  }
  return out;
}

// ---------------------------------------------------------------- sun / moon

/** Brightest compact blob, if there is one that looks like a painted sun or moon. */
export function detectSun(pano) {
  const W = 512, H = 256, small = resizeArea(pano, W, H), l = luminance(small);
  l.fill(0, (H / 2) * W); // ignore the bottom half: a reflection in the water is not where the sun is
  let peak = 0, pi = 0;
  for (let i = 0; i < l.length; i++) if (l[i] > peak) { peak = l[i]; pi = i; }
  if (peak < 0.85) return null;
  const thr = Math.max(0.8, peak - 0.03), py = Math.floor(pi / W), px = pi % W;
  let n = 0, ring = 0, sx = 0, sy = 0;
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W; x++) {
      if (l[y * W + x] < thr) continue;
      const dx = Math.min(Math.abs(x - px), W - Math.abs(x - px)), dy = Math.abs(y - py);
      if (dy < 48 && dx < 48) ring++;
      if (dy < 24 && dx < 24) { n++; sx += x; sy += y; }
    }
  }
  // A sun is a compact blob: most of the bright pixels near the peak, and small overall.
  if (n > 0.01 * l.length || n < 0.6 * ring) return null;
  const u = (sx / n + 0.5) / W, v = (sy / n + 0.5) / H;
  return { u, v, radius: Math.max(2, Math.sqrt(n / Math.PI)) / W, lon: (u - 0.5) * 2 * Math.PI, lat: (0.5 - v) * Math.PI };
}

/** Value below which `p` of the samples of channel c fall (histogram estimate). */
function percentile(img, c, p) {
  const bins = new Uint32Array(1024), d = img.data;
  for (let i = c; i < d.length; i += 3) bins[Math.min(1023, Math.max(0, Math.floor(d[i] * 1024)))]++;
  const want = p * img.w * img.h;
  let acc = 0;
  for (let b = 0; b < 1024; b++) { acc += bins[b]; if (acc >= want) return (b + 0.5) / 1024; }
  return 1;
}

export function softenSun(pano, sun, amount) {
  if (amount <= 0 || !sun) return pano;
  const { w, h } = pano, cx = sun.u * w, cy = sun.v * h, rad = Math.max(4, sun.radius * w * 2.5);
  const sigma = rad * 1.5, reach = Math.ceil(rad * 2 + sigma * 3 + 2);
  const cap = [0, 1, 2].map(c => percentile(pano, c, 0.9));
  // Blur only a patch around the sun (wrapping left-right), then pull the blob towards it.
  const pw = Math.min(w, 2 * reach + 1), py0 = Math.max(0, Math.floor(cy) - reach), py1 = Math.min(h, Math.floor(cy) + reach + 1);
  const px0 = Math.floor(cx) - Math.floor(pw / 2), patch = makeImage(pw, py1 - py0);
  const col = (x) => ((px0 + x) % w + w) % w;
  for (let y = py0; y < py1; y++) {
    for (let x = 0; x < pw; x++) {
      const s = (y * w + col(x)) * 3, t = ((y - py0) * pw + x) * 3;
      patch.data[t] = pano.data[s]; patch.data[t + 1] = pano.data[s + 1]; patch.data[t + 2] = pano.data[s + 2];
    }
  }
  const blurred = gaussianBlur(patch, sigma), out = cloneImage(pano), a = clamp(amount, 0, 1);
  for (let y = py0; y < py1; y++) {
    for (let x = 0; x < pw; x++) {
      const gx = col(x), dx = Math.min(Math.abs(gx + 0.0 - cx), w - Math.abs(gx - cx));
      const m = (1 - smoothstep(Math.hypot(dx, y - cy) / (rad * 2))) * a;
      if (m <= 0) continue;
      const s = (y * w + gx) * 3, t = ((y - py0) * pw + x) * 3;
      for (let c = 0; c < 3; c++) out.data[s + c] = pano.data[s + c] * (1 - m) + Math.min(blurred.data[t + c], cap[c]) * m;
    }
  }
  return out;
}

// ---------------------------------------------------------------- panorama

/** Flip, trim, colour, horizon placement and mirror fill, giving the panorama. */
export function preparePanorama(img, s) {
  const info = { source_size: [img.w, img.h] };
  if (s.flip_h) img = flipH(img);
  if (s.flip_v) img = flipV(img);
  const t = trimEdges(img, s.auto_trim, s.edge_trim);
  info.trim = t.trim;
  img = adjustColors(t.img, s);
  const detected = detectHorizon(img);
  const hy = s.horizon_y == null ? detected : clamp(s.horizon_y, 0.02, 0.98);
  info.horizon_detected = detected;
  info.horizon_used = hy;
  const { canvas, top, bottom } = placeHorizon(img, hy, s.horizon_offset, s.vscale);
  info.gap_rows = [top, canvas.h - 1 - bottom];
  let pano = fillGaps(canvas, top, bottom, Math.round(s.mirror_blend * canvas.h / 1440));
  pano = applyCoverage(pano, s.coverage);
  const sun = detectSun(pano);
  info.sun = sun;
  if (sun && s.sun_soften > 0) pano = softenSun(pano, sun, s.sun_soften);
  info.panorama_size = [pano.w, pano.h];
  return { pano, info };
}

/** Bilinear lookup in an equirectangular image (wraps horizontally). Writes RGB into out[o..o+2]. */
export function samplePano(pano, lon, lat, out, o) {
  const { w, h, data } = pano;
  const x = (lon / (2 * Math.PI) + 0.5) * w - 0.5;
  const y = clamp((0.5 - lat / Math.PI) * h - 0.5, 0, h - 1);
  let x0 = Math.floor(x);
  const y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  x0 = ((x0 % w) + w) % w;
  const x1 = (x0 + 1) % w, y1 = Math.min(y0 + 1, h - 1);
  const a = (y0 * w + x0) * 3, b = (y0 * w + x1) * 3, c = (y1 * w + x0) * 3, d = (y1 * w + x1) * 3;
  for (let k = 0; k < 3; k++) {
    out[o + k] = (data[a + k] * (1 - tx) + data[b + k] * tx) * (1 - ty) + (data[c + k] * (1 - tx) + data[d + k] * tx) * ty;
  }
}

/** Total rotation in radians (display lon = picture lon + yaw). A sun target overrides the rotation. */
export function effectiveYaw(s, sun) {
  if (s.sun_target !== 'none' && sun) return COMPASS_LON[s.sun_target] - sun.lon;
  return s.yaw * Math.PI / 180;
}

// Calls fn(index, x, y, z) for every pixel of the 3F x 2F layout, with its cube point.
function forEachPixel(face, fn) {
  const W = 3 * face, p = [0, 0, 0];
  for (let tile = 0; tile < 6; tile++) {
    const r = Math.floor(tile / 3), c = tile % 3;
    for (let y = 0; y < face; y++) {
      for (let x = 0; x < face; x++) {
        tilePoint(tile, (x + 0.5) / face, (y + 0.5) / face, p);
        fn((r * face + y) * W + c * face + x, p[0], p[1], p[2]);
      }
    }
  }
}

// ---------------------------------------------------------------- template

/** Project the panorama onto MCPatcher's cube. Returns RGBA bytes of 3F x 2F. */
export function renderTemplate(pano, s, sun = null) {
  const face = s.face_size, W = 3 * face, H = 2 * face;
  const yaw = effectiveYaw(s, sun), rgba = new Uint8ClampedArray(W * H * 4), px = [0, 0, 0];
  forEachPixel(face, (i, x, y, z) => {
    const [lon, lat] = dirToLonLat(x, y, z);
    samplePano(pano, lon - yaw, lat, px, 0);
    rgba[i * 4] = px[0] * 255; rgba[i * 4 + 1] = px[1] * 255; rgba[i * 4 + 2] = px[2] * 255;
    rgba[i * 4 + 3] = 255; // 32-bit PNG, fully opaque
  });
  const info = { yaw_total_deg: (((yaw * 180 / Math.PI) % 360) + 360) % 360 };
  if (s.seam_fix && s.coverage === 'stretch') Object.assign(info, seamBlend(rgba, pano, yaw, face, s));
  poleCleanup(rgba, face, s.pole_radius);
  return { template: rgba, width: W, height: H, info };
}

/**
 * Blend the wrap-around border, directly on the cube. The picture's left and right edges meet
 * on one meridian. Mirror the kept side across that plane and fade it in with a soft falloff,
 * like erasing the top layer with a 0 %-hardness eraser along the middle line.
 */
export function seamBlend(rgba, pano, yaw, face, s) {
  const sd = lonLatToDir(Math.PI + yaw, 0);
  const m = [sd[2], 0, -sd[0]];                       // normal of the seam plane
  const right = [-sd[2], 0, sd[0]];                   // cross(sd, up): right hand when facing the seam
  const width = Math.max(2, s.seam_width * face / 1024);
  const rightDotM = right[0] * m[0] + right[2] * m[2];
  const inRegion = (x, y, z) => {
    const dm = x * m[0] + z * m[2], maxc = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
    const dist = Math.abs(dm) / maxc * (face / 2);
    const vertical = Math.abs(y) >= Math.max(Math.abs(x), Math.abs(z));
    return (vertical || x * sd[0] + z * sd[2] > 0) && dist < width ? [dm, dist] : null;
  };

  let keep;
  if (s.seam_side === 'auto') {
    let sp = 0, np = 0, sn = 0, nn = 0;
    forEachPixel(face, (i, x, y, z) => {
      const r = inRegion(x, y, z);
      if (!r || r[0] === 0) return;
      const l = lum(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) / 255;
      if (r[0] > 0) { sp += l; np++; } else { sn += l; nn++; }
    });
    keep = (np ? sp / np : 0) >= (nn ? sn / nn : 0) ? 1 : -1;
  } else {
    const signRight = rightDotM > 0 ? 1 : -1;
    keep = s.seam_side === 'right' ? signRight : -signRight;
  }
  const kept = keep * rightDotM > 0 ? 'right' : 'left';

  let count = 0;
  const px = [0, 0, 0];
  forEachPixel(face, (i, x, y, z) => {
    const r = inRegion(x, y, z);
    if (!r || r[0] * keep >= 0) return;
    const dm = r[0];
    const [mlon, mlat] = dirToLonLat(x - 2 * dm * m[0], y, z - 2 * dm * m[2]);
    samplePano(pano, mlon - yaw, mlat, px, 0);
    const wgt = 1 - smoothstep(r[1] / width);
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = rgba[i * 4 + c] * (1 - wgt) + px[c] * 255 * wgt;
    count++;
  });
  return { seam_kept_side: kept, seam_pixels: count };
}

/** Hide the pinch / "ghost pixels" at the centre of Top and Bottom. */
export function poleCleanup(rgba, face, radius) {
  const r = radius * face / 1024;
  if (r < 1) return;
  const sigma = Math.max(1, r / 2), reach = Math.min(Math.floor(face / 2), Math.ceil(r + 3 * sigma + 2));
  const W = 3 * face, x0 = Math.floor(face / 2) - reach, size = 2 * reach;
  for (const col of [0, 1]) { // Bottom, Top
    const patch = makeImage(size, size), ox = col * face + x0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = ((x0 + y) * W + ox + x) * 4, t = (y * size + x) * 3;
        patch.data[t] = rgba[s] / 255; patch.data[t + 1] = rgba[s + 1] / 255; patch.data[t + 2] = rgba[s + 2] / 255;
      }
    }
    const blurred = gaussianBlur(patch, sigma);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x0 + x + 0.5 - face / 2, x0 + y + 0.5 - face / 2), wgt = 1 - smoothstep(d / r);
        if (wgt <= 0) continue;
        const s = ((x0 + y) * W + ox + x) * 4, t = (y * size + x) * 3;
        for (let c = 0; c < 3; c++) rgba[s + c] = rgba[s + c] * (1 - wgt) + blurred.data[t + c] * 255 * wgt;
      }
    }
  }
}

// ---------------------------------------------------------------- whole run

export function runPipeline(img, settings) {
  const s = normalizeSettings(settings);
  const { pano, info } = preparePanorama(img, s);
  const t = renderTemplate(pano, s, info.sun);
  Object.assign(info, t.info);
  info.template_size = [t.width, t.height];
  return { settings: s, pano, template: t.template, width: t.width, height: t.height, info };
}

// ---------------------------------------------------------------- problem list -> automatic corrections

export const PROBLEMS = {
  seams: 'Visible seams between faces',
  horizon: 'Horizon too high or too low',
  rotation: 'Sky rotated wrong',
  stretch: 'Image stretched or squished',
  exposure: 'Too dark or too bright',
  flip: 'Upside down or mirrored',
  sun: 'Sun / moon in a bad spot',
  edges: 'Odd line or black pixels at the image edge',
  mirror: 'Bottom looks obviously mirrored',
  pole: "White 'ghost pixels' / pinch at the top or bottom centre",
};

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** Return new settings with the automatic correction for `problem` applied. */
export function autoFix(problem, img, settings) {
  const s = normalizeSettings(settings);
  if (problem === 'seams') {
    if (s.seam_fix) s.seam_width = Math.trunc(Math.min(512, Math.max(256, s.seam_width * 1.5)));
    s.seam_fix = true;
  } else if (problem === 'horizon') {
    s.horizon_y = round(detectHorizon(adjustColors(trimEdges(img, s.auto_trim, s.edge_trim).img, s)), 4);
    s.horizon_offset = 0.015;
  } else if (problem === 'rotation') {
    s.yaw = (s.yaw + 180) % 360;
  } else if (problem === 'stretch') {
    const t = trimEdges(img, s.auto_trim, s.edge_trim).img;
    if (t.w / t.h < 1.5) s.coverage = 'mirror';
    const cov = s.coverage === 'mirror' ? 2 : 1;
    s.vscale = round(clamp(cov * t.w / (2 * t.h), 0.5, 2), 3);
  } else if (problem === 'exposure') {
    const l = luminance(preparePanorama(img, s).pano);
    let mean = 0;
    for (const v of l) mean += v;
    mean = clamp(mean / l.length, 0.02, 0.98);
    s.gamma = round(clamp(s.gamma * Math.log(0.5) / Math.log(mean), 0.3, 3), 3);
    s.brightness = 0; s.contrast = 1;
  } else if (problem === 'flip') {
    const t = trimEdges(img, s.auto_trim, s.edge_trim).img, l = luminance(t);
    const q = Math.max(1, Math.floor(t.h / 4));
    let top = 0, bot = 0;
    for (let i = 0; i < q * t.w; i++) top += l[i];
    for (let i = (t.h - q) * t.w; i < t.h * t.w; i++) bot += l[i];
    if (bot / (q * t.w) > top / (q * t.w) + 0.08) s.flip_v = !s.flip_v;
    else s.flip_h = !s.flip_h;
  } else if (problem === 'sun') {
    if (detectSun(preparePanorama(img, { ...s, sun_soften: 0 }).pano)) {
      s.sun_target = ['none', 'west'].includes(s.sun_target) ? 'east' : 'west';
    }
    s.sun_soften = Math.max(s.sun_soften, 0.5);
  } else if (problem === 'edges') {
    s.auto_trim = true;
    s.edge_trim = Math.max(s.edge_trim, 4);
  } else if (problem === 'mirror') {
    s.mirror_blend = Math.max(s.mirror_blend, 48);
  } else if (problem === 'pole') {
    s.pole_radius = Math.max(s.pole_radius * 2, 48);
  } else {
    throw new Error(`unknown problem: ${problem}`);
  }
  return s;
}
