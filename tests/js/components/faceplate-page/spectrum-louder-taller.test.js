// Suite for the page spectrum's styles taken together: under every spectrum style the page offers, a louder level
// draws taller than a quieter one. The styles are the options the Display popover renders, read by their values in
// `data-v`, that the spectrum style setter takes; a style the page comes to offer is covered without this file changing.
//
// One paint is made through paintSourceScene, the page Source meter's own paint, the first of its session, under the
// Accent suite, with the section root, an effects canvas painter and a shader canvas painter all present, so the page
// has WebGL2 and decides itself which surface each style is drawn on. How tall a paint draws is the highest point any
// surface is given, as a share of the plot: an SVG path's points, the 2D context's rects and path points, the first row
// holding ink of the pixels the 2D context is handed, put directly or drawn from an image or another canvas, and the
// per-band levels the shader is handed, which are plot fractions already. Calls that take pixels off a canvas are not
// read. Every spectrum column sits at one level, both levels inside the plot.
//
// The canvases are one fake whose context records each method called on it by name and arguments, hands back what a
// small table names, keeps property writes, and reads names in capitals as numbers; a canvas a painter builds itself,
// through `OffscreenCanvas` or `document.createElement`, is the same fake. Images keep their pixels. The section root
// hands back one recording element per selector and no level bars or VU needles.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/spectrum-louder-taller.test.js

import "../../support/domseam.js";
import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import { auroraPainter } from "../../../../hqptuner/static/components/faceplate/page/aurora.js";
import { SH, paintSourceScene } from "../../../../hqptuner/static/components/faceplate/page/sourcepaint.js";
import { fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { ACCENT } from "../../../../hqptuner/static/model/gauges/meter/spectrumfx.js";
import { body, openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { setSpectrumStyle, spectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { useStorage } from "../../support/storage.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {{ name: string, args: any[] }} Call */
/** @typedef {{ width: number, height: number, calls: Call[], getContext: () => unknown }} RecordingCanvas */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

//: The Display popover's id, which its panel carries as `data-pop`.
const DISPLAY = "display";
//: The canvases, in device pixels.
const W = 480;
const H = 170;
//: The meter loop's column count.
const COLS = 600;
//: A 60 dB plot.
const RANGE = 60;
//: A quarter of the way up a 60 dB plot.
const QUIET_DB = -45;
//: Three quarters of the way up a 60 dB plot.
const LOUD_DB = -15;

/**
 * An image of `w` by `h` pixels.
 *
 * @param {number} w
 * @param {number} h
 */
const blank = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

/** What the fake context's methods hand back, by name; every other method hands back nothing. */
const TABLE = {
  createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (/** @type {number | { width: number, height: number }} */ w, /** @type {number} */ h) =>
    typeof w === "number" ? blank(w, h) : blank(w.width, w.height),
  getImageData: (
    /** @type {number} */ _x,
    /** @type {number} */ _y,
    /** @type {number} */ w,
    /** @type {number} */ h,
  ) => blank(w, h),
  createProgram: () => ({}),
  createShader: () => ({}),
  createVertexArray: () => ({}),
  createBuffer: () => ({}),
  getUniformLocation: () => ({}),
  getProgramParameter: () => true,
  getShaderParameter: () => true,
};

/**
 * A `width` by `height` canvas, W by H unless given, whose every context records the methods called on it.
 *
 * @param {number} [width]
 * @param {number} [height]
 * @returns {RecordingCanvas}
 */
function recordingCanvas(width = W, height = H) {
  /** @type {Call[]} */
  const calls = [];
  /** @type {Record<string | symbol, unknown>} */
  const kept = {};
  /** @type {Record<string, (...args: any[]) => unknown>} */
  const table = TABLE;
  const ctx = new Proxy(kept, {
    get: (_t, key) => {
      if (key in kept) return kept[key];
      const name = String(key);
      if (/^[A-Z0-9_]+$/.test(name)) return name.length;
      return (/** @type {any[]} */ ...args) => {
        calls.push({ name, args });
        return table[name]?.(...args);
      };
    },
    set: (_t, key, value) => {
      kept[key] = value;
      return true;
    },
  });
  const canvas = { width, height, calls, getContext: () => ctx };
  kept.canvas = canvas;
  return canvas;
}

/**
 * The global the canvas constructors are installed on, viewed as optional members: plain node has neither.
 *
 * @type {{ OffscreenCanvas?: unknown, document?: { createElement?: (tag: string) => unknown } }}
 */
const env = globalThis;

// A canvas a painter builds for itself, off the page or as an element, is a recording canvas too; HTML's default
// canvas is 300 by 150.
env.OffscreenCanvas = function OffscreenCanvas(/** @type {number} */ w, /** @type {number} */ h) {
  return recordingCanvas(w, h);
};
if (env.document) {
  env.document.createElement = (tag) => {
    if (tag !== "canvas") throw new Error(`no ${tag} element in this suite`);
    return recordingCanvas(300, 150);
  };
}

/**
 * A section root whose every selector finds one element recording the attributes set on it, and which holds no level
 * bars and no VU needles.
 *
 * @returns {{ writes: [string, string][], querySelector: () => object, querySelectorAll: () => never[] }}
 */
function recordingRoot() {
  /** @type {[string, string][]} */
  const writes = [];
  const el = {
    setAttribute: (/** @type {string} */ name, /** @type {string} */ value) => writes.push([name, String(value)]),
  };
  return { writes, querySelector: () => el, querySelectorAll: () => [] };
}

/** Where each 2D drawing call puts points, as their y in canvas pixels down from the top. */
/** @type {Record<string, (a: number[]) => number[]>} */
const POINTS_Y = {
  moveTo: (a) => [a[1]],
  lineTo: (a) => [a[1]],
  quadraticCurveTo: (a) => [a[1], a[3]],
  bezierCurveTo: (a) => [a[1], a[3], a[5]],
  arc: (a) => [a[1] - a[2]],
  rect: (a) => [a[1], a[1] + a[3]],
  fillRect: (a) => [a[1], a[1] + a[3]],
  strokeRect: (a) => [a[1], a[1] + a[3]],
};

/**
 * The highest share of the plot a set of SVG `d` writes reaches.
 *
 * @param {[string, string][]} writes
 */
function svgTop(writes) {
  const ys = writes
    .filter(([name]) => name === "d")
    .flatMap(([, d]) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).filter((_, i) => i % 2 === 1).map(Number));
  return Math.max(0, ...ys.map((y) => 1 - y / SH));
}

/**
 * The first row of an image's region holding a pixel that is not fully clear, counted from the image's top; null where
 * every pixel there is clear. The region is the whole image unless given.
 *
 * @param {{ width: number, height: number, data: ArrayLike<number> }} img
 * @param {{ x: number, y: number, w: number, h: number }} [region]
 * @returns {number | null}
 */
function firstInkedRow(img, region = { x: 0, y: 0, w: img.width, h: img.height }) {
  for (let y = Math.max(0, region.y); y < Math.min(img.height, region.y + region.h); y++) {
    for (let x = Math.max(0, region.x); x < Math.min(img.width, region.x + region.w); x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) return y;
    }
  }
  return null;
}

/**
 * The topmost row a drawing source holds ink in: a recording canvas by everything drawn on it, an image by its pixels.
 * A canvas already being read reads as holding none, so a canvas drawn onto itself ends.
 *
 * @param {any} src
 * @param {Set<unknown>} reading
 * @returns {number | null}
 */
function sourceTop(src, reading) {
  if (Array.isArray(src?.calls)) return reading.has(src) ? null : topRow(src, reading);
  if (src?.data) return firstInkedRow(src);
  return null;
}

/**
 * The row a `putImageData` puts ink on first, down from the top of the canvas: the first inked row of the region it
 * puts, the whole image unless given, moved down by where it puts it.
 *
 * @param {any[]} args
 * @returns {number[]}
 */
function putRows(args) {
  const [img, _dx, dy, x = 0, y = 0, w = img.width, h = img.height] = args;
  const row = firstInkedRow(img, { x, y, w, h });
  return row === null ? [] : [dy + row];
}

/**
 * The row a `drawImage` puts ink on first, down from the top of the canvas: its source's topmost inked row, scaled
 * from the source rect, the whole source unless given, into the destination rect.
 *
 * @param {any[]} args
 * @param {Set<unknown>} reading
 * @returns {number[]}
 */
function drawRows([src, ...a], reading) {
  const top = sourceTop(src, reading);
  if (top === null) return [];
  const [, sy, , sh, , dy, , dh] =
    a.length === 8 ? a : [0, 0, src.width, src.height, a[0], a[1], a[2] ?? src.width, a[3] ?? src.height];
  return top < sy + sh ? [dy + (Math.max(top, sy) - sy) * (dh / sh)] : [];
}

/**
 * The rows a pixel call puts ink on first, down from the top of the canvas it is made on; none for any other call.
 *
 * @param {Call} c
 * @param {Set<unknown>} reading
 * @returns {number[]}
 */
function inkRows(c, reading) {
  if (c.name === "putImageData") return putRows(c.args);
  return c.name === "drawImage" ? drawRows(c.args, reading) : [];
}

/**
 * The topmost row, down from the top of `canvas`, that its drawing calls reach: path points and rects where they are
 * placed, pixels where they hold ink. Null where nothing is drawn.
 *
 * @param {RecordingCanvas} canvas
 * @param {Set<unknown>} [reading]
 * @returns {number | null}
 */
function topRow(canvas, reading = new Set()) {
  reading.add(canvas);
  const ys = canvas.calls.flatMap((c) => [...(POINTS_Y[c.name]?.(c.args) ?? []), ...inkRows(c, reading)]);
  reading.delete(canvas);
  return ys.length ? Math.min(...ys) : null;
}

/**
 * The highest share of the plot a 2D canvas's drawing reaches.
 *
 * @param {RecordingCanvas} canvas
 */
function canvasTop(canvas) {
  const row = topRow(canvas);
  return row === null ? 0 : Math.max(0, 1 - row / canvas.height);
}

/**
 * The highest band level a shader canvas is handed.
 *
 * @param {Call[]} calls
 */
function shaderTop(calls) {
  return Math.max(0, ...calls.filter((c) => c.name === "uniform1fv").flatMap((c) => Array.from(c.args[1])));
}

/**
 * How tall one paint of a spectrum with every column at `db` draws under `style`, as a share of the plot, on whichever
 * surface draws it.
 *
 * @param {string} style
 * @param {number} db
 */
function drawnTop(style, db) {
  const disp = new Float32Array(COLS).fill(db);
  const scene = { levels: [], vu: [], spectrum: { disp, ghost: disp }, raw: disp };
  const root = recordingRoot();
  const fxCanvas = recordingCanvas();
  const glCanvas = recordingCanvas();
  const fx = fxPainter(/** @type {any} */ (fxCanvas), { glass: "#000" });
  const aurora = auroraPainter(/** @type {any} */ (glCanvas));
  paintSourceScene(
    /** @type {any} */ (root),
    scene,
    { fx, aurora },
    { range: RANGE, picked: style, suite: ACCENT, last: "" },
  );
  return Math.max(svgTop(root.writes), canvasTop(fxCanvas), shaderTop(glCanvas.calls));
}

/**
 * The spectrum styles the page offers: the option values the Display popover renders that the style setter takes.
 *
 * @returns {string[]}
 */
function offeredStyles() {
  useStorage();
  body.value = "chain";
  openStage.value = null;
  openPopover.value = DISPLAY;
  const { seen } = renderTree(html`<${Faceplate} />`);
  const values = seen
    .filter((/** @type {VNode} */ n) => n.type === "button" && typeof n.props?.["data-v"] === "string")
    .map((/** @type {VNode} */ n) => String(n.props["data-v"]));
  const styles = [...new Set(values)].filter((v) => {
    setSpectrumStyle(v);
    return spectrumStyle.value === v;
  });
  if (!styles.length) throw new Error("the Display popover rendered no spectrum style to cover");
  return styles;
}

for (const style of offeredStyles()) {
  test(`test_a_louder_level_draws_taller_than_a_quieter_one_under_${style}`, () => {
    const loud = drawnTop(style, LOUD_DB);
    const quiet = drawnTop(style, QUIET_DB);
    assert.ok(loud > quiet, `${style}: ${LOUD_DB} dBFS reaches ${loud}, ${QUIET_DB} dBFS reaches ${quiet}`);
  });
}
