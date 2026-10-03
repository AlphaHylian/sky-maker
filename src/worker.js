// Runs the heavy image work off the page's main thread, so the page stays responsive.
//
// Messages in:  { id, type: 'load',   rgba, w, h }        -> renders with default settings
//               { id, type: 'render', settings }
//               { id, type: 'fix',    problem, settings } -> automatic fix, then render
//               { id, type: 'export', settings, packName } -> zip bytes
// Messages out: { id, result } or { id, error }

import { buildPack, makePackIcon } from './pack.js';
import { autoFix, DEFAULTS, normalizeSettings, runPipeline } from './pipeline.js';
import { fromRGBA, toRGBA } from './image.js';

const TEMPLATE = new URL('../template/', import.meta.url);
let source = null;   // the uploaded picture, float RGB
let last = null;     // the latest pipeline result

function render(settings) {
  last = runPipeline(source, settings);
  return {
    settings: last.settings,
    info: last.info,
    template: last.template.slice(), // keep our own copy for export
    width: last.width,
    height: last.height,
    panorama: toRGBA(last.pano),
    panoWidth: last.pano.w,
    panoHeight: last.pano.h,
  };
}

async function readTemplateFile(rel) {
  const r = await fetch(new URL('mcpatcher/' + rel, TEMPLATE));
  if (!r.ok) throw new Error(`Could not load template file ${rel} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

async function handle(msg) {
  if (msg.type === 'load') {
    source = fromRGBA(msg.rgba, msg.w, msg.h);
    return render(DEFAULTS);
  }
  if (!source) throw new Error('Upload an image first.');
  if (msg.type === 'render') return render(msg.settings);
  if (msg.type === 'fix') return render(autoFix(msg.problem, source, msg.settings));
  if (msg.type === 'export') {
    const s = normalizeSettings(msg.settings);
    if (!last || JSON.stringify(s) !== JSON.stringify(last.settings)) render(s);
    const manifest = await (await fetch(new URL('manifest.json', TEMPLATE))).json();
    const zip = await buildPack({
      template: last.template, width: last.width, height: last.height,
      icon: makePackIcon(source), packName: msg.packName,
      templateFiles: manifest.files, readTemplateFile,
    });
    return zip;
  }
  throw new Error(`unknown message ${msg.type}`);
}

self.onmessage = async (e) => {
  const { id } = e.data;
  try {
    const result = await handle(e.data);
    const transfer = result instanceof Uint8Array ? [result.buffer]
      : [result.template.buffer, result.panorama.buffer];
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
