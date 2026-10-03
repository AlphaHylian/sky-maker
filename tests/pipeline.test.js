import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeImage } from '../src/image.js';
import {
  autoFix, DEFAULTS, detectHorizon, fillGaps, normalizeSettings, placeHorizon, preparePanorama, PROBLEMS,
  runPipeline, trimEdges,
} from '../src/pipeline.js';
import { lum, testImage, tile } from './helpers.js';

const run = (kw) => runPipeline(testImage(), { ...DEFAULTS, ...kw });

test('trim removes the letterbox bars and the odd first row', () => {
  const { img, trim } = trimEdges(testImage());
  assert.deepEqual(trim, [41, 0, 40, 0]); // top, right, bottom, left: 40 px bars + the darker first row
  let minRowMax = Infinity;
  for (let y = 0; y < img.h; y++) {
    let m = 0;
    for (let x = 0; x < img.w; x++) m = Math.max(m, img.data[(y * img.w + x) * 3 + 1]);
    minRowMax = Math.min(minRowMax, m);
  }
  assert.ok(minRowMax > 0.1);
});

test('horizon is detected', () => {
  assert.ok(Math.abs(detectHorizon(trimEdges(testImage()).img) - 0.66) < 0.02);
});

test('horizon lands a little under the middle', () => {
  const img = makeImage(50, 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 50; x++) img.data.set(y < 70 ? [0.2, 0.4, 0.9] : [0.1, 0.3, 0.5], (y * 50 + x) * 3);
  const { canvas, top, bottom } = placeHorizon(img, 0.7, 0.02, 1);
  let edge = -1;
  for (let y = 0; y < bottom; y++) if (Math.abs(canvas.data[(y + 1) * 150 + 2] - canvas.data[y * 150 + 2]) > 0.1) { edge = y + 1; break; }
  assert.equal(edge, 52); // 50 + 2 % of 100
  assert.equal(top, 0);
  assert.equal(bottom, 81);
});

test('fill_gaps mirrors the strip above', () => {
  const img = makeImage(4, 10);
  for (let y = 0; y < 10; y++) img.data.fill(y / 10, y * 12, y * 12 + 12);
  const out = fillGaps(img, 0, 6);
  assert.deepEqual([7, 8, 9].map(y => out.data[y * 12]), [6, 5, 4].map(y => img.data[y * 12]));
});

test('full pipeline: 3072 x 2048, fully opaque', () => {
  const r = run({});
  assert.equal(r.width, 3072);
  assert.equal(r.height, 2048);
  assert.equal(r.template.length, 3072 * 2048 * 4);
  for (let i = 3; i < r.template.length; i += 4) if (r.template[i] !== 255) assert.fail('alpha not 255');
  assert.ok(r.info.seam_pixels > 0);
});

for (const face of [256, 512]) {
  test(`face size ${face}`, () => {
    const r = run({ face_size: face });
    assert.deepEqual([r.width, r.height], [3 * face, 2 * face]);
  });
}

test('by default the picture centre is on Front and the wrap seam is on Back', () => {
  assert.equal(DEFAULTS.yaw, 180);
  const face = 256, r = run({ face_size: face, seam_fix: false, sun_target: 'none' });
  const { pano } = preparePanorama(testImage(), normalizeSettings({}));
  const centre = (y) => [0, 1, 2].map(c => pano.data[(y * pano.w + pano.w / 2) * 3 + c] * 255);
  const front = tile(r.template, r.width, 'Front', face);
  // A point in the sky part of Front's middle column matches the picture's centre column at the same height.
  const fy = Math.round(face * 0.3), lat = Math.atan((1 - 2 * (fy + 0.5) / face));
  const py = Math.round((0.5 - lat / Math.PI) * pano.h - 0.5);
  const a = front[fy][face / 2], b = centre(py);
  assert.ok(a.every((v, k) => Math.abs(v - b[k]) < 6), `${a} vs ${b}`);
});

function seamJump(rgba, width, face, name) {
  const t = tile(rgba, width, name, face), mid = face / 2;
  let s = 0, n = 0;
  for (let y = face / 8; y < face / 2 - face / 16; y++) {
    for (let c = 0; c < 3; c++) { s += Math.abs(t[y][mid][c] - t[y][mid - 1][c]); n++; }
  }
  return s / n;
}

test('seam blend removes the wrap-around border (on Back by default)', () => {
  const face = 512;
  const raw = run({ face_size: face, seam_fix: false }), fixed = run({ face_size: face });
  assert.ok(seamJump(fixed.template, fixed.width, face, 'Back') < seamJump(raw.template, raw.width, face, 'Back') * 0.5);
  const raw0 = run({ face_size: face, seam_fix: false, yaw: 0 }), fixed0 = run({ face_size: face, yaw: 0 });
  assert.ok(seamJump(fixed0.template, fixed0.width, face, 'Front') < seamJump(raw0.template, raw0.width, face, 'Front') * 0.5);
});

test('horizon is at eye level on all side squares', () => {
  const face = 512, r = run({ face_size: face });
  for (const name of ['Left', 'Right', 'Back', 'Front']) {
    const t = tile(r.template, r.width, name, face);
    const col = t.map(row => row.reduce((s, p) => s + lum(p), 0) / face);
    let edge = 0, best = -1;
    for (let y = 0; y < face - 1; y++) { const d = Math.abs(col[y + 1] - col[y]); if (d > best) { best = d; edge = y; } }
    assert.ok(edge > face * 0.48 && edge < face * 0.58, `${name}: ${edge}`);
  }
});

test('flip and rotation change the output', () => {
  const base = run({ face_size: 256 }).template;
  const differs = (a, b) => a.some((v, i) => v !== b[i]);
  assert.ok(differs(base, run({ face_size: 256, yaw: 90 }).template));
  assert.ok(differs(base, run({ face_size: 256, flip_v: true }).template));
});

test('mirror coverage has no wrap seam', () => {
  const edgeDiff = (p) => {
    let s = 0;
    for (let y = 0; y < p.h; y++) for (let c = 0; c < 3; c++) s += Math.abs(p.data[y * p.w * 3 + c] - p.data[((y + 1) * p.w - 1) * 3 + c]);
    return s / (p.h * 3);
  };
  const mirror = preparePanorama(testImage(), normalizeSettings({ coverage: 'mirror' })).pano;
  const stretch = preparePanorama(testImage(), normalizeSettings({})).pano;
  assert.ok(edgeDiff(mirror) < 0.01 && edgeDiff(stretch) > 0.01);
});

for (const problem of Object.keys(PROBLEMS)) {
  test(`automatic fix: ${problem}`, () => {
    const s = normalizeSettings({ face_size: 256 });
    const fixed = autoFix(problem, testImage(), s);
    assert.ok(JSON.stringify(fixed) !== JSON.stringify(s) || problem === 'horizon');
    runPipeline(testImage(), fixed);
  });
}

test('rotation fix turns the sky 180 degrees', () => {
  assert.equal(autoFix('rotation', testImage(), DEFAULTS).yaw, 0);
  assert.equal(autoFix('rotation', testImage(), { ...DEFAULTS, yaw: 0 }).yaw, 180);
});

test('exposure fix moves the mean towards the middle', () => {
  const meanLum = (s) => {
    const { pano } = preparePanorama(testImage(), s);
    let m = 0;
    for (let i = 0; i < pano.data.length; i += 3) m += lum([pano.data[i] * 255, pano.data[i + 1] * 255, pano.data[i + 2] * 255]);
    return m / (pano.w * pano.h);
  };
  const dark = normalizeSettings({ face_size: 256, gamma: 2.5 });
  const fixed = autoFix('exposure', testImage(), dark);
  assert.ok(Math.abs(meanLum(fixed) - 0.5) < Math.abs(meanLum(dark) - 0.5));
});

test('sun fix turns the painted sun east', () => {
  const s = autoFix('sun', testImage(), normalizeSettings({ face_size: 256 }));
  assert.equal(s.sun_target, 'east');
  assert.ok(s.sun_soften > 0);
  const r = runPipeline(testImage(), s);
  assert.ok(r.info.sun);
  // display longitude of the sun = picture longitude + yaw; east = -90 deg
  const lon = (((r.info.sun.lon + r.info.yaw_total_deg * Math.PI / 180) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  assert.ok(Math.abs(lon - 3 * Math.PI / 2) < 1e-6);
});

test('settings from form values are coerced', () => {
  const s = normalizeSettings({ yaw: '12', seam_fix: 'false', face_size: '999', horizon_y: null, bogus: 1, coverage: 'x' });
  assert.equal(s.yaw, 12);
  assert.equal(s.seam_fix, false);
  assert.equal(s.face_size, 1024);
  assert.equal(s.horizon_y, null);
  assert.equal(s.coverage, 'stretch');
  assert.ok(!('bogus' in s));
});
