// Bakes pixelfx effects (tools/vendor/pixelfx, MIT) into sprite sheets the
// game plays (pfx.js) - the game never runs pixelfx's code itself, drawing
// those effects live costs too much on a phone (docs/ROADMAP-effects.md 7b).
//
//   node tools/make_pixelfx.mjs
//
// Reads tools/pixelfx-list.json, writes assets/fx/<name>-<layer>.png and the
// GENERATED pixelfx-data.js (never edit that by hand, re-run this).
//
// Look "D" (chosen in the Faz 0 study): translucent writes are true alpha,
// not pixelfx's 4x4 dither checker; the 4x Scale2x upscale and the glow
// happen at play time, on the GPU (pfx.js), so the sheets stay 1x and small.
//
// Layers per effect, each its own PNG (empty ones are skipped):
//   fc / bc  color, in front of / behind the fighters
//   fl / bl  light (additive): alpha = its brightest channel, color divided
//            by it, so additive blending over a transparent canvas adds
//            exactly the light (the arena's backdrop is CSS, not WebGL)
// Every frame of an effect is cropped to the same box (the union of all its
// frames), laid out left to right, top to bottom.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createFrame, clearFrame, createFx, stockActor, Painter } from "./vendor/pixelfx/src/core/index.js";
import { effects } from "./vendor/pixelfx/src/fx/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "fx");
const MAX_TEX = 4096; // safe WebGL texture size on phones
const MARGIN = 20;    // default room around the effect's own box for spill (item.margin)

// no dithering: translucent writes blend for real (the painter's own blendPx)
const ditherPut = Painter.prototype.put;
Painter.prototype.put = function (sx, sy, c, a = 1) {
  if (a * this.fade < 1) { if (c) this.blendPx(sx, sy, c, a); return; }
  return ditherPut.call(this, sx, sy, c, a);
};

// The stock dummy's shape for effects that wrap a body, never its paint
// (all-transparent body colors): the game's fighters are painted, not pixels.
function blankDummy() {
  const a = stockActor(2);
  return Object.assign({}, a, { pixels: new Uint32Array(a.w * a.h) });
}

// --- PNG (RGBA, 8 bit) with node's zlib only ---------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Size: light layers are wide soft gradients - the faintest of them can't be
// seen once added over the arena but they made sheets several times bigger
// (wider crop boxes, poor compression). Light dimmer than LIGHT_CUT is
// dropped, translucent color fainter than COLOR_CUT too, and the rest is
// stored in steps of 4 (64 levels: no visible banding once glowing).
const LIGHT_CUT = 14, COLOR_CUT = 8;
const q4 = v => Math.min(255, Math.round(v / 4) * 4);

// light -> straight-alpha RGBA: alpha = brightest channel
function lightPixel(l) {
  l &= 0xffffff;
  if (!l) return 0;
  const r = l & 255, g = (l >>> 8) & 255, b = (l >>> 16) & 255, m = Math.max(r, g, b), k = 255 / m;
  if (m < LIGHT_CUT) return 0;
  return ((q4(m) << 24) | (q4(b * k) << 16) | (q4(g * k) << 8) | q4(r * k)) >>> 0;
}
function colorPixel(c) {
  const a = c >>> 24;
  if (a === 255 || !c) return c >>> 0;
  if (a < COLOR_CUT) return 0;
  return ((q4(a) << 24) | (c & 0xffffff)) >>> 0;
}
const scaleAlpha = (c, f) => {
  if (!c) return 0;
  const a = Math.round((c >>> 24) * f);
  return a < COLOR_CUT ? 0 : ((a << 24) | (c & 0xffffff)) >>> 0;
};

function bake(item) {
  const mod = effects[item.id];
  if (!mod) throw new Error("no pixelfx effect " + item.id);
  const meta = mod.meta || {};
  const [W0, H0] = meta.size || [128, 128], [ox0, oy0] = meta.origin || [W0 / 2, H0 / 2];
  const M = item.margin || MARGIN, W = W0 + 2 * M, H = H0 + 2 * M, OX = ox0 + M, OY = oy0 + M;
  const opts = Object.assign({ x: 0, y: 0 }, item.opts || {});
  if (meta.actor) opts.actor = blankDummy();
  const fx = createFx(mod, opts);
  const fps = item.fps || meta.fps || 30;
  const dur = meta.loop ? (item.loopSec || meta.duration || 1) : Math.min(meta.duration || 1, item.maxSec || Infinity);
  const n = Math.max(1, Math.round(dur * fps));
  const fadeSec = item.fadeSec || 0;
  if (item.warm) for (let t = 0; t < item.warm; t += 1 / fps) fx.update(1 / fps);

  const frame = createFrame(W, H, -OX, -OY);
  const layers = { bc: [], bl: [], fc: [], fl: [] };
  for (let i = 0; i < n; i++) {
    if (i > 0) fx.update(1 / fps);
    const t = i / fps, fade = fadeSec && t > dur - fadeSec ? Math.max(0, (dur - t) / fadeSec) : 1;
    for (const [side, c, l] of [["back", "bc", "bl"], ["front", "fc", "fl"]]) {
      clearFrame(frame);
      fx.draw(frame, side);
      const C = new Uint32Array(W * H), L = new Uint32Array(W * H);
      for (let j = 0; j < W * H; j++) {
        C[j] = colorPixel(fade < 1 ? scaleAlpha(frame.color[j], fade) : frame.color[j]);
        L[j] = fade < 1 ? scaleAlpha(lightPixel(frame.light[j]), fade) : lightPixel(frame.light[j]);
      }
      layers[c].push(C); layers[l].push(L);
    }
  }

  // one crop box for every frame and layer
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const k in layers) for (const F of layers[k]) for (let j = 0; j < F.length; j++) if (F[j] >>> 24) {
    const x = j % W, y = (j / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error(item.id + " draws nothing");
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
  if (x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1) console.warn("  ! " + item.id + " touches the bake margin - may be clipped");
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const cols = Math.max(1, Math.min(n, Math.floor(MAX_TEX / cw))), rows = Math.ceil(n / cols);
  if (rows * ch > MAX_TEX) throw new Error(item.id + ": " + n + " frames of " + cw + "x" + ch + " do not fit " + MAX_TEX + "px - lower fps or maxSec");

  const name = (item.as || item.id).replace(/\//g, "-");
  const files = {};
  let bytes = 0;
  for (const k in layers) {
    const F = layers[k];
    if (!F.some(f => f.some(p => p >>> 24))) continue;
    const sw = cols * cw, sh = rows * ch, out = Buffer.alloc(sw * sh * 4);
    F.forEach((f, i) => {
      const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const p = f[(y0 + y) * W + x0 + x], o = ((cy + y) * sw + cx + x) * 4;
        out[o] = p & 255; out[o + 1] = (p >>> 8) & 255; out[o + 2] = (p >>> 16) & 255; out[o + 3] = p >>> 24;
      }
    });
    const file = `assets/fx/${name}-${k}.png`, buf = png(sw, sh, out);
    writeFileSync(join(ROOT, file), buf);
    files[k] = file; bytes += buf.length;
  }
  // contact moments inside what was baked (a cut-short effect loses the later ones)
  const hits = (item.hit !== undefined ? [item.hit] : mod.act && mod.act.hits ? mod.act.hits.map(h => +h.t.toFixed(3)) : []).filter(t => t < dur);
  console.log(`  ${name}: ${n} frames ${cw}x${ch} @${fps}fps, ${Object.keys(files).join(" ")}, ${(bytes / 1024).toFixed(0)} KB`);
  const tx = mod.act && mod.act.target ? mod.act.target.x : null; // a caster->target effect: where its target stands
  return [name, { src: item.id, fps, frames: n, cols, cell: [cw, ch], origin: [OX - x0, OY - y0], loop: !!meta.loop, layers: files, hits, tx }];
}

const list = JSON.parse(readFileSync(join(ROOT, "tools", "pixelfx-list.json"), "utf8")).effects;
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png")) unlinkSync(join(OUT, f)); // no stale sheets
console.log(`baking ${list.length} effects into assets/fx/`);
const data = Object.fromEntries(list.map(bake));
const js = `// GENERATED by tools/make_pixelfx.mjs from tools/pixelfx-list.json - do not edit by hand,\n// change the list and re-run \`node tools/make_pixelfx.mjs\`.\n// Effects: pixelfx (https://github.com/patch-gg/pixelfx), MIT, Copyright (c) 2026 Patch and\n// Hugo Duprez - see tools/vendor/pixelfx/LICENSE and assets/CREDITS.md.\n// Per effect: frames at fps, laid out cols per row, each cell [w, h] px with the\n// effect's origin at origin [x, y]; layers = sprite sheets (fc/bc color in front\n// of/behind the fighters, fl/bl additive light); hits = pixelfx's contact times (s);
// tx = for a caster->target effect (a slash), how far ahead (px) its target stands.\nconst PFX_DATA = ${JSON.stringify(data, null, 1).replace(/\n\s*/g, " ")};\n`;
writeFileSync(join(ROOT, "pixelfx-data.js"), js);
console.log("wrote pixelfx-data.js");
