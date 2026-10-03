// The exported zip must match the template: tree, names, image sizes, properties, pack.mcmeta.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from '../vendor/fflate.js';
import { buildPack, expectedPackTree, makePackIcon, PACK_PREFIX, safeName, SKY_FILE } from '../src/pack.js';
import { DEFAULTS, runPipeline } from '../src/pipeline.js';
import { decodePNG, pngInfo } from '../src/png.js';
import { manifest, readTemplateFile, TEMPLATE, testImage } from './helpers.js';

const TEMPLATE_TREE = [
  'pack.mcmeta',
  'pack.png',
  'assets/minecraft/mcpatcher/color.properties',
  'assets/minecraft/mcpatcher/sky/world0/cloud1.png',
  'assets/minecraft/mcpatcher/sky/world0/cloud2.png',
  'assets/minecraft/mcpatcher/sky/world0/sky1.properties',
  'assets/minecraft/mcpatcher/sky/world0/sky2.properties',
  'assets/minecraft/mcpatcher/sky/world0/sky3.properties',
  'assets/minecraft/mcpatcher/sky/world0/sky4.properties',
  'assets/minecraft/mcpatcher/sky/world0/sky6.properties',
  'assets/minecraft/mcpatcher/sky/world0/sky7.properties',
  'assets/minecraft/mcpatcher/sky/world0/sky8.properties',
  'assets/minecraft/mcpatcher/sky/world0/sky_sunflare.png',
  'assets/minecraft/mcpatcher/sky/world0/starfield01.png',
  'assets/minecraft/mcpatcher/sky/world0/starfield03.png',
].sort();

let zip = null;
async function pack() {
  if (zip) return zip;
  const r = runPipeline(testImage(), { ...DEFAULTS, face_size: 1024 });
  const bytes = await buildPack({
    template: r.template, width: r.width, height: r.height, icon: makePackIcon(testImage()),
    packName: 'My Sky §6', templateFiles: manifest(), readTemplateFile,
  });
  zip = unzipSync(bytes);
  return zip;
}

test('file tree matches the template', async () => {
  const z = await pack();
  assert.deepEqual(Object.keys(z).sort(), TEMPLATE_TREE);
  assert.deepEqual(expectedPackTree(manifest()), TEMPLATE_TREE);
});

test('sky image matches the layout guide dimensions, 32-bit', async () => {
  const z = await pack(), sky = pngInfo(z[PACK_PREFIX + SKY_FILE]);
  const guide = pngInfo(new Uint8Array(readFileSync(join(TEMPLATE, 'Sky Template 1024x1024.png'))));
  assert.deepEqual([sky.width, sky.height], [guide.width, guide.height]);
  assert.deepEqual([sky.width, sky.height], [3072, 2048]);
  assert.equal(sky.colorType, 6); // RGBA
});

test('other files are copied unchanged', async () => {
  const z = await pack();
  for (const rel of manifest()) {
    if (rel === SKY_FILE) continue;
    assert.deepEqual(z[PACK_PREFIX + rel], await readTemplateFile(rel), rel);
  }
  const props = strFromU8(z[PACK_PREFIX + 'sky/world0/sky3.properties']);
  assert.ok(props.includes('source=./cloud1.png') && props.includes('blend=replace'));
});

test('pack.mcmeta and pack.png', async () => {
  const z = await pack();
  assert.deepEqual(JSON.parse(strFromU8(z['pack.mcmeta'])), { pack: { pack_format: 1, description: 'My Sky 6' } });
  const icon = decodePNG(z['pack.png']);
  assert.deepEqual([icon.width, icon.height], [128, 128]);
  let min = 255, max = 0;
  for (let i = 0; i < icon.rgba.length; i += 4) { min = Math.min(min, icon.rgba[i + 2]); max = Math.max(max, icon.rgba[i + 2]); }
  assert.ok(max - min > 10); // made from the picture, not blank
});

test('the exported sky decodes to the pipeline output', async () => {
  const z = await pack(), r = runPipeline(testImage(), DEFAULTS), png = decodePNG(z[PACK_PREFIX + SKY_FILE]);
  assert.ok(png.rgba.every((v, i) => v === r.template[i]));
});

test('safe pack names', () => {
  assert.equal(safeName('  '), 'Custom Sky');
  assert.equal(safeName('a/b\\c:d'), 'abcd');
  assert.equal(safeName(' .My Sky. '), 'My Sky');
});
