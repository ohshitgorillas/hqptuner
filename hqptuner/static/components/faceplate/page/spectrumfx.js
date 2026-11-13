// The page spectrum's effects canvas, laid over the SVG trace, drawn in the picked spectrum style. Trace leaves it
// clear for the SVG, aurora for the shader canvas; bars draw one bar per band with peak caps; ridges stack their rows
// up the plot, each newer row lower and in front; fade strokes the live trace over a halo of its recent positions;
// flames draw their heat grid over the whole canvas, heat 0 clear. Each motion is a step of model/gauges/meter/steps.js
// or fire.js over the seconds a paint is given. A restart, a change of style and a paint with no columns each mean a
// clear canvas and fresh style state. Each bar takes the color suite's color at its height, or under a suite with a
// fixed bar gradient is drawn over that gradient; the ridge lines, the fade trace and its halo are colored by level,
// and the caps take the suite's top color. Accent draws in the accent in force at each paint. Gradients and color
// tables are held for one suite, accent and canvas height, and rebuilt where any of the three differs.

import { pixelRatio } from "../../../lib/dom.js";
import { fractionsOf } from "../../../model/gauges/meter/meter.js";
import {
  BANDS,
  bandsOf,
  hexAt,
  rampOf,
  suiteBarStops,
  suiteHaloStops,
  suiteLineStops,
} from "../../../model/gauges/meter/spectrumfx.js";
import { blaze, fireColors, fireSize, fireSource, freshFlames, stepFlames } from "../../../model/gauges/meter/fire.js";
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
/** @typedef {import("../../../model/gauges/meter/spectrumfx.js").Ramp} Ramp */
/** @typedef {[number, string]} Stop */
/** @typedef {{ width: number, height: number }} Box */
/** @typedef {(width: number, height: number) => { width: number, height: number, getContext: (kind?: string) => unknown }} CanvasMaker */
/** @typedef {{ suite: string, dt: number, restart: boolean }} PaintOptions */

/**
 * The CSS colors a painter draws with besides the color suite's.
 *
 * @typedef {object} FxColors
 * @property {string} glass  the fill under each ridge, hiding the rows behind it
 */

/**
 * The small canvas the flames' heat grid is put on, one pixel a cell, and the image put on it.
 *
 * @typedef {object} FireSheet
 * @property {CanvasRenderingContext2D} ctx
 * @property {ImageData} img
 * @property {Uint32Array} cells  the image's pixels, one word a cell
 */

/**
 * The flames between paints: their heat grid, the source row the last paint lit, the canvas size they were made for.
 *
 * @typedef {object} Flames
 * @property {FlamesState} state
 * @property {Uint16Array} source
 * @property {number} w
 * @property {number} h
 */

/**
 * Each style's state between paints, null until its first paint and null again after each fresh start.
 *
 * @typedef {object} FxState
 * @property {CapState | null} caps
 * @property {RidgeState | null} ridges
 * @property {HaloState | null} halo
 * @property {Flames | null} flames
 */

/**
 * What the painter draws in under one suite, accent and canvas height, each built at its first use and held until one
 * of the three changes.
 *
 * @typedef {object} Palette
 * @property {string} suite
 * @property {string} accent  `#rrggbb`
 * @property {number} h  canvas pixels
 * @property {CanvasGradient | null | undefined} bar  the fixed bar gradient; null under a suite with none
 * @property {Ramp | undefined} ramp  the suite's ramp, each bar's color and the caps', its top, read off it
 * @property {CanvasGradient[]} ridges  one per ridge row, the newest first; none until built
 * @property {CanvasGradient | undefined} halo
 * @property {CanvasGradient | undefined} line  the fade trace's
 * @property {Uint32Array | undefined} ink  one RGBA word per heat up to `inkMax`
 * @property {number} inkMax
 */

/**
 * What a painter holds across fresh starts: its palette, the seams it was made with, and its own canvases, the fade
 * halo's at the effects canvas's size and the flames' sheet, each kept while its size holds and null where no 2D
 * context can be had.
 *
 * @typedef {object} Held
 * @property {Palette} palette
 * @property {() => number} random
 * @property {CanvasMaker} makeCanvas
 * @property {CanvasRenderingContext2D | null | undefined} halo
 * @property {FireSheet | null | undefined} fire
 */

/**
 * What one style's paint draws from, one object a painter keeps and rewrites each paint.
 *
 * @typedef {object} Frame
 * @property {CanvasRenderingContext2D} ctx
 * @property {Float32Array} fracs  plot fractions per column
 * @property {FxState} state
 * @property {Held} held
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
const MASK = "#000"; // the opaque fill the halo is dimmed through

/**
 * The canvas size, in device pixels, for a box `ratio` device pixels to the CSS pixel: each side rounded to the
 * nearest pixel and never under one.
 *
 * @param {Box} box  CSS pixels
 * @param {number} ratio
 * @returns {Box}
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
 * @param {Stop[]} stops
 * @returns {CanvasGradient}
 */
function vertical(ctx, y0, y1, stops) {
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  return grad;
}

/**
 * The palette for `suite`, `accent` and a canvas `h` high: `pal` as it is where all three match it, `pal` rekeyed and
 * emptied where any differs, and a new empty palette where there is no `pal`.
 *
 * @param {Palette | null} pal  written in place
 * @param {string} suite
 * @param {string} accent  `#rrggbb`
 * @param {number} h  canvas pixels
 * @returns {Palette}
 */
function keyPalette(pal, suite, accent, h) {
  if (pal?.suite === suite && pal.accent === accent && pal.h === h) return pal;
  const none = undefined;
  const blank = { suite, accent, h, bar: none, ramp: none, ridges: [], halo: none, line: none, ink: none, inkMax: 0 };
  return pal ? Object.assign(pal, blank) : blank;
}

/**
 * Bars: the bands, each with its peak cap; each in the suite's color at its height, or all over the suite's fixed bar
 * gradient from the floor to full scale where it has one, the caps in the suite's top color.
 *
 * @param {Frame} f
 * @param {Float32Array} bands  plot fractions, one per band
 */
function bars(f, bands) {
  const { ctx, state } = f;
  const pal = f.held.palette;
  const { width: w, height: h } = ctx.canvas;
  const caps = (state.caps ??= freshCaps(BANDS));
  stepCaps(caps, bands, f.dt);
  if (pal.bar === undefined) {
    const stops = suiteBarStops(pal.suite, pal.accent);
    pal.bar = stops && vertical(ctx, h, 0, stops);
  }
  const ramp = (pal.ramp ??= rampOf(pal.suite, pal.accent));
  const bw = w / bands.length;
  ctx.clearRect(0, 0, w, h);
  if (pal.bar) ctx.fillStyle = pal.bar;
  for (let b = 0; b < bands.length; b++) {
    if (!pal.bar) ctx.fillStyle = hexAt(ramp, bands[b]);
    ctx.fillRect(b * bw, h - bands[b] * h, bw * (1 - BAR_GAP), bands[b] * h);
  }
  ctx.fillStyle = hexAt(ramp, 1);
  for (let b = 0; b < caps.lvl.length; b++) ctx.fillRect(b * bw, h - caps.lvl[b] * h, bw * (1 - BAR_GAP), CAP_PX);
}

/**
 * Ridges: oldest first, highest up; each row a line colored by level over its baseline, filled down to it so the rows
 * behind hide. The baselines spread from a line's width above the floor to RIDGE_OVER of a step past the top, so the
 * stack fills the plot, the back rows' ridges run off its top, and no baseline lies on the top edge. The stack slides
 * up between rows, so it moves on every paint. Each row's gradient is built once for its baseline and held in the palette.
 *
 * @param {Frame} f
 * @param {FxColors} colors
 */
function ridges(f, colors) {
  const { ctx, state, fracs } = f;
  const pal = f.held.palette;
  const { width: w, height: h } = ctx.canvas;
  if (state.ridges?.rows[0].length !== fracs.length) state.ridges = freshRidges(fracs.length);
  const ring = stepRidges(state.ridges, fracs, f.dt);
  const step = (h - RIDGE_LINE) / (ring.rows.length - 1 - RIDGE_OVER);
  if (pal.ridges.length !== ring.rows.length) {
    const stops = suiteLineStops(pal.suite, pal.accent);
    const baseOf = (/** @type {number} */ k) => h - RIDGE_LINE - k * step;
    pal.ridges = ring.rows.map((_, k) => vertical(ctx, baseOf(k), baseOf(k) - h * RIDGE_AMP, stops));
  }
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(0, -ring.slide * step);
  ctx.fillStyle = colors.glass;
  ctx.lineWidth = RIDGE_LINE;
  for (let k = ring.count - 1; k >= 0; k--) {
    const row = ridgeRow(ring, k);
    const base = h - RIDGE_LINE - k * step;
    ctx.strokeStyle = pal.ridges[k];
    ctx.beginPath();
    ctx.moveTo(0, base);
    for (let c = 0; c < row.length; c++) ctx.lineTo(((c + 0.5) / row.length) * w, base - row[c] * h * RIDGE_AMP);
    ctx.lineTo(w, base);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Start a path on `ctx` through `fracs` across its canvas, a point at each column's center.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} fracs  plot fractions per column
 */
function tracePath(ctx, fracs) {
  const { width: w, height: h } = ctx.canvas;
  ctx.beginPath();
  for (let c = 0; c < fracs.length; c++) ctx.lineTo(((c + 0.5) / fracs.length) * w, h - fracs[c] * h);
}

/**
 * The 2D context of a canvas `w` by `h` from `make`, or null where it gives none.
 *
 * @param {CanvasMaker} make
 * @param {number} w
 * @param {number} h
 * @returns {CanvasRenderingContext2D | null}
 */
function contextOf(make, w, h) {
  return /** @type {CanvasRenderingContext2D | null} */ (make(w, h).getContext("2d"));
}

/**
 * The fade halo's canvas for an effects canvas `w` by `h`: the one held, unless it is another size, then a new one.
 *
 * @param {Held} held  written in place
 * @param {number} w
 * @param {number} h
 * @returns {CanvasRenderingContext2D | null}
 */
function haloCanvas(held, w, h) {
  const g = held.halo;
  if (g === null || (g && g.canvas.width === w && g.canvas.height === h)) return g;
  held.halo = contextOf(held.makeCanvas, w, h);
  if (held.halo) held.halo.fillStyle = MASK;
  return held.halo;
}

/**
 * The halo on its own canvas `g`: its content dimmed by the share stepHalo gives, or cleared where stepHalo marks it
 * clear, with the trace laid over it, blurred and wide, in the halo's colors.
 *
 * @param {Frame} f
 * @param {CanvasRenderingContext2D} g
 * @param {HaloState} halo
 * @param {number} px  device pixels to the CSS pixel
 */
function glow(f, g, halo, px) {
  const { width: w, height: h } = g.canvas;
  const pal = f.held.palette;
  pal.halo ??= vertical(f.ctx, h, 0, suiteHaloStops(pal.suite, pal.accent));
  g.save();
  if (halo.clear) g.clearRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-out";
  g.globalAlpha = halo.dim;
  if (halo.dim) g.fillRect(0, 0, w, h);
  g.restore();
  g.save();
  g.strokeStyle = pal.halo;
  g.lineJoin = "round";
  g.lineWidth = HALO_LINE * px;
  g.filter = `blur(${HALO_BLUR * px}px)`;
  tracePath(g, f.fracs);
  g.stroke();
  g.restore();
}

/**
 * Fade: the halo, on a canvas of its own and stepped by stepHalo, under the live trace stroked crisp on top. The crisp
 * trace is stroked on the effects canvas only, so the halo holds only blurred strokes, and no paint reads a pixel back.
 * Trace and halo are colored by level alike, the halo at its starting strength in each color.
 *
 * @param {Frame} f
 */
function fade(f) {
  const { ctx } = f;
  const { width: w, height: h } = ctx.canvas;
  const px = pixelRatio(ctx.canvas);
  const pal = f.held.palette;
  const halo = stepHalo((f.state.halo ??= freshHalo()), f.dt);
  const g = haloCanvas(f.held, w, h);
  ctx.clearRect(0, 0, w, h);
  if (g) {
    glow(f, g, halo, px);
    ctx.drawImage(g.canvas, 0, 0);
  }
  pal.line ??= vertical(ctx, h, 0, suiteLineStops(pal.suite, pal.accent));
  ctx.strokeStyle = pal.line;
  ctx.lineJoin = "round";
  ctx.lineWidth = TRACE_LINE * px;
  tracePath(ctx, f.fracs);
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
 * A sheet `cols` by `rows` pixels made by `make`: `held`, unless it is another size. Null where no sheet context can
 * be had.
 *
 * @param {FireSheet | null | undefined} held
 * @param {CanvasMaker} make
 * @param {number} cols
 * @param {number} rows
 * @returns {FireSheet | null}
 */
function fireSheet(held, make, cols, rows) {
  if (held?.img.width === cols && held.img.height === rows) return held;
  const ctx = contextOf(make, cols, rows);
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);
  return { ctx, img, cells: words(img.data) };
}

/**
 * The flames for a canvas `w` by `h`: the ones held, unless they are another size, then fresh ones on a cold grid.
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
  f.state.flames = { state: freshFlames(size), source: new Uint16Array(size.cols), w, h };
  return f.state.flames;
}

/**
 * Flames: the heat grid stepped on by the time since the last paint, its bottom row lit by the columns, each cell in
 * the color fireColors gives its heat, put on a sheet a pixel a cell and scaled over the whole canvas.
 *
 * @param {Frame} f
 */
function fire(f) {
  const { ctx, held } = f;
  const pal = held.palette;
  const { width: w, height: h } = ctx.canvas;
  const flames = flamesFor(f, w, h);
  const { size } = flames.state;
  fireSource(f.fracs, size, flames.source);
  stepFlames(flames.state, flames.source, f.dt, held.random);
  if (!pal.ink || pal.inkMax !== size.max) {
    pal.ink = words(fireColors(pal.suite, pal.accent, size.max));
    pal.inkMax = size.max;
  }
  const sheet = (held.fire = fireSheet(held.fire, held.makeCanvas, size.cols, size.rows));
  ctx.clearRect(0, 0, w, h);
  if (!sheet) return;
  blaze(flames.state, pal.ink, sheet.cells);
  sheet.ctx.putImageData(sheet.img, 0, 0);
  ctx.drawImage(sheet.ctx.canvas, 0, 0, w, h);
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
const fresh = () => ({ caps: null, ridges: null, halo: null, flames: null });

/**
 * The painter for the effects canvas `canvas`, drawing from the random source `random` and making any canvas of its
 * own with `makeCanvas`: `paint` draws `columns` at `range` dB under `style` in color suite `suite`, in the accent in
 * force when it paints, its motion `dt` seconds on from the last paint. A paint with no columns clears the canvas
 * where anything is shown, and the next paint with columns starts afresh.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {FxColors} colors
 * @param {{ random: () => number, makeCanvas: CanvasMaker }} seams
 */
export function fxPainter(canvas, colors, { random, makeCanvas }) {
  let shown = "";
  let state = fresh();
  /** @type {Held} */
  const held = { palette: keyPalette(null, "", "", -1), random, makeCanvas, halo: undefined, fire: undefined };
  /** @type {CanvasRenderingContext2D | null} */
  let ctx = null;
  /** @type {Float32Array | undefined} */
  let fracs;
  /** @type {Float32Array | undefined} */
  let bands;
  /** @type {Frame | null} */
  let frame = null;
  /** @type {Record<string, (f: Frame) => void>} */
  const styles = {
    bars: (f) => bars(f, (bands = bandsOf(f.fracs, BANDS, bands))),
    ridges: (f) => ridges(f, colors),
    fade,
    fire,
  };
  /**
   * Clear the canvas of `c` and start afresh, showing `next`, "" for nothing.
   *
   * @param {CanvasRenderingContext2D} c
   * @param {string} next
   */
  const start = (c, next) => {
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    state = fresh();
    shown = next;
  };
  return {
    /**
     * @param {ArrayLike<number>} columns  dBFS per column, as the trace shows them
     * @param {number} range  dB, positive
     * @param {string} style
     * @param {PaintOptions} opts  dt is seconds since the last paint
     */
    paint(columns, range, style, { suite, dt, restart }) {
      timed(dt);
      ctx ??= canvas.getContext("2d");
      if (!ctx) return;
      if (!columns.length) {
        if (shown) start(ctx, "");
        return;
      }
      if (restart || style !== shown) start(ctx, style);
      const draw = styles[style];
      if (!draw) return;
      fracs = fractionsOf(columns, range, fracs);
      held.palette = keyPalette(held.palette, suite, accentInForce(), ctx.canvas.height);
      frame ??= { ctx, fracs, state, held, dt };
      frame.ctx = ctx;
      frame.fracs = fracs;
      frame.state = state;
      frame.dt = dt;
      draw(frame);
    },
  };
}
