// Sky layer .properties files (MCPatcher / OptiFine): read, edit, check and write them.
//
// Times are minutes after midnight (0-1439). Minecraft's day starts at 6:00 (tick 0).

export const DAY = 1440;

export const BLENDS = ['add', 'replace', 'alpha', 'subtract', 'multiply', 'dodge', 'burn', 'screen', 'overlay'];
export const DEFAULT_AXIS = [0, 0, 1]; // used when a layer has no axis= line: turns with the sun and moon

/** What each template layer is for, shown in the editor. */
export const LAYER_INFO = {
  'sky1.properties': 'Sunset glow',
  'sky2.properties': 'Sunrise glow',
  'sky3.properties': 'Your picture (day sky)',
  'sky4.properties': 'Stars',
  'sky6.properties': 'Night tint',
  'sky7.properties': 'Sunset flare',
  'sky8.properties': 'Sunrise flare',
};
export const MAIN_LAYER = 'sky/world0/sky3.properties'; // the layer that shows your picture; it cannot be turned off

const KNOWN = ['startFadeIn', 'endFadeIn', 'startFadeOut', 'endFadeOut', 'blend', 'rotate', 'speed', 'axis', 'source'];

export const norm = (m) => ((m % DAY) + DAY) % DAY;

export function parseTime(s) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s ?? ''));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

/** "H:MM", the way the template writes times. */
export const formatTime = (min) => `${Math.floor(norm(min) / 60)}:${String(norm(min) % 60).padStart(2, '0')}`;

/** "HH:MM", for <input type="time">. */
export const inputTime = (min) => formatTime(min).padStart(5, '0');

export function parseProperties(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    const i = t.search(/[=:]/);
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/** A layer object from a .properties file. A missing startFadeOut is filled in the way OptiFine does. */
export function readLayer(rel, text) {
  const p = parseProperties(text);
  const startFadeIn = parseTime(p.startFadeIn), endFadeIn = parseTime(p.endFadeIn), endFadeOut = parseTime(p.endFadeOut);
  let startFadeOut = parseTime(p.startFadeOut);
  if (startFadeOut === null && startFadeIn !== null && endFadeIn !== null && endFadeOut !== null) {
    startFadeOut = norm(endFadeOut - norm(endFadeIn - startFadeIn)); // fade out takes as long as fade in
  }
  const axis = p.axis ? p.axis.split(/\s+/).map(Number) : null;
  const extra = Object.fromEntries(Object.entries(p).filter(([k]) => !KNOWN.includes(k)));
  return {
    file: rel,
    enabled: true,
    source: p.source ?? '',
    startFadeIn, endFadeIn, startFadeOut, endFadeOut,
    blend: p.blend ?? 'add',
    rotate: p.rotate === undefined ? true : p.rotate === 'true',
    speed: p.speed === undefined ? 1 : Number(p.speed),
    axis: axis && axis.length === 3 && axis.every(Number.isFinite) ? axis : null,
    extra,
  };
}

const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** The .properties text for a layer. All four fade times are always written. */
export function writeLayer(l) {
  const lines = [
    `startFadeIn=${formatTime(l.startFadeIn)}`,
    `endFadeIn=${formatTime(l.endFadeIn)}`,
    `startFadeOut=${formatTime(l.startFadeOut)}`,
    `endFadeOut=${formatTime(l.endFadeOut)}`,
    `blend=${l.blend}`,
    `rotate=${l.rotate}`,
  ];
  if (l.speed !== 1) lines.push(`speed=${num(l.speed)}`);
  if (l.axis) lines.push(`axis=${l.axis.map(num).join(' ')}`);
  lines.push(`source=${l.source}`);
  for (const [k, v] of Object.entries(l.extra || {})) lines.push(`${k}=${v}`);
  return lines.join('\n') + '\n';
}

/** Problems that would make OptiFine skip the layer (or make it look wrong). Empty when the layer is fine. */
export function checkLayer(l) {
  const errs = [];
  const names = ['startFadeIn', 'endFadeIn', 'startFadeOut', 'endFadeOut'];
  for (const n of names) if (l[n] === null || l[n] === undefined) errs.push(`${n} is missing or not a time.`);
  if (errs.length) return errs;
  // OptiFine adds the four gaps around the clock; they must make exactly 24 hours.
  const t = names.map(n => l[n]);
  const gaps = t.map((v, i) => norm(t[(i + 1) % 4] - v));
  if (gaps.reduce((a, b) => a + b, 0) !== DAY) {
    errs.push('The times must go in order around the clock: start fade in, end fade in, start fade out, end fade out.');
  }
  if (!BLENDS.includes(l.blend)) errs.push(`Unknown blend "${l.blend}".`);
  if (!Number.isFinite(l.speed) || l.speed < 0) errs.push('Speed must be a number, 0 or more.');
  if (l.axis && !l.axis.every(Number.isFinite)) errs.push('Each axis value must be a number.');
  else if (l.axis && l.axis.every(v => v === 0)) errs.push('Axis cannot be 0 0 0.');
  return errs;
}

/** How visible the layer is (0-1) at a time of day, following the fade times linearly. */
export function brightnessAt(l, min) {
  const b = norm(l.endFadeIn - l.startFadeIn), c = norm(l.startFadeOut - l.startFadeIn), d = norm(l.endFadeOut - l.startFadeIn);
  const t = norm(min - l.startFadeIn);
  if (t < b) return t / b;
  if (t <= c) return 1;
  if (t < d) return 1 - (t - c) / (d - c);
  return 0;
}

/** Minutes after midnight for a Minecraft time in ticks (0 = 6:00). */
export const ticksToMinutes = (ticks) => norm(Math.round(ticks * 0.06) + 360);
