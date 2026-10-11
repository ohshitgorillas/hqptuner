// The page spectrum's effects canvas, laid over the SVG trace: each meter paint draws the picked spectrum style from
// the per-frame steps in model/gauges/spectrumfx.js. Trace and aurora leave the canvas clear for the SVG; bars draw
// one bar per band with peak caps over a floor-to-full-scale gradient; ridges stack their rows up the plot, each newer
// row lower and in front; fade strokes the live trace over a blurred halo of where it has been, held between paints as
// an image so each paint dims it and merges in the trace's fresh glow. A change of style, or a paint with no spectrum,
// starts the next style's state afresh.

import {
  BANDS,
  HALO_FRESH,
  RIDGE_ROWS,
  bandsOf,
  fractionsOf,
  haloStrength,
  stepCaps,
  stepHalo,
  stepRidges,
} from "../../../model/gauges/spectrumfx.js";
import { STEP_MS } from "../../../store/meter/loop.js";

/** @typedef {import("../../../model/gauges/meter.js").SpectrumHold} SpectrumHold */
/** @typedef {import("../../../model/gauges/spectrumfx.js").CapState} CapState */
/** @typedef {import("../../../model/gauges/spectrumfx.js").HaloState} HaloState */
/** @typedef {import("../../../model/gauges/spectrumfx.js").RidgeState} RidgeState */

/**
 * The CSS colours a painter draws with.
 *
 * @typedef {object} FxColours
 * @property {string} lo     bar gradient at the floor
 * @property {string} mid    bar gradient half way up
 * @property {string} hi     bar gradient at full scale
 * @property {string} meter  peak caps, ridge lines, and the fade trace and its halo
 * @property {string} glass  the fill under each ridge, hiding the rows behind it
 */

/**
 * Each style's state between paints: the fade halo's step and the halo image the last fade paint left.
 *
 * @typedef {object} FxState
 * @property {CapState | null} caps
 * @property {RidgeState | null} ridges
 * @property {HaloState} halo
 * @property {ImageData | null} glow
 */

/**
 * What one style's paint draws from: the context, the canvas size, the plot fractions per column and the style's
 * state.
 *
 * @typedef {object} Frame
 * @property {CanvasRenderingContext2D} ctx
 * @property {HTMLCanvasElement} canvas
 * @property {FxColours} colours
 * @property {Float32Array} fracs
 * @property {FxState} state
 */

/** The time between two meter paints, s: the loop paints at most once a step. */
const DT = STEP_MS / 1000;
const BAR_GAP = 0.25; // share of a band's width left clear beside its bar
const CAP_PX = 2; // a peak cap's height, canvas pixels
const RIDGE_SPAN = 0.5; // share of the plot height the ridge rows' baselines spread over, up from the floor
const RIDGE_AMP = 0.5; // a full-scale ridge's height, share of the plot height
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
 * cap `thick` pixels deep under the level.
 *
 * @param {Frame} f
 * @param {Float32Array} lvls  plot fractions
 * @param {number | null} thick  pixels
 */
function fillBands(f, lvls, thick) {
  const { width: w, height: h } = f.canvas;
  const bw = w / lvls.length;
  lvls.forEach((lvl, b) => f.ctx.fillRect(b * bw, h - lvl * h, bw * (1 - BAR_GAP), thick ?? lvl * h));
}

/**
 * Bars: the bands over a gradient from the floor to full scale, each with its peak cap.
 *
 * @param {Frame} f
 */
function bars(f) {
  const { ctx, canvas, colours, state } = f;
  const bands = bandsOf(f.fracs, BANDS);
  state.caps = stepCaps(state.caps, bands, DT);
  const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
  grad.addColorStop(0, colours.lo);
  grad.addColorStop(0.5, colours.mid);
  grad.addColorStop(1, colours.hi);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = grad;
  fillBands(f, bands, null);
  ctx.fillStyle = colours.meter;
  fillBands(f, state.caps.lvl, CAP_PX);
}

/**
 * Ridges: oldest first, highest up; each row a line over its baseline, filled down to it so the rows behind hide.
 *
 * @param {Frame} f
 */
function ridges(f) {
  const { ctx, canvas, colours, state } = f;
  const { width: w, height: h } = canvas;
  state.ridges = stepRidges(state.ridges, f.fracs);
  const rows = state.ridges.rows;
  const step = (h * RIDGE_SPAN) / (RIDGE_ROWS - 1);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colours.glass;
  ctx.strokeStyle = colours.meter;
  ctx.lineWidth = RIDGE_LINE;
  for (let k = rows.length - 1; k >= 0; k--) {
    const row = rows[k];
    const base = h - RIDGE_LINE - k * step;
    ctx.beginPath();
    ctx.moveTo(0, base);
    for (let c = 0; c < row.length; c++) ctx.lineTo(((c + 0.5) / row.length) * w, base - row[c] * h * RIDGE_AMP);
    ctx.lineTo(w, base);
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Start a path through the plot fractions across the canvas, a point at each column's centre.
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
 * Fade: a blurred halo of the trace at the halo's starting strength, merged over the last paint's halo dimmed by the
 * share stepHalo gives, then the live trace stroked crisp on top. The halo is read back before the trace is stroked,
 * so the trace never lingers in it. A halo image the canvas has been resized out from under starts afresh.
 *
 * @param {Frame} f
 */
function fade(f) {
  const { ctx, canvas, colours, state } = f;
  const { width: w, height: h } = canvas;
  const px = globalThis.devicePixelRatio || 1;
  const held = state.glow?.width === w && state.glow.height === h ? state.glow : null;
  state.halo = stepHalo(held ? state.halo : HALO_FRESH, DT);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = colours.meter;
  ctx.lineJoin = "round";
  ctx.save();
  ctx.globalAlpha = haloStrength(0);
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
  ctx.lineWidth = TRACE_LINE * px;
  tracePath(f);
  ctx.stroke();
}

/** @type {Record<string, (f: Frame) => void>} */
const STYLES = { bars, ridges, fade };

/** @returns {FxState} */
const fresh = () => ({ caps: null, ridges: null, halo: HALO_FRESH, glow: null });

/**
 * A painter for `canvas`: `paint` draws one meter scene's spectrum at `range` dB under `style`, `clear` empties the
 * canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {FxColours} colours
 */
export function fxPainter(canvas, colours) {
  let shown = "";
  let state = fresh();
  const clear = () => canvas.getContext("2d", CTX_OPTS)?.clearRect(0, 0, canvas.width, canvas.height);
  /**
   * @param {SpectrumHold | null} spectrum
   * @param {number} range  dB
   * @param {string} style
   */
  const paint = (spectrum, range, style) => {
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
    if (draw) draw({ ctx, canvas, colours, fracs: fractionsOf(spectrum.disp, range), state });
    else clear();
  };
  return { paint, clear };
}
