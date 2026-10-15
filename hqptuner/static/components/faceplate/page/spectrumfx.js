// The page spectrum's effects canvas, laid over the SVG trace: each meter paint draws the picked spectrum style from
// the per-frame steps in model/gauges/meter/spectrumfx.js. Trace and aurora leave the canvas clear for the SVG; bars draw
// one bar per band with peak caps; ridges stack their rows up the plot, each newer row lower and in front; fade
// strokes the live trace over a blurred halo of where it has been, held between paints as an image so each paint dims
// it and merges in the trace's fresh glow; flames draw their heat grid as pixels scaled over the whole canvas, heat 0
// clear. Caps, ridges, halo and flames move on the seconds each paint is told passed since the last, not per paint. A
// change of style, or a paint with no spectrum, starts the next style's state afresh. Each bar takes the color suite's
// color at its height, or under a suite with a fixed bar gradient is drawn over that gradient; the ridge lines, the fade trace and its halo are colored by level, and the caps take the
// suite's top color. Accent draws in the accent in force at each paint.

import {
  ACCENT,
  BANDS,
  HALO_FRESH,
  RIDGE_ROWS,
  bandsOf,
  fractionsOf,
  stepCaps,
  stepHalo,
  stepRidges,
  suiteBarStops,
  suiteColor,
  suiteHaloStops,
  suiteLineStops,
} from "../../../model/gauges/meter/spectrumfx.js";
import { fireColors, fireSize, fireSource, stepFire } from "../../../model/gauges/meter/fire.js";
import { stepsDue } from "../../../model/gauges/meter/steps.js";
import { STEP_MS } from "../../../store/meter/loop.js";
import { accentInForce } from "../../../store/ui/theme.js";

/** @typedef {import("../../../model/gauges/meter/meter.js").SpectrumHold} SpectrumHold */
/** @typedef {import("../../../model/gauges/meter/spectrumfx.js").CapState} CapState */
/** @typedef {import("../../../model/gauges/meter/spectrumfx.js").HaloState} HaloState */
/** @typedef {import("../../../model/gauges/meter/spectrumfx.js").RidgeState} RidgeState */

/**
 * The CSS colors a painter draws with besides the color suite's.
 *
 * @typedef {object} FxColors
 * @property {string} glass  the fill under each ridge, hiding the rows behind it
 */

/**
 * The flames' color table and the suite, accent and top heat it was built for.
 *
 * @typedef {object} FireInk
 * @property {string} key
 * @property {Uint32Array} words  one RGBA word per heat, over the bytes fireColors gives
 */

/**
 * The small canvas the flames' heat grid is put on, one pixel a cell, and the image put on it.
 *
 * @typedef {object} FireSheet
 * @property {OffscreenCanvas} canvas
 * @property {OffscreenCanvasRenderingContext2D} ctx
 * @property {ImageData} img
 * @property {Uint32Array} cells  the image's pixels, one word a cell
 */

/**
 * Each style's state between paints: the fade halo's step and the halo image the last fade paint left; the part step
 * the last ridges or flames paint left owed; the flames' heat grid, color table and sheet.
 *
 * @typedef {object} FxState
 * @property {CapState | null} caps
 * @property {RidgeState | null} ridges
 * @property {HaloState} halo
 * @property {ImageData | null} glow
 * @property {Uint16Array | null} heat
 * @property {number} owed  steps, as stepsDue carries them
 * @property {FireInk | null} ink
 * @property {FireSheet | null} sheet
 */

/**
 * What one style's paint draws from: the context, the canvas size, the plot fractions per column, the style's state,
 * the color suite picked, the accent in force and the seconds since the last paint.
 *
 * @typedef {object} Frame
 * @property {CanvasRenderingContext2D} ctx
 * @property {HTMLCanvasElement} canvas
 * @property {FxColors} colors
 * @property {Float32Array} fracs
 * @property {FxState} state
 * @property {string} suite
 * @property {string} accent  `#rrggbb`
 * @property {number} dt  s
 */

/** The seconds a paint told none runs for: one meter loop step. */
const DT = STEP_MS / 1000;
const BAR_GAP = 0.25; // share of a band's width left clear beside its bar
const CAP_PX = 2; // a peak cap's height, canvas pixels
const RIDGE_OVER = 0.5; // share of a row step the back ridge row's baseline sits above the plot's top
const RIDGE_AMP = 0.35; // a full-scale ridge's height, share of the plot height
const RIDGE_LINE = 1.5; // a ridge's stroke width, canvas pixels
const TRACE_LINE = 1.5; // the fade trace's stroke width, CSS pixels, as the SVG trace's
const HALO_LINE = 6; // the halo's stroke width before its blur, CSS pixels
const HALO_BLUR = 2; // the halo's blur radius, CSS pixels
/**
 * Fade reads its halo back every paint: the context is asked for one kept where reading back is cheap.
 *
 * @type {CanvasRenderingContext2DSettings}
 */
const CTX_OPTS = { willReadFrequently: true };

/**
 * The canvas size, in device pixels, for a box `ratio` device pixels to the CSS pixel: each side rounded to the
 * nearest pixel and never under one.
 *
 * @param {{ width: number, height: number }} box  CSS pixels
 * @param {number} ratio
 * @returns {{ width: number, height: number }}
 */
export function fitCanvas(box, ratio) {
  return {
    width: Math.max(1, Math.round(box.width * ratio)),
    height: Math.max(1, Math.round(box.height * ratio)),
  };
}

/**
 * Fill one rect per band across the canvas, the band's level a fraction of its height: a bar down to the floor, or a
 * cap `thick` pixels deep under the level. Where `ink` is given, each band fills in the color it gives the band's
 * level.
 *
 * @param {Frame} f
 * @param {Float32Array} lvls  plot fractions
 * @param {number | null} thick  pixels
 * @param {((lvl: number) => string) | null} ink
 */
function fillBands(f, lvls, thick, ink) {
  const { width: w, height: h } = f.canvas;
  const bw = w / lvls.length;
  lvls.forEach((lvl, b) => {
    if (ink) f.ctx.fillStyle = ink(lvl);
    f.ctx.fillRect(b * bw, h - lvl * h, bw * (1 - BAR_GAP), thick ?? lvl * h);
  });
}

/**
 * A vertical gradient from `y0` to `y1` through `stops`, each its offset and color.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} y0
 * @param {number} y1
 * @param {[number, string][]} stops
 * @returns {CanvasGradient}
 */
function vertical(ctx, y0, y1, stops) {
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  return grad;
}

/**
 * Bars: the bands, each with its peak cap; each in the suite's color at its height, or all over the suite's fixed bar
 * gradient from the floor to full scale where it has one, the caps in the suite's top color.
 *
 * @param {Frame} f
 */
function bars(f) {
  const { ctx, canvas, state, suite, accent } = f;
  const bands = bandsOf(f.fracs, BANDS);
  state.caps = stepCaps(state.caps, bands, f.dt);
  const fixed = suiteBarStops(suite, accent);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (fixed.length) {
    ctx.fillStyle = vertical(ctx, canvas.height, 0, fixed);
    fillBands(f, bands, null, null);
  } else {
    fillBands(f, bands, null, (lvl) => suiteColor(suite, lvl, accent));
  }
  ctx.fillStyle = suiteColor(suite, 1, accent);
  fillBands(f, state.caps.lvl, CAP_PX, null);
}

/**
 * Ridges: oldest first, highest up; each row a line colored by level over its baseline, filled down to it so the rows
 * behind hide. The baselines spread from a line's width above the floor to RIDGE_OVER of a step past the top, so the
 * stack fills the plot, the back rows' ridges run off its top, and no baseline lies on the top edge. The rows step on
 * as many steps as stepsDue gives the time since the last paint, the first paint at least one.
 *
 * @param {Frame} f
 */
function ridges(f) {
  const { ctx, canvas, colors, state } = f;
  const { width: w, height: h } = canvas;
  const due = stepsDue(state.owed, f.dt);
  state.owed = due.owed;
  for (let k = 0; k < due.steps || !state.ridges; k++) state.ridges = stepRidges(state.ridges, f.fracs);
  const rows = state.ridges.rows;
  const step = (h - RIDGE_LINE) / (RIDGE_ROWS - 1 - RIDGE_OVER);
  const stops = suiteLineStops(f.suite, f.accent);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colors.glass;
  ctx.lineWidth = RIDGE_LINE;
  for (let k = rows.length - 1; k >= 0; k--) {
    const row = rows[k];
    const base = h - RIDGE_LINE - k * step;
    ctx.strokeStyle = vertical(ctx, base, base - h * RIDGE_AMP, stops);
    ctx.beginPath();
    ctx.moveTo(0, base);
    for (let c = 0; c < row.length; c++) ctx.lineTo(((c + 0.5) / row.length) * w, base - row[c] * h * RIDGE_AMP);
    ctx.lineTo(w, base);
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Start a path through the plot fractions across the canvas, a point at each column's center.
 *
 * @param {Frame} f
 */
function tracePath(f) {
  const { ctx, canvas, fracs } = f;
  const { width: w, height: h } = canvas;
  ctx.beginPath();
  for (let c = 0; c < fracs.length; c++) ctx.lineTo(((c + 0.5) / fracs.length) * w, h - fracs[c] * h);
}

/**
 * Merge `held`, the halo the last paint left, dimmed to `keep` of its alpha, into `fresh`, this paint's glow: each
 * pixel takes the stronger of the two. A dimmed pixel loses at least one step of alpha, so where rounding alone would
 * hold a faint residue for good, the halo still fades to clear.
 *
 * @param {Uint8ClampedArray} fresh  RGBA, written in place
 * @param {Uint8ClampedArray} held  RGBA
 * @param {number} keep  share of alpha kept, 0 to 1
 */
function mergeHalo(fresh, held, keep) {
  for (let i = 3; i < fresh.length; i += 4) {
    const a = held[i];
    const dimmed = Math.min(a - 1, a * keep);
    if (dimmed <= fresh[i]) continue;
    fresh[i - 3] = held[i - 3];
    fresh[i - 2] = held[i - 2];
    fresh[i - 1] = held[i - 1];
    fresh[i] = dimmed;
  }
}

/**
 * Fade: a blurred halo of the trace, merged over the last paint's halo dimmed by the share stepHalo gives, then the
 * live trace stroked crisp on top. The halo is read back before the trace is stroked, so the trace never lingers in it.
 * A halo image the canvas has been resized out from under starts afresh. Trace and halo are colored by level alike,
 * the halo at its starting strength in each color.
 *
 * @param {Frame} f
 */
function fade(f) {
  const { ctx, canvas, state } = f;
  const { width: w, height: h } = canvas;
  const px = globalThis.devicePixelRatio || 1;
  const held = state.glow?.width === w && state.glow.height === h ? state.glow : null;
  const stops = suiteLineStops(f.suite, f.accent);
  state.halo = stepHalo(held ? state.halo : HALO_FRESH, f.dt);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = vertical(ctx, h, 0, suiteHaloStops(f.suite, f.accent));
  ctx.lineJoin = "round";
  ctx.save();
  ctx.lineWidth = HALO_LINE * px;
  ctx.filter = `blur(${HALO_BLUR * px}px)`;
  tracePath(f);
  ctx.stroke();
  ctx.restore();
  const glow = ctx.getImageData(0, 0, w, h);
  if (held) {
    mergeHalo(glow.data, held.data, 1 - state.halo.dim);
    ctx.putImageData(glow, 0, 0);
  }
  state.glow = glow;
  ctx.strokeStyle = vertical(ctx, h, 0, stops);
  ctx.lineWidth = TRACE_LINE * px;
  tracePath(f);
  ctx.stroke();
}

/**
 * The flames' color table for `suite`, `accent` and top heat `max`: the one held, unless it was built for others.
 *
 * @param {FxState} state
 * @param {string} suite
 * @param {string} accent
 * @param {number} max
 * @returns {Uint32Array}  one RGBA word per heat
 */
function fireInk(state, suite, accent, max) {
  const key = `${suite} ${accent} ${max}`;
  if (state.ink?.key !== key) state.ink = { key, words: words(fireColors(suite, accent, max)) };
  return state.ink.words;
}

/**
 * A view of `bytes` four to a word, so a store moves one RGBA pixel whole.
 *
 * @param {Uint8ClampedArray} bytes
 * @returns {Uint32Array}
 */
function words(bytes) {
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

/**
 * A sheet `cols` by `rows` pixels: the one held, unless it is another size. Null where no canvas can be made.
 *
 * @param {FxState} state
 * @param {number} cols
 * @param {number} rows
 * @returns {FireSheet | null}
 */
function fireSheet(state, cols, rows) {
  const held = state.sheet;
  if (held?.img.width === cols && held.img.height === rows) return held;
  const canvas = new OffscreenCanvas(cols, rows);
  const ctx = canvas.getContext("2d");
  if (!ctx) return (state.sheet = null);
  const img = ctx.createImageData(cols, rows);
  state.sheet = { canvas, ctx, img, cells: words(img.data) };
  return state.sheet;
}

/**
 * Flames: the heat grid as many steps on from the last paint's as stepsDue gives the time since it, or from a cold
 * grid where the last is another size, its bottom row lit by the bands, each cell in the color fireColors gives its
 * heat, put on a sheet a pixel a cell and scaled over the whole canvas.
 *
 * @param {Frame} f
 */
function fire(f) {
  const { ctx, canvas, state } = f;
  const { width: w, height: h } = canvas;
  const size = fireSize(w, h);
  const source = fireSource(f.fracs, size);
  const due = stepsDue(state.owed, f.dt);
  state.owed = due.owed;
  if (state.heat?.length !== size.cols * size.rows) state.heat = new Uint16Array(size.cols * size.rows);
  for (let k = 0; k < due.steps; k++) state.heat = stepFire(state.heat, source, size, Math.random);
  const ink = fireInk(state, f.suite, f.accent, size.max);
  const sheet = fireSheet(state, size.cols, size.rows);
  ctx.clearRect(0, 0, w, h);
  if (!sheet) return;
  const { heat } = state;
  const { cells } = sheet;
  for (let i = 0; i < heat.length; i++) cells[i] = ink[heat[i]];
  sheet.ctx.putImageData(sheet.img, 0, 0);
  ctx.drawImage(sheet.canvas, 0, 0, w, h);
}

/** @type {Record<string, (f: Frame) => void>} */
const STYLES = { bars, ridges, fade, fire };

/** @returns {FxState} */
const fresh = () => ({
  caps: null,
  ridges: null,
  halo: HALO_FRESH,
  glow: null,
  heat: null,
  owed: 0,
  ink: null,
  sheet: null,
});

/**
 * A painter for `canvas`: `paint` draws one meter scene's spectrum at `range` dB under `style` in color suite `suite`,
 * Accent where none is given, in the accent in force when it paints, `dt` seconds after the last paint; `clear` empties
 * the canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {FxColors} colors
 */
export function fxPainter(canvas, colors) {
  let shown = "";
  let state = fresh();
  const clear = () => canvas.getContext("2d", CTX_OPTS)?.clearRect(0, 0, canvas.width, canvas.height);
  /**
   * @param {SpectrumHold | null} spectrum
   * @param {number} range  dB
   * @param {string} style
   * @param {{ suite?: string, dt?: number }} [look]  the color suite, and the seconds since the last paint, one meter
   *   loop step where none is given
   */
  const paint = (spectrum, range, style, { suite = ACCENT, dt = DT } = {}) => {
    const ctx = canvas.getContext("2d", CTX_OPTS);
    if (!ctx) return;
    if (!spectrum) {
      shown = "";
      clear();
      return;
    }
    if (style !== shown) {
      if (shown) clear();
      shown = style;
      state = fresh();
    }
    const draw = STYLES[style];
    const accent = accentInForce();
    if (draw) draw({ ctx, canvas, colors, fracs: fractionsOf(spectrum.disp, range), state, suite, accent, dt });
    else clear();
  };
  return { paint, clear };
}
