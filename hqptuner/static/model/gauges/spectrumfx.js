// Page spectrum display styles: the per-frame decisions behind each style, free of the DOM. Levels become plot
// fractions and bands; bars carry falling peak caps, soft bars spill onto their neighbours, gravity bars fall under
// acceleration, a waterfall row takes its colours from a lookup table, and ridge rows stack on a cadence. Every height
// is a fraction of the plot, 0 on the floor and 1 at full scale; every step returns a new state and leaves its inputs
// alone, so a painter draws what it gets back and a test drives it from a table.

import { fraction } from "./meter.js";

export const BANDS = 64; // bars the bar styles draw across the plot
export const CAP_HOLD_S = 0.5; // a peak cap's hold before it falls, s
export const CAP_GRAVITY = 4; // a released peak cap's acceleration, plot fractions/s²
export const SPILL = 1.5; // factor a soft bar's spill shrinks by per band outward
export const GRAVITY = 4; // a gravity bar's acceleration, plot fractions/s²
export const RIDGE_ROWS = 24; // ridge rows kept, newest first
export const RIDGE_EVERY = 4; // steps between ridge rows
const RGB = 3; // colour lookup table channels per entry
const RGBA = 4; // waterfall row channels per pixel
const OPAQUE = 255; // waterfall pixel alpha

/**
 * Peak caps, one per band: where each sits and how long since its band last reached it. Float32 storage is part of the
 * result: each step reads back the rounded values it stored.
 *
 * @typedef {object} CapState
 * @property {Float32Array} lvl  cap height, plot fraction
 * @property {Float32Array} age  time since the band last reached the cap, s
 */

/**
 * Gravity bars, one per band: where each sits and how fast it is falling.
 *
 * @typedef {object} GravityState
 * @property {Float32Array} lvl  bar height, plot fraction
 * @property {Float32Array} v    fall speed, plot fractions/s
 */

/**
 * Ridge rows, newest first, and the steps taken since the first.
 *
 * @typedef {object} RidgeState
 * @property {Float32Array[]} rows  plot fractions per column
 * @property {number} tick          steps taken, the first counting one
 */

/**
 * Levels as plot fractions on a plot spanning `range` dB down from full scale, clamped to [0, 1].
 *
 * @param {ArrayLike<number>} disp  dBFS
 * @param {number} range  dB
 * @returns {Float32Array}
 */
export function fractionsOf(disp, range) {
  const out = new Float32Array(disp.length);
  for (let i = 0; i < disp.length; i++) out[i] = fraction(disp[i], -range);
  return out;
}

/**
 * Columns grouped into `n` bands, each the largest fraction in its span. Band `b` runs from column `floor(b·len/n)` up
 * to, not including, `floor((b+1)·len/n)`, so the last band ends on the last column.
 *
 * @param {ArrayLike<number>} fracs  plot fractions
 * @param {number} n
 * @returns {Float32Array}
 */
export function bandsOf(fracs, n) {
  const out = new Float32Array(n);
  const len = fracs.length;
  for (let b = 0; b < n; b++) {
    const end = Math.floor(((b + 1) * len) / n);
    let top = 0;
    for (let c = Math.floor((b * len) / n); c < end; c++) top = Math.max(top, fracs[c]);
    out[b] = top;
  }
  return out;
}

/**
 * Peak caps after a step of `dt` seconds: a band at or above its cap lifts it and restarts its hold; a cap holds for
 * CAP_HOLD_S after its band last reached it, then falls by CAP_GRAVITY times its time past the hold times the step,
 * never below its band. Without a `prev` of the same length every cap sits on its band.
 *
 * @param {CapState | null} prev
 * @param {ArrayLike<number>} bands  plot fractions
 * @param {number} dt  s
 * @returns {CapState}
 */
export function stepCaps(prev, bands, dt) {
  const n = bands.length;
  const next = { lvl: Float32Array.from(bands), age: new Float32Array(n) };
  if (!prev || prev.lvl.length !== n) return next;
  for (let i = 0; i < n; i++) {
    if (bands[i] >= prev.lvl[i]) continue;
    next.age[i] = prev.age[i] + dt;
    const over = next.age[i] - CAP_HOLD_S;
    const lvl = over > 0 ? prev.lvl[i] - CAP_GRAVITY * over * dt : prev.lvl[i];
    next.lvl[i] = Math.max(bands[i], lvl);
  }
  return next;
}

/**
 * Soft bars: each band the larger of its own value and every other band's value divided by SPILL once per band
 * between them, so a peak spills onto its neighbours and fades outward, and overlapping spills take the larger.
 *
 * @param {ArrayLike<number>} bands  plot fractions
 * @returns {Float32Array}
 */
export function softBars(bands) {
  const n = bands.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let top = 0;
    for (let j = 0; j < n; j++) top = Math.max(top, bands[j] / SPILL ** Math.abs(i - j));
    out[i] = top;
  }
  return out;
}

/**
 * Gravity bars after a step of `dt` seconds: a band at or above its bar lifts it and stops its fall; otherwise the bar
 * gains GRAVITY times the step in speed and drops by its new speed times the step, never below its band. Without a
 * `prev` of the same length every bar sits on its band at rest.
 *
 * @param {GravityState | null} prev
 * @param {ArrayLike<number>} bands  plot fractions
 * @param {number} dt  s
 * @returns {GravityState}
 */
export function stepGravity(prev, bands, dt) {
  const n = bands.length;
  const next = { lvl: Float32Array.from(bands), v: new Float32Array(n) };
  if (!prev || prev.lvl.length !== n) return next;
  for (let i = 0; i < n; i++) {
    if (bands[i] >= prev.lvl[i]) continue;
    next.v[i] = prev.v[i] + GRAVITY * dt;
    next.lvl[i] = Math.max(bands[i], prev.lvl[i] - next.v[i] * dt);
  }
  return next;
}

/**
 * One waterfall row `width` pixels wide, RGBA: pixel `x` reads the column `floor(x·len/width)` and takes the lookup
 * table entry nearest that column's fraction of the table, fully opaque.
 *
 * @param {ArrayLike<number>} fracs  plot fractions
 * @param {ArrayLike<number>} lut    RGB entries, floor first
 * @param {number} width  pixels
 * @returns {Uint8ClampedArray}
 */
export function waterfallRow(fracs, lut, width) {
  const out = new Uint8ClampedArray(width * RGBA);
  const last = lut.length / RGB - 1;
  for (let x = 0; x < width; x++) {
    const f = fracs[Math.floor((x * fracs.length) / width)];
    const e = RGB * Math.min(last, Math.max(0, Math.round(f * last)));
    const p = RGBA * x;
    out[p] = lut[e];
    out[p + 1] = lut[e + 1];
    out[p + 2] = lut[e + 2];
    out[p + 3] = OPAQUE;
  }
  return out;
}

/**
 * Ridge rows after a step handing in `row`: without a `prev` the rows hold a copy of `row` and the tick is one;
 * otherwise the tick advances, and when the prior tick is a multiple of RIDGE_EVERY a copy of `row` goes first and the
 * oldest rows past RIDGE_ROWS drop off.
 *
 * @param {RidgeState | null} prev
 * @param {ArrayLike<number>} row  plot fractions
 * @returns {RidgeState}
 */
export function stepRidges(prev, row) {
  if (!prev) return { rows: [Float32Array.from(row)], tick: 1 };
  const tick = prev.tick + 1;
  if (prev.tick % RIDGE_EVERY !== 0) return { rows: prev.rows, tick };
  return { rows: [Float32Array.from(row), ...prev.rows].slice(0, RIDGE_ROWS), tick };
}
