// Resource pack export, laid out like the template's mcpatcher folder.

import { strToU8, zipSync } from '../vendor/fflate.js';
import { encodePNG } from './png.js';

// The template folder goes into assets/minecraft/ of the pack.
export const PACK_PREFIX = 'assets/minecraft/mcpatcher/';
export const SKY_FILE = 'sky/world0/cloud1.png'; // day layer: sky3.properties, blend=replace, source=./cloud1.png
export const PACK_FORMAT = 1;                    // Minecraft 1.6.1 - 1.8.9 (the tool targets 1.8.9)
export const PACK_ICON_SIZE = 128;

/** Every file in the pack, given the template's file list (from template/manifest.json). */
export function expectedPackTree(templateFiles) {
  return ['pack.mcmeta', 'pack.png', ...templateFiles.map(f => PACK_PREFIX + f)].sort();
}

export function safeName(name) {
  name = String(name || '').trim().replace(/[^\p{L}\p{N}_\- .]+/gu, '').replace(/^[ .]+|[ .]+$/g, '');
  return name.slice(0, 60) || 'Custom Sky';
}

/** Centre crop of the picture, scaled to 128 x 128, as RGBA bytes. */
export function makePackIcon(img) {
  const n = PACK_ICON_SIZE, side = Math.min(img.w, img.h);
  const x0 = (img.w - side) / 2, y0 = (img.h - side) / 2, step = side / n;
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Area average of the source pixels under this icon pixel.
      let r = 0, g = 0, b = 0, cnt = 0;
      const sy0 = Math.floor(y0 + y * step), sy1 = Math.max(sy0 + 1, Math.floor(y0 + (y + 1) * step));
      const sx0 = Math.floor(x0 + x * step), sx1 = Math.max(sx0 + 1, Math.floor(x0 + (x + 1) * step));
      for (let sy = sy0; sy < Math.min(sy1, img.h); sy++) {
        for (let sx = sx0; sx < Math.min(sx1, img.w); sx++) {
          const i = (sy * img.w + sx) * 3;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; cnt++;
        }
      }
      const o = (y * n + x) * 4;
      rgba[o] = r / cnt * 255; rgba[o + 1] = g / cnt * 255; rgba[o + 2] = b / cnt * 255; rgba[o + 3] = 255;
    }
  }
  return rgba;
}

/**
 * Zip whose root is the pack itself, so it can go straight into .minecraft/resourcepacks.
 * `readTemplateFile(rel)` returns the bytes of a template file (fetch in the browser, fs in tests).
 */
export async function buildPack({ template, width, height, icon, packName, templateFiles, readTemplateFile }) {
  const mcmeta = { pack: { pack_format: PACK_FORMAT, description: safeName(packName) } };
  const files = {
    'pack.mcmeta': strToU8(JSON.stringify(mcmeta, null, 2) + '\n'),
    'pack.png': encodePNG(icon, PACK_ICON_SIZE, PACK_ICON_SIZE, { channels: 3 }),
  };
  for (const rel of templateFiles) {
    files[PACK_PREFIX + rel] = rel === SKY_FILE
      ? [encodePNG(template, width, height), { level: 0 }] // already compressed
      : await readTemplateFile(rel);
  }
  return zipSync(files, { level: 6 });
}
