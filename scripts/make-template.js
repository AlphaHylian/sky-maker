// Generates the template/ folder: the layout guide and the MCPatcher sky files the pack is built from.
// Every image is drawn here from code. Run: node scripts/make-template.js

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_MATRICES, tilePoint } from '../src/geometry.js';
import { mulberry32 } from '../src/testimage.js';
import { encodePNG } from '../src/png.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'template');
const SKY = join(OUT, 'mcpatcher', 'sky', 'world0');

// ------------------------------------------------------------------ helpers

function canvas(w, h) { return { w, h, px: new Float32Array(w * h * 4) }; }

function add(c, x, y, r, g, b, a = 1) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.px[i] += r; c.px[i + 1] += g; c.px[i + 2] += b; c.px[i + 3] = Math.max(c.px[i + 3], a);
}

function set(c, x, y, r, g, b, a = 1) {
  const i = (y * c.w + x) * 4;
  c.px[i] = r; c.px[i + 1] = g; c.px[i + 2] = b; c.px[i + 3] = a;
}

function save(c, path, channels = 4) {
  const rgba = new Uint8ClampedArray(c.w * c.h * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = c.px[i] * 255;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(rgba, c.w, c.h, { channels, level: 9 }));
}

/** Calls fn(x, y, dir) for every pixel of a 3x2 sky image of any size, dir = unit view direction. */
function forEachSkyPixel(c, fn) {
  const p = [0, 0, 0], tw = c.w / 3, th = c.h / 2;
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const col = Math.min(2, Math.floor(x / tw)), row = Math.min(1, Math.floor(y / th));
      tilePoint(row * 3 + col, (x + 0.5 - col * tw) / tw, (y + 0.5 - row * th) / th, p);
      const n = Math.hypot(p[0], p[1], p[2]);
      fn(x, y, [p[0] / n, p[1] / n, p[2] / n]);
    }
  }
}

/** Pixel position of a view direction in a 3x2 sky image (inverse of the tile matrices). */
function dirToPixel(c, d) {
  let best = 0, bestDot = -Infinity;
  for (let t = 0; t < 6; t++) {
    const m = TILE_MATRICES[t];
    const dot = -(m[1] * d[0] + m[4] * d[1] + m[7] * d[2]); // tile centre direction = M * (0, -1, 0)
    if (dot > bestDot) { bestDot = dot; best = t; }
  }
  const m = TILE_MATRICES[best];
  const lx = m[0] * d[0] + m[3] * d[1] + m[6] * d[2], ly = m[1] * d[0] + m[4] * d[1] + m[7] * d[2];
  const lz = m[2] * d[0] + m[5] * d[1] + m[8] * d[2], k = -1 / ly;
  const tw = c.w / 3, th = c.h / 2;
  return [(best % 3) * tw + (lx * k + 1) / 2 * tw, Math.floor(best / 3) * th + (lz * k + 1) / 2 * th];
}

function randomDir(rand) {
  const z = rand() * 2 - 1, a = rand() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

function stars(c, rand, count, maxBright, minElev = -1) {
  for (let s = 0; s < count; s++) {
    const d = randomDir(rand);
    if (d[1] < minElev) continue;
    const [px, py] = dirToPixel(c, d);
    const bright = maxBright * Math.pow(rand(), 3) + 0.08, size = 0.5 + bright * 1.2;
    const tint = rand(), col = tint < 0.15 ? [1, 0.85, 0.7] : tint > 0.85 ? [0.75, 0.85, 1] : [1, 1, 1];
    for (let y = Math.floor(py - 3); y <= py + 3; y++) {
      for (let x = Math.floor(px - 3); x <= px + 3; x++) {
        const f = bright * Math.exp(-((x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2) / (size * size));
        if (f > 0.004) add(c, x, y, f * col[0], f * col[1], f * col[2]);
      }
    }
  }
}

// 5 x 7 pixel font for the layout labels.
const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101111',
  H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110',
  K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100', W: '10001100011000110101101011010101010',
  '(': '00010001000100001000010000010000010', ')': '01000001000001000010000100010001000',
  ' ': '00000000000000000000000000000000000',
};

function text(c, str, cx, cy, scale, rgb) {
  const w = str.length * 6 - 1, x0 = Math.round(cx - w * scale / 2), y0 = Math.round(cy - 3.5 * scale);
  [...str].forEach((ch, k) => {
    const g = FONT[ch];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (g[gy * 5 + gx] !== '1') continue;
        for (let y = 0; y < scale; y++) {
          for (let x = 0; x < scale; x++) set(c, x0 + (k * 6 + gx) * scale + x, y0 + gy * scale + y, ...rgb);
        }
      }
    }
  });
}

// ------------------------------------------------------------------ images

/** Layout guide: which square of the 3x2 image goes where. */
function layoutGuide(w, h) {
  const c = canvas(w, h), tw = w / 3, th = h / 2;
  const labels = [['BOTTOM', ''], ['TOP', ''], ['BACK', '(S)'], ['LEFT', '(W)'], ['FRONT', '(N)'], ['RIGHT', '(E)']];
  for (let t = 0; t < 6; t++) {
    const grey = t % 2 === 0, bg = grey ? 0.47 : 1, fg = grey ? [0.93, 0.93, 0.93] : [0.43, 0.43, 0.43];
    const x0 = Math.round((t % 3) * tw), y0 = Math.round(Math.floor(t / 3) * th);
    for (let y = y0; y < Math.round(y0 + th); y++) for (let x = x0; x < Math.round(x0 + tw); x++) set(c, x, y, bg, bg, bg);
    const big = Math.max(1, Math.floor(tw * 0.8 / (6 * 6))), small = Math.max(1, Math.floor(big / 2));
    text(c, labels[t][0], x0 + tw / 2, y0 + th * 0.45, big, fg);
    if (labels[t][1]) text(c, labels[t][1], x0 + tw / 2, y0 + th * 0.45 + big * 7, small, fg);
  }
  return c;
}

/** Sunrise / sunset glow, added on top of the sky: warm near the horizon, nothing elsewhere. */
function duskGlow(w, h) {
  const c = canvas(w, h);
  forEachSkyPixel(c, (x, y, d) => {
    const e = Math.asin(d[1]);
    const f = e >= 0 ? Math.exp(-e / 0.22) : Math.exp(e / 0.05);
    const high = e >= 0 ? Math.exp(-e / 0.5) - f * 0.6 : 0; // a little pink above the orange band
    set(c, x, y, 0.45 * f + 0.10 * high, 0.20 * f + 0.04 * high, 0.07 * f + 0.08 * high);
  });
  return c;
}

/** Night sky tint, added on top: faint blue near the horizon, darker overhead, a few stars. */
function nightTint(w, h, rand) {
  const c = canvas(w, h);
  forEachSkyPixel(c, (x, y, d) => {
    const e = Math.asin(d[1]);
    const f = e >= 0 ? 0.25 + 0.75 * Math.exp(-e / 0.35) : Math.exp(e / 0.12);
    set(c, x, y, 0.035 * f, 0.05 * f, 0.12 * f);
  });
  stars(c, rand, 350, 0.35, -0.05);
  return c;
}

/** Star field, added on top at night. */
function starField(w, h, rand) {
  const c = canvas(w, h);
  for (let i = 3; i < c.px.length; i += 4) c.px[i] = 1;
  stars(c, rand, 2600, 0.85);
  return c;
}

/** Sun flare: a glow in the middle of the Top square, the rest transparent. */
function sunFlare(w, h) {
  const c = canvas(w, h), tw = w / 3, th = h / 2, cx = tw * 1.5, cy = th / 2;
  for (let y = 0; y < Math.round(th); y++) {
    for (let x = Math.round(tw); x < Math.round(2 * tw); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy) / tw;
      const core = Math.exp(-((r / 0.012) ** 2));
      const glow = Math.exp(-r / 0.035) * 0.8 + Math.exp(-r / 0.09) * 0.25;
      const ang = Math.atan2(dy, dx), spikes = Math.pow(Math.abs(Math.cos(ang * 2)), 60) * Math.exp(-r / 0.06) * 0.6;
      const v = glow + spikes;
      set(c, x, y, Math.min(1, core + v), Math.min(1, core + v * 0.62), Math.min(1, core + v * 0.25), 1);
    }
  }
  return c;
}

// ------------------------------------------------------------------ files

const PROPERTIES = {
  'sky1.properties': 'startFadeIn=18:00\nendFadeIn=18:45\nstartFadeOut=18:50\nendFadeOut=19:10\nblend=add\nrotate=true\naxis=0.0 -0.2 0.0\nsource=./cloud2.png\n',
  'sky2.properties': 'startFadeIn=4:45\nendFadeIn=5:10\nstartFadeOut=5:20\nendFadeOut=6:05\nblend=add\nrotate=true\naxis=0.0 -0.2 0.0\nsource=./cloud2.png\n',
  'sky3.properties': 'startFadeIn=5:30\nendFadeIn=6:00\nstartFadeOut=17:50\nendFadeOut=18:40\nblend=replace\nrotate=true\naxis=0.0 -0.2 0.0\nsource=./cloud1.png\n',
  'sky4.properties': 'startFadeIn=17:30\nendFadeIn=20:00\nendFadeOut=6:10\nblend=add\nrotate=true\nsource=./starfield01.png\n',
  'sky6.properties': 'startFadeIn=18:30\nendFadeIn=18:45\nendFadeOut=5:25\nblend=add\nrotate=true\naxis=0.0 -0.2 0.0\nsource=./starfield03.png\n',
  'sky7.properties': 'startFadeIn=17:50\nendFadeIn=18:30\nendFadeOut=19:20\nblend=add\nrotate=true\nsource=./sky_sunflare.png\n',
  'sky8.properties': 'startFadeIn=4:40\nendFadeIn=5:00\nendFadeOut=5:50\nblend=add\nrotate=true\nsource=./sky_sunflare.png\n',
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(SKY, { recursive: true });
const rand = mulberry32(2026);

save(layoutGuide(3072, 2048), join(OUT, 'Sky Template 1024x1024.png'), 3);
writeFileSync(join(OUT, 'mcpatcher', 'color.properties'), 'lilypad=6aef3f\nsky.end=FFFFFF\n');
for (const [name, body] of Object.entries(PROPERTIES)) writeFileSync(join(SKY, name), body);
save(layoutGuide(800, 600), join(SKY, 'cloud1.png'));          // day sky: replaced by your picture
save(duskGlow(800, 600), join(SKY, 'cloud2.png'));             // sunrise / sunset
save(starField(2304, 1536, rand), join(SKY, 'starfield01.png'));
save(nightTint(800, 600, rand), join(SKY, 'starfield03.png'));
save(sunFlare(1536, 1024), join(SKY, 'sky_sunflare.png'));

const files = [
  'color.properties',
  ...Object.keys(PROPERTIES).map(n => 'sky/world0/' + n),
  ...['cloud1.png', 'cloud2.png', 'starfield01.png', 'starfield03.png', 'sky_sunflare.png'].map(n => 'sky/world0/' + n),
].sort();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ files }, null, 2) + '\n');
console.log(`template written: ${files.length} files in template/mcpatcher, plus the layout guide`);
