// The 3x2 layout must match MCPatcher's SkyRenderer and the labels on the Sky Template.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirToLonLat, lonLatToDir, TILE_INDEX, tileDirections } from '../src/geometry.js';

// Minecraft axes: x = east, y = up, z = south.
const EXPECTED_CENTRE = {
  Bottom: [0, -1, 0], Top: [0, 1, 0], Back: [0, 0, 1], Left: [-1, 0, 0], Front: [0, 0, -1], Right: [1, 0, 0],
};

function tileDirs(d, face, name) {
  const t = TILE_INDEX[name], r = Math.floor(t / 3), c = t % 3, W = 3 * face;
  return (x, y) => { const i = ((r * face + y) * W + c * face + x) * 3; return [d[i], d[i + 1], d[i + 2]]; };
}
const close = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('tile centres match the template labels', () => {
  const face = 8, d = tileDirections(face);
  for (const [name, expected] of Object.entries(EXPECTED_CENTRE)) {
    const at = tileDirs(d, face, name), sum = [0, 0, 0];
    for (let y = 0; y < face; y++) for (let x = 0; x < face; x++) at(x, y).forEach((v, k) => { sum[k] += v; });
    const n = Math.hypot(...sum);
    assert.ok(close(sum.map(v => v / n), expected, 1e-6), name);
  }
});

test('side squares are upright and not mirrored', () => {
  const face = 16, d = tileDirections(face);
  for (const name of ['Left', 'Front', 'Right', 'Back']) {
    const at = tileDirs(d, face, name);
    assert.ok(at(face / 2, 0)[1] > at(face / 2, face - 1)[1], name); // top row looks higher
    // Moving right in the image turns clockwise seen from above (towards the viewer's right).
    const a = at(0, face / 2), b = at(face - 1, face / 2);
    assert.ok(a[2] * b[0] - a[0] * b[2] < 0, name);
  }
});

test('Top, Front and Bottom form one continuous column', () => {
  const face = 32, d = tileDirections(face);
  const top = tileDirs(d, face, 'Top'), front = tileDirs(d, face, 'Front'), bottom = tileDirs(d, face, 'Bottom');
  for (let x = 0; x < face; x++) {
    assert.ok(close(top(x, face - 1), front(x, 0), 2.5 / face));
    assert.ok(close(bottom(x, 0), front(x, face - 1), 2.5 / face));
  }
});

test('lon/lat round trip; longitude 0 is south (Back)', () => {
  for (let k = 0; k < 7; k++) {
    const lon = -3 + k, lat = -1.4 + k * 0.4667;
    const [lo, la] = dirToLonLat(...lonLatToDir(lon, lat));
    assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9);
  }
  assert.ok(close(lonLatToDir(0, 0), [0, 0, 1], 1e-12));
});
