import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_INDEX } from '../src/geometry.js';
import { makeTestImage } from '../src/testimage.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE = join(ROOT, 'template');

let cached = null;
/** The synthetic test picture, made once per test file. */
export function testImage() {
  cached ??= makeTestImage();
  return cached;
}

export const manifest = () => JSON.parse(readFileSync(join(TEMPLATE, 'manifest.json'), 'utf8')).files;
export const readTemplateFile = async (rel) => new Uint8Array(readFileSync(join(TEMPLATE, 'mcpatcher', rel)));

/** Float RGB values (0..255) of one square of an RGBA template, as rows of [r, g, b]. */
export function tile(rgba, width, name, face) {
  const t = TILE_INDEX[name], r = Math.floor(t / 3), c = t % 3, rows = [];
  for (let y = 0; y < face; y++) {
    const row = [];
    for (let x = 0; x < face; x++) {
      const i = ((r * face + y) * width + c * face + x) * 4;
      row.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
    rows.push(row);
  }
  return rows;
}

export const lum = ([r, g, b]) => (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
