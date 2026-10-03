// MCPatcher / OptiFine 3x2 sky geometry.
//
// Reproduces SkyRenderer.Layer.render + drawTile from MCPatcher, the code that turns the
// 3x2 sky image into a cube around the player.
// World axes are Minecraft's: x = east, y = up, z = south.

// Template tile index -> label, as printed on "Sky Template 1024x1024.png".
export const TILE_NAMES = ['Bottom', 'Top', 'Back', 'Left', 'Front', 'Right'];
export const TILE_INDEX = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));

// Compass longitudes: 0 = south (+z, the Back square), +90 deg = west.
export const COMPASS_LON = { south: 0, west: Math.PI / 2, north: Math.PI, east: -Math.PI / 2 };

/** 3x3 rotation matrix (row-major array of 9) with the same meaning as glRotatef. */
export function rot(deg, x, y, z) {
  const n = Math.hypot(x, y, z);
  x /= n; y /= n; z /= n;
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t,
  ];
}

export function matMul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}

/** Model matrix used for each tile, in the order MCPatcher draws them. */
export function tileMatrices() {
  let m = rot(-90, 0, 1, 0); // vanilla RenderGlobal.renderSky, before the custom sky is drawn
  const out = [];
  m = matMul(matMul(m, rot(90, 1, 0, 0)), rot(-90, 0, 0, 1));
  out[4] = m;                              // "north"
  out[1] = matMul(m, rot(90, 1, 0, 0));    // "top"
  out[0] = matMul(m, rot(-90, 1, 0, 0));   // "bottom"
  m = matMul(m, rot(90, 0, 0, 1)); out[5] = m;
  m = matMul(m, rot(90, 0, 0, 1)); out[2] = m;
  m = matMul(m, rot(90, 0, 0, 1)); out[3] = m;
  return out;
}

export const TILE_MATRICES = tileMatrices();

/**
 * Point on the unit cube for tile-local coordinates u, v in 0..1 (u across, v down).
 * Writes x, y, z into `out` starting at `o`.
 */
export function tilePoint(tile, u, v, out, o = 0) {
  const m = TILE_MATRICES[tile];
  const lx = 2 * u - 1, lz = 2 * v - 1; // drawTile quad on y = -1
  out[o] = m[0] * lx - m[1] + m[2] * lz;
  out[o + 1] = m[3] * lx - m[4] + m[5] * lz;
  out[o + 2] = m[6] * lx - m[7] + m[8] * lz;
  return out;
}

/** Unit view direction for every pixel of a 3x2 sky image: Float32Array of (2F * 3F * 3). */
export function tileDirections(face) {
  const W = 3 * face, out = new Float32Array(2 * face * W * 3), p = [0, 0, 0];
  for (let tile = 0; tile < 6; tile++) {
    const r = Math.floor(tile / 3), c = tile % 3;
    for (let y = 0; y < face; y++) {
      for (let x = 0; x < face; x++) {
        tilePoint(tile, (x + 0.5) / face, (y + 0.5) / face, p);
        const n = Math.hypot(p[0], p[1], p[2]), i = ((r * face + y) * W + c * face + x) * 3;
        out[i] = p[0] / n; out[i + 1] = p[1] / n; out[i + 2] = p[2] / n;
      }
    }
  }
  return out;
}

/** Longitude 0 = south (the Back square), +90 deg = west. Latitude +90 deg = up. Input need not be unit length. */
export function dirToLonLat(x, y, z) {
  const n = Math.hypot(x, y, z);
  return [Math.atan2(-x, z), Math.asin(Math.max(-1, Math.min(1, y / n)))];
}

export function lonLatToDir(lon, lat) {
  return [-Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
}
