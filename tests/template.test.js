// The generated template keeps the same format: file names, image sizes and .properties.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { pngInfo } from '../src/png.js';
import { manifest, TEMPLATE } from './helpers.js';

const SIZES = {
  'sky/world0/cloud1.png': [800, 600],
  'sky/world0/cloud2.png': [800, 600],
  'sky/world0/starfield01.png': [2304, 1536],
  'sky/world0/starfield03.png': [800, 600],
  'sky/world0/sky_sunflare.png': [1536, 1024],
};

function walk(dir) {
  return readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}

test('manifest lists exactly the files on disk', () => {
  const onDisk = walk(join(TEMPLATE, 'mcpatcher')).map(p => relative(join(TEMPLATE, 'mcpatcher'), p).split('\\').join('/')).sort();
  assert.deepEqual(manifest(), onDisk);
  assert.equal(onDisk.length, 13);
});

test('image sizes', () => {
  for (const [rel, size] of Object.entries(SIZES)) {
    const i = pngInfo(new Uint8Array(readFileSync(join(TEMPLATE, 'mcpatcher', rel))));
    assert.deepEqual([i.width, i.height], size, rel);
  }
  const guide = pngInfo(new Uint8Array(readFileSync(join(TEMPLATE, 'Sky Template 1024x1024.png'))));
  assert.deepEqual([guide.width, guide.height], [3072, 2048]);
});

test('every sky layer points at a file that exists', () => {
  for (const rel of manifest().filter(f => f.endsWith('.properties') && f.startsWith('sky/'))) {
    const body = readFileSync(join(TEMPLATE, 'mcpatcher', rel), 'utf8');
    const src = body.match(/^source=\.\/(.+)$/m)[1];
    assert.ok(manifest().includes('sky/world0/' + src), `${rel} -> ${src}`);
    assert.match(body, /^blend=(add|replace)$/m);
  }
});
