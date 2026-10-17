// The page spectrum's effects canvas, laid over the SVG trace: each paint draws the picked spectrum style. Trace and
// aurora leave the canvas clear for the SVG; bars draw one bar per band with peak caps; ridges stack their rows up the
// plot, each newer row lower and in front; fade strokes the live trace over a halo of where it has been; flames draw
// their heat grid over the whole canvas, heat 0 clear. Every motion is a step of model/gauges/meter/steps.js or
// fire.js handed the seconds the paint is told passed, as it is told them. A restart, a change of style or a paint with
// no columns starts the style's state afresh on a clear canvas. Each bar takes the color suite's color at its height,
// or under a suite with a fixed bar gradient is drawn over that gradient; the ridge lines, the fade trace and its halo
// are colored by level, and the caps take the suite's top color. Accent draws in the accent in force at each paint.

import {
  BANDS,
  bandsOf,
  fractionsOf,
  suiteBarStops,
  suiteColor,
  suiteHaloStops,
  suiteLineStops,
} from "../../../model/gauges/meter/spectrumfx.js";
import { fireColors, fireSize, fireSource, freshFlames, stepFlames } from "../../../model/gauges/meter/fire.js";
import {
  freshCaps,
  freshHalo,
  freshRidges,
  ridgeRow,
  stepCaps,
  stepHalo,
  stepRidges,
} from "../../../model/gauges/meter/steps.js";
import { accentInForce } from "../../../store/ui/theme.js";

/** @typedef {import("../../../model/gauges/meter/steps.js").CapState} CapState */
/** @typedef {import("../../../model/gauges/meter/steps.js").HaloState} HaloState */
/** @typedef {import("../../../model/gauges/meter/steps.js").RidgeState} RidgeState */
/** @typedef {import("../../../model/gauges/meter/fire.js").FlamesState} FlamesState */

/**
 * The CSS colors a painter draws with besides the color suite's.
 *
 * @typedef {object} FxColors
 * @property {string} glass  the fill under each ridge, hiding the rows behind it
 */

/**
 * The fade halo between paints: its step, each pixel's strength as a share of full, and the image it is put through,
 * whose colors are those each pixel's strength came from.
 *
 * @typedef {object} Glow
 * @property {HaloState} halo
 * @property {Float32Array} strength  0 to 1 per pixel
 * @property {ImageData} img
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
 * The flames between paints: their heat grid, the source row the last paint lit, the canvas size they were made for,
 * the sheet the grid is put on, and the color table with the suite and accent it was built for.
 *
 * @typedef {object} Flames
 * @property {FlamesState} state
 * @property {Uint16Array} source
 * @property {number} w
 * @property {number} h
 * @property {FireSheet | null} sheet  null where no sheet context can be had
 * @property {string} suite
 * @property {string} accent
 * @property {Uint32Array} ink  one RGBA word per heat
 */

/**
 * Each style's state between paints, null until its first paint and fresh again after a break.
 *
 * @typedef {object} FxState
 * @property {CapState | null} caps
 * @property {RidgeState | null} ridges
 * @property {Glow | null} glow
 * @property {Flames | null} flames
 */

/**
 * What one style's paint draws from, one object a painter keeps and rewrites each paint.
 *
 * @typedef {object} Frame
 * @property {CanvasRenderingContext2D} ctx
 * @property {Float32Array} fracs  plot fractions per column
 * @property {FxState} state
 * @property {string} suite
 * @property {string} accent  `#rrggbb`
 * @property {number} dt  s
 */

const BAR_GAP = 0.25; // share of a band's width left clear beside its bar
const CAP_PX = 2; // a peak cap's height, canvas pixels
const RIDGE_OVER = 0.5; // share of a row step the back ridge row's baseline sits above the plot's top
const RIDGE_AMP = 0.35; // a full-scale ridge's height, share of the plot height
const RIDGE_LINE = 1.5; // a ridge's stroke width, canvas pixels
const TRACE_LINE = 1.5; // the fade trace's stroke width, CSS pixels, as the SVG trace's
const HALO_LINE = 6; // the halo's stroke width before its blur, CSS pixels
const HALO_BLUR = 2; // the halo's blur radius, CSS pixels
const FULL = 255; // the most a channel holds
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
 * @param {Float32Array} bands  plot fractions, one per band
 */
function bars(f, bands) {
  const { ctx, state, suite, accent } = f;
  const { width: w, height: h } = ctx.canvas;
  const caps = (state.caps ??= freshCaps(BANDS));
  stepCaps(caps, bands, f.dt);
  const fixed = suiteBarStops(suite, accent);
  const bw = w / bands.length;
  ctx.clearRect(0, 0, w, h);
  if (fixed.length) ctx.fillStyle = vertical(ctx, h, 0, fixed);
  for (let b = 0; b < bands.length; b++) {
    if (!fixed.length) ctx.fillStyle = suiteColor(suite, bands[b], accent);
    ctx.fillRect(b * bw, h - bands[b] * h, bw * (1 - BAR_GAP), bands[b] * h);
  }
  ctx.fillStyle = suiteColor(suite, 1, accent);
  for (let b = 0; b < caps.lvl.length; b++) ctx.fillRect(b * bw, h - caps.lvl[b] * h, bw * (1 - BAR_GAP), CAP_PX);
}

/**
 * Ridges: oldest first, highest up; each row a line colored by level over its baseline, filled down to it so the rows
 * behind hide. The baselines spread from a line's width above the floor to RIDGE_OVER of a step past the top, so the
 * stack fills the plot, the back rows' ridges run off its top, and no baseline lies on the top edge.
 *
 * @param {Frame} f
 * @param {FxColors} colors
 */
function ridges(f, colors) {
  const { ctx, state, fracs } = f;
  const { width: w, height: h } = ctx.canvas;
  if (state.ridges?.rows[0].length !== fracs.length) state.ridges = freshRidges(fracs.length);
  const ring = stepRidges(state.ridges, fracs, f.dt);
  const step = (h - RIDGE_LINE) / (ring.rows.length - 1 - RIDGE_OVER);
  const stops = suiteLineStops(f.suite, f.accent);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colors.glass;
  ctx.lineWidth = RIDGE_LINE;
  for (let k = ring.count - 1; k >= 0; k--) {
    const row = ridgeRow(ring, k);
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
  const { ctx, fracs } = f;
  const { width: w, height: h } = ctx.canvas;
  ctx.beginPath();
  for (let c = 0; c < fracs.length; c++) ctx.lineTo(((c + 0.5) / fracs.length) * w, h - fracs[c] * h);
}

/**
 * The fade halo for a canvas `w` by `h`: the one held, unless it is another size, then a fresh one.
 *
 * @param {Frame} f
 * @param {number} w
 * @param {number} h
 * @returns {Glow}
 */
function glowFor(f, w, h) {
  const held = f.state.glow;
  if (held?.img.width === w && held.img.height === h) return held;
  f.state.glow = { halo: freshHalo(), strength: new Float32Array(w * h), img: f.ctx.createImageData(w, h) };
  return f.state.glow;
}

/**
 * Merge `fresh`, this paint's glow, into the halo held: each pixel takes the stronger of the glow and its held
 * strength less the share `dim` takes away, and the color of whichever it took. Where `clear` holds, nothing held is
 * kept.
 *
 * @param {Glow} glow  written in place
 * @param {Uint8ClampedArray} fresh  RGBA
 */
function mergeHalo(glow, fresh) {
  const { halo, strength } = glow;
  const out = glow.img.data;
  const keep = halo.clear ? 0 : 1 - halo.dim;
  for (let p = 0, i = 0; p < strength.length; p++, i += 4) {
    const held = strength[p] * keep;
    const lit = fresh[i + 3] / FULL;
    if (lit >= held) {
      strength[p] = lit;
      out[i] = fresh[i];
      out[i + 1] = fresh[i + 1];
      out[i + 2] = fresh[i + 2];
    } else {
      strength[p] = held;
    }
    out[i + 3] = Math.round(strength[p] * FULL);
  }
}

/**
 * Fade: a blurred halo of the trace, merged over the halo held as stepHalo dims it, then the live trace stroked crisp
 * on top. The halo is read back before the trace is stroked, so the trace never lingers in it. Trace and halo are
 * colored by level alike, the halo at its starting strength in each color.
 *
 * @param {Frame} f
 */
function fade(f) {
  const { ctx } = f;
  const { width: w, height: h } = ctx.canvas;
  const px = globalThis.devicePixelRatio || 1;
  const glow = glowFor(f, w, h);
  stepHalo(glow.halo, f.dt);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = vertical(ctx, h, 0, suiteHaloStops(f.suite, f.accent));
  ctx.lineJoin = "round";
  ctx.save();
  ctx.lineWidth = HALO_LINE * px;
  ctx.filter = `blur(${HALO_BLUR * px}px)`;
  tracePath(f);
  ctx.stroke();
  ctx.restore();
  mergeHalo(glow, ctx.getImageData(0, 0, w, h).data);
  ctx.putImageData(glow.img, 0, 0);
  ctx.strokeStyle = vertical(ctx, h, 0, suiteLineStops(f.suite, f.accent));
  ctx.lineWidth = TRACE_LINE * px;
  tracePath(f);
  ctx.stroke();
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
 * A sheet `cols` by `rows` pixels: `held`, unless it is another size. Null where no sheet context can be had.
 *
 * @param {FireSheet | null | undefined} held
 * @param {number} cols
 * @param {number} rows
 * @returns {FireSheet | null}
 */
function fireSheet(held, cols, rows) {
  if (held?.img.width === cols && held.img.height === rows) return held;
  const canvas = new OffscreenCanvas(cols, rows);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);
  return { canvas, ctx, img, cells: words(img.data) };
}

/**
 * The flames for a canvas `w` by `h`: the ones held, unless they are another size, then fresh ones on a cold grid,
 * keeping the held sheet where the grid is the same size.
 *
 * @param {Frame} f
 * @param {number} w
 * @param {number} h
 * @returns {Flames}
 */
function flamesFor(f, w, h) {
  const held = f.state.flames;
  if (held?.w === w && held.h === h) return held;
  const size = fireSize(w, h);
  f.state.flames = {
    state: freshFlames(size),
    source: new Uint16Array(size.cols),
    w,
    h,
    sheet: fireSheet(held?.sheet, size.cols, size.rows),
    suite: "",
    accent: "",
    ink: new Uint32Array(0),
  };
  return f.state.flames;
}

/**
 * Flames: the heat grid stepped on by the time since the last paint, its bottom row lit by the columns, each cell in
 * the color fireColors gives its heat, put on a sheet a pixel a cell and scaled over the whole canvas.
 *
 * @param {Frame} f
 */
function fire(f) {
  const { ctx } = f;
  const { width: w, height: h } = ctx.canvas;
  const flames = flamesFor(f, w, h);
  const { size } = flames.state;
  fireSource(f.fracs, size, flames.source);
  stepFlames(flames.state, flames.source, f.dt, Math.random);
  if (flames.suite !== f.suite || flames.accent !== f.accent) {
    flames.suite = f.suite;
    flames.accent = f.accent;
    flames.ink = words(fireColors(f.suite, f.accent, size.max));
  }
  const { sheet, ink } = flames;
  ctx.clearRect(0, 0, w, h);
  if (!sheet) return;
  const { heat } = flames.state;
  const { cells } = sheet;
  for (let i = 0; i < heat.length; i++) cells[i] = ink[heat[i]];
  sheet.ctx.putImageData(sheet.img, 0, 0);
  ctx.drawImage(sheet.canvas, 0, 0, w, h);
}

/**
 * Throw where a paint is not told, as a number of seconds, how long it has been since the last.
 *
 * @param {unknown} dt
 */
function timed(dt) {
  if (typeof dt !== "number" || !Number.isFinite(dt)) {
    throw new TypeError("fxPainter: a paint is told the seconds since the last paint");
  }
}

/** @returns {FxState} */
const fresh = () => ({ caps: null, ridges: null, glow: null, flames: null });

/**
 * The painter for the effects canvas: `paint` draws `columns` at `range` dB under `style` in color suite `suite`, in
 * the accent in force when it paints, its motion `dt` seconds on from the last paint; `clear` empties the canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {FxColors} colors
 * @returns {{
 *   paint: (
 *     columns: ArrayLike<number>,
 *     range: number,
 *     style: string,
 *     opts: { suite: string, dt: number, restart: boolean },
 *   ) => void,
 *   clear: () => void,
 * }}
 */
export function fxPainter(canvas, colors) {
  let shown = "";
  let state = fresh();
  /** @type {Float32Array | undefined} */
  let fracs;
  /** @type {Float32Array | undefined} */
  let bands;
  /** @type {Frame | null} */
  let frame = null;
  const clear = () => canvas.getContext("2d", CTX_OPTS)?.clearRect(0, 0, canvas.width, canvas.height);
  /** @type {Record<string, (f: Frame) => void>} */
  const styles = {
    bars: (f) => bars(f, (bands = bandsOf(f.fracs, BANDS, bands))),
    ridges: (f) => ridges(f, colors),
    fade,
    fire,
  };
  return {
    /**
     * @param {ArrayLike<number>} columns  dBFS per column, as the trace shows them
     * @param {number} range  dB, positive
     * @param {string} style
     * @param {{ suite: string, dt: number, restart: boolean }} opts  dt is seconds since the last paint
     */
    paint(columns, range, style, { suite, dt, restart }) {
      timed(dt);
      const ctx = canvas.getContext("2d", CTX_OPTS);
      if (!ctx) return;
      if (!columns.length || restart || style !== shown) {
        clear();
        state = fresh();
        shown = columns.length ? style : "";
      }
      const draw = styles[style];
      if (!columns.length || !draw) return;
      fracs = fractionsOf(columns, range, fracs);
      frame ??= { ctx, fracs, state, suite, accent: "", dt };
      frame.ctx = ctx;
      frame.fracs = fracs;
      frame.state = state;
      frame.suite = suite;
      frame.accent = accentInForce();
      frame.dt = dt;
      draw(frame);
    },
    clear,
  };
}
