// Small float image toolkit. An image is { w, h, data } with data a Float32Array of
// interleaved RGB values in 0..1, row by row from the top.

export function makeImage(w, h) {
  return { w, h, data: new Float32Array(w * h * 3) };
}

export function cloneImage(img) {
  return { w: img.w, h: img.h, data: img.data.slice() };
}

/** RGBA bytes (ImageData-style) -> float RGB image. */
export function fromRGBA(rgba, w, h) {
  const img = makeImage(w, h), d = img.data;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    d[i * 3] = rgba[j] / 255; d[i * 3 + 1] = rgba[j + 1] / 255; d[i * 3 + 2] = rgba[j + 2] / 255;
  }
  return img;
}

/** Float RGB image -> RGBA bytes, fully opaque. */
export function toRGBA(img) {
  const n = img.w * img.h, out = new Uint8ClampedArray(n * 4), d = img.data;
  for (let i = 0; i < n; i++) {
    out[i * 4] = d[i * 3] * 255;
    out[i * 4 + 1] = d[i * 3 + 1] * 255;
    out[i * 4 + 2] = d[i * 3 + 2] * 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export const lum = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;

/** Luminance of every pixel, Float32Array of w * h. */
export function luminance(img) {
  const n = img.w * img.h, out = new Float32Array(n), d = img.data;
  for (let i = 0; i < n; i++) out[i] = lum(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
  return out;
}

export function smoothstep(x) {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function crop(img, x0, y0, w, h) {
  const out = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * img.w + x0) * 3;
    out.data.set(img.data.subarray(s, s + w * 3), y * w * 3);
  }
  return out;
}

export function flipH(img) {
  const out = makeImage(img.w, img.h), { w, h } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, t = (y * w + (w - 1 - x)) * 3;
      out.data[t] = img.data[s]; out.data[t + 1] = img.data[s + 1]; out.data[t + 2] = img.data[s + 2];
    }
  }
  return out;
}

export function flipV(img) {
  const out = makeImage(img.w, img.h), row = img.w * 3;
  for (let y = 0; y < img.h; y++) out.data.set(img.data.subarray(y * row, (y + 1) * row), (img.h - 1 - y) * row);
  return out;
}

/** Area-average resize (for shrinking). */
export function resizeArea(img, w, h) {
  const out = makeImage(w, h), sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++) {
          const wgt = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0)), i = (yy * img.w + xx) * 3;
          r += img.data[i] * wgt; g += img.data[i + 1] * wgt; b += img.data[i + 2] * wgt; wsum += wgt;
        }
      }
      const o = (y * w + x) * 3;
      out.data[o] = r / wsum; out.data[o + 1] = g / wsum; out.data[o + 2] = b / wsum;
    }
  }
  return out;
}

/** Bilinear resize (for enlarging). */
export function resizeBilinear(img, w, h) {
  const out = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) * img.h / h - 0.5, 0, img.h - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, img.h - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) * img.w / w - 0.5, 0, img.w - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, img.w - 1), tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = img.data[(y0 * img.w + x0) * 3 + c], b = img.data[(y0 * img.w + x1) * 3 + c];
        const d = img.data[(y1 * img.w + x0) * 3 + c], e = img.data[(y1 * img.w + x1) * 3 + c];
        out.data[(y * w + x) * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

// Box sizes whose three passes approximate a Gaussian with this standard deviation.
function boxRadii(sigma) {
  const ideal = Math.sqrt(12 * sigma * sigma / 3 + 1);
  let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  return [0, 1, 2].map(i => ((i < m ? wl : wu) - 1) / 2);
}

function boxPass(src, dst, w, h, r, horizontal) {
  const n = horizontal ? w : h, lines = horizontal ? h : w, inv = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const idx = (k) => {
      k = k < 0 ? 0 : k >= n ? n - 1 : k; // clamp at the edges
      return (horizontal ? line * w + k : k * w + line) * 3;
    };
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[idx(k) + c];
      for (let k = 0; k < n; k++) {
        dst[idx(k) + c] = acc * inv;
        acc += src[idx(k + r + 1) + c] - src[idx(k - r) + c];
      }
    }
  }
}

/** Gaussian blur (three box passes each way), edges clamped. */
export function gaussianBlur(img, sigma) {
  if (sigma < 0.5) return cloneImage(img);
  let a = img.data.slice(), b = new Float32Array(a.length);
  for (const r of boxRadii(sigma)) {
    if (r < 1) continue;
    boxPass(a, b, img.w, img.h, r, true);
    boxPass(b, a, img.w, img.h, r, false);
  }
  return { w: img.w, h: img.h, data: a };
}
