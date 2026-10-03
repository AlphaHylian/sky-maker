// Synthetic test picture: sky on top, water below, letterbox bars.

import { clamp, gaussianBlur, makeImage, resizeBilinear } from './image.js';

export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTestImage({ width = 2560, height = 1440, horizon = 0.66, bars = 40, sun = [0.78, 0.25], seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const contentH = height - 2 * bars, hy = Math.floor(contentH * horizon);
  // Soft clouds: blurred noise, stronger near the horizon. Left and right halves differ so the wrap seam shows.
  const nw = Math.floor(width / 16) + 1, nh = Math.floor(hy / 16) + 1, noise = makeImage(nw, nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const v = rand() * (x < Math.floor(nw / 2) ? 0.6 : 1);
      noise.data.fill(v, (y * nw + x) * 3, (y * nw + x) * 3 + 3);
    }
  }
  const clouds = gaussianBlur(resizeBilinear(noise, width, hy), 12);
  const img = makeImage(width, height), d = img.data;
  for (let y = 0; y < hy; y++) {
    const t = hy > 1 ? y / (hy - 1) : 0;
    for (let x = 0; x < width; x++) {
      let r = 0.15 + 0.45 * t, g = 0.45 + 0.35 * t, b = 0.85 + 0.1 * t;
      const c = clamp((clouds.data[(y * width + x) * 3] - 0.45) * 2.2, 0, 1) * (0.4 + 0.6 * t);
      r = r * (1 - c) + 0.95 * c; g = g * (1 - c) + 0.95 * c; b = b * (1 - c) + 0.95 * c;
      if (sun) {
        const glow = clamp(1 - Math.hypot(x - sun[0] * width, y - sun[1] * hy) / 40, 0, 1);
        r = r * (1 - glow) + glow; g = g * (1 - glow) + glow; b = b * (1 - glow) + glow;
      }
      const i = ((bars + y) * width + x) * 3;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  const wh = contentH - hy;
  for (let y = 0; y < wh; y++) {
    const t = wh > 1 ? y / (wh - 1) : 0;
    for (let x = 0; x < width; x++) {
      const ripple = 0.05 * Math.sin(y * 0.35 + Math.sin(x * 0.01) * 3), i = ((bars + hy + y) * width + x) * 3;
      d[i] = 0.25 + 0.2 * t + ripple; d[i + 1] = 0.55 + 0.2 * t + ripple; d[i + 2] = 0.75 + 0.1 * t + ripple;
    }
  }
  for (let i = bars * width * 3; i < (bars + 1) * width * 3; i++) d[i] *= 0.6; // an "imperfect" top row
  // Quantise to 8 bits like a saved picture.
  for (let i = 0; i < d.length; i++) d[i] = Math.floor(clamp(d[i], 0, 1) * 255) / 255;
  return img;
}
