// Sky layer .properties: reading, writing, checking, and the pack export with edited layers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { strFromU8, unzipSync } from '../vendor/fflate.js';
import { buildPack, makePackIcon, PACK_PREFIX } from '../src/pack.js';
import { DEFAULTS, runPipeline } from '../src/pipeline.js';
import { brightnessAt, checkLayer, formatTime, parseTime, readLayer, writeLayer } from '../src/skylayers.js';
import { manifest, readTemplateFile, TEMPLATE, testImage } from './helpers.js';

const layerFiles = () => manifest().filter(f => f.startsWith('sky/') && f.endsWith('.properties'));
const text = (rel) => readFileSync(join(TEMPLATE, 'mcpatcher', rel), 'utf8');

test('every template layer has all four fade times and is valid', () => {
  for (const rel of layerFiles()) {
    for (const k of ['startFadeIn', 'endFadeIn', 'startFadeOut', 'endFadeOut']) assert.match(text(rel), new RegExp(`^${k}=\\d{1,2}:\\d{2}$`, 'm'), `${rel} ${k}`);
    assert.deepEqual(checkLayer(readLayer(rel, text(rel))), [], rel);
  }
});

test('reading then writing a template layer gives the same text', () => {
  for (const rel of layerFiles()) assert.equal(writeLayer(readLayer(rel, text(rel))), text(rel), rel);
});

test('a missing startFadeOut is filled in like OptiFine does', () => {
  const l = readLayer('x', 'startFadeIn=17:30\nendFadeIn=20:00\nendFadeOut=6:10\nsource=./a.png\n');
  assert.equal(formatTime(l.startFadeOut), '3:40'); // fade out takes as long as fade in (2 h 30 min)
});

test('times', () => {
  assert.equal(parseTime('5:30'), 330);
  assert.equal(parseTime('05:30'), 330);
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime(''), null);
  assert.equal(formatTime(18 * 60 + 5), '18:05');
});

test('times out of order are reported', () => {
  const l = readLayer('x', text('sky/world0/sky3.properties'));
  assert.deepEqual(checkLayer(l), []);
  assert.equal(checkLayer({ ...l, startFadeOut: parseTime('5:45') }).length, 1); // fades out before it is fully in
  assert.equal(checkLayer({ ...l, endFadeIn: null }).length, 1);
  assert.equal(checkLayer({ ...l, speed: NaN }).length, 1);
  assert.equal(checkLayer({ ...l, axis: [0, 0, 0] }).length, 1);
});

test('brightness follows the fade times, also across midnight', () => {
  const day = readLayer('x', text('sky/world0/sky3.properties'));
  assert.equal(brightnessAt(day, parseTime('12:00')), 1);
  assert.equal(brightnessAt(day, parseTime('5:45')), 0.5);
  assert.equal(brightnessAt(day, parseTime('0:00')), 0);
  const night = readLayer('x', text('sky/world0/sky4.properties'));
  assert.equal(brightnessAt(night, parseTime('0:00')), 1);
  assert.equal(brightnessAt(night, parseTime('12:00')), 0);
});

test('export uses edited layers and leaves out turned-off layers and their unused images', async () => {
  const r = runPipeline(testImage(), DEFAULTS);
  const sky3 = readLayer('sky/world0/sky3.properties', text('sky/world0/sky3.properties'));
  const edited = writeLayer({ ...sky3, startFadeIn: parseTime('5:00'), blend: 'alpha' });
  const z = unzipSync(await buildPack({
    template: r.template, width: r.width, height: r.height, icon: makePackIcon(testImage()), packName: 'x',
    templateFiles: manifest(), readTemplateFile,
    overrides: { 'sky/world0/sky3.properties': edited, 'sky/world0/sky4.properties': null, 'sky/world0/sky7.properties': null },
  }));
  const p = (rel) => PACK_PREFIX + 'sky/world0/' + rel;
  assert.equal(strFromU8(z[p('sky3.properties')]), edited);
  assert.ok(!(p('sky4.properties') in z) && !(p('starfield01.png') in z)); // nothing else uses starfield01
  assert.ok(!(p('sky7.properties') in z) && p('sky_sunflare.png') in z);   // sky8 still uses the flare
  assert.ok(p('cloud1.png') in z && p('cloud2.png') in z);
});
