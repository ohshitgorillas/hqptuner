// Page spectrum display styles: the per-frame decisions behind each style, free of the DOM. Levels become plot
// fractions and bands; bars carry falling peak caps, gravity bars fall under acceleration, aurora bands fall under
// their own, ridge rows stack on a cadence and dim toward the back, the Fade halo fades where the trace has been and
// says how much of the canvas to dim each frame, and aurora gives way to the trace without WebGL2. Every height is a
// fraction of the plot, 0 on the floor and 1 at full scale; every step returns a new state and leaves its inputs
// alone, so a painter draws what it gets back and a test drives it from a table. A colour suite gives the colour a
// part of the spectrum is drawn in by its height, and the Fade halo its colour.

import { clamp } from "../../lib/coerce.js";
import { rampFrom } from "../../lib/spectroraster.js";
import { fraction } from "./meter.js";

export const BANDS = 64; // bars the bar styles draw across the plot
export const CAP_HOLD_S = 0.5; // a peak cap's hold before it falls, s
const CAP_GRAVITY = 4; // a released peak cap's acceleration, plot fractions/s²
const GRAVITY = 4; // a gravity bar's acceleration, plot fractions/s²
export const AURORA_GRAVITY = 2.5; // an aurora band's acceleration, plot fractions/s²
export const RIDGE_ROWS = 12; // ridge rows kept, newest first
export const RIDGE_EVERY = 6; // steps between ridge rows
const HALO_START = 0.5; // the halo's glow where the trace has just been, share of the trace's strength
const HALO_TAU_S = 2; // the halo's time constant: its glow falls to 1/e of what it was in this long, s

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
 * The Fade halo on the canvas: whether a paint has drawn one there yet, and the share of the canvas to dim before
 * this frame's strokes.
 *
 * @typedef {object} HaloState
 * @property {boolean} drawn  whether the canvas holds a halo to dim
 * @property {number} dim     share of each pixel's strength to take away this frame, 0 to 1
 */

/** The halo after a reset: nothing on the canvas, nothing to dim. */
export const HALO_FRESH = Object.freeze({ drawn: false, dim: 0 });

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
 * Gravity bars after a step of `dt` seconds: a band at or above its bar lifts it and stops its fall; otherwise the bar
 * gains `gravity` times the step in speed and drops by its new speed times the step, never below its band. Without a
 * `prev` of the same length every bar sits on its band at rest.
 *
 * @param {GravityState | null} prev
 * @param {ArrayLike<number>} bands  plot fractions
 * @param {number} dt  s
 * @param {number} [gravity]  plot fractions/s², GRAVITY unless given
 * @returns {GravityState}
 */
export function stepGravity(prev, bands, dt, gravity = GRAVITY) {
  const n = bands.length;
  const next = { lvl: Float32Array.from(bands), v: new Float32Array(n) };
  if (!prev || prev.lvl.length !== n) return next;
  for (let i = 0; i < n; i++) {
    if (bands[i] >= prev.lvl[i]) continue;
    next.v[i] = prev.v[i] + gravity * dt;
    next.lvl[i] = Math.max(bands[i], prev.lvl[i] - next.v[i] * dt);
  }
  return next;
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

/**
 * How far ridge row `k` of `n`, newest first, has dimmed from the front row's stroke toward the back row's: none at the
 * front, all of it at row `n - 1`, in even steps between. A stack of one row has no back.
 *
 * @param {number} k
 * @param {number} n
 * @returns {number}  0 to 1
 */
export function ridgeShade(k, n) {
  return n > 1 ? clamp(k / (n - 1), 0, 1) : 0;
}

/**
 * The halo's glow at a spot the trace left `age` seconds ago, as a share of the trace's strength: HALO_START where the
 * trace has just been, falling continuously by e every HALO_TAU_S.
 *
 * @param {number} age  s
 * @returns {number}
 */
export function haloStrength(age) {
  return HALO_START * Math.exp(-age / HALO_TAU_S);
}

/**
 * The halo after a paint `dt` seconds after the last: with a halo already drawn, the canvas dims by the share that
 * takes every pixel from its glow at one age to its glow `dt` later, so pixels dimmed frame by frame follow
 * haloStrength; with none, there is nothing to dim. Either way the paint draws, so the halo after it is drawn.
 *
 * @param {Readonly<HaloState>} prev
 * @param {number} dt  s
 * @returns {HaloState}
 */
export function stepHalo(prev, dt) {
  return { drawn: true, dim: prev.drawn ? 1 - haloStrength(dt) / HALO_START : 0 };
}

/**
 * The style a page draws for the picked `style`: the trace in place of aurora where there is no WebGL2 to draw it
 * with, the pick itself otherwise.
 *
 * @param {string} style
 * @param {boolean} gl  whether the page has WebGL2
 * @returns {string}
 */
export function effectiveStyle(style, gl) {
  return style === "aurora" && !gl ? "trace" : style;
}

/**
 * The colour suites the page spectrum can draw in, each its colours as `#rrggbb`, the floor first and full scale last.
 * Classic has none: under it each style keeps its own colours.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const SPECTRUM_SUITES = Object.freeze({
  amber: ["#2a2215", "#6e5124", "#e9a63c", "#ffd48a"],
  inferno: ["#08090b", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  borealis: ["#0a2a2e", "#0e6b45", "#2bdc7a", "#8ef0b0", "#7a5cff", "#e04f8a"],
  signal: ["#29ce10", "#d6b521", "#ef3110"],
  mono: ["#1a1c20", "#5a5e66", "#b8bcc4", "#ffffff"],
});

/**
 * The Fade halo's colour under each suite, Classic included, as `#rrggbb`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SUITE_HALOS = Object.freeze({
  classic: "#420a68",
  amber: "#1f3b4d",
  inferno: "#420a68",
  viridis: "#414487",
  borealis: "#0e6b45",
  signal: "#0e6b45",
  mono: "#5a5e66",
});

const LEVEL_STOPS = 9; // stops a gradient coloured by level carries, floor to full scale
const CHANNEL_MAX = 255;

/** @typedef {[number, number, number]} Triple */

/** @type {Map<string, Triple[]>} each suite's ramp, 0 to 255 per channel, built on first use */
const ramps = new Map();

/**
 * `suite`'s colours, or null under Classic or a name that is no suite.
 *
 * @param {string} suite
 * @returns {readonly string[] | null}
 */
const stopsOf = (suite) => (Object.hasOwn(SPECTRUM_SUITES, suite) ? SPECTRUM_SUITES[suite] : null);

/**
 * `suite`'s ramp, floor first, or null under Classic.
 *
 * @param {string} suite
 * @returns {Triple[] | null}
 */
function rampOf(suite) {
  const stops = stopsOf(suite);
  if (!stops) return null;
  let ramp = ramps.get(suite);
  if (!ramp) {
    ramp = rampFrom([...stops]);
    ramps.set(suite, ramp);
  }
  return ramp;
}

/**
 * The colour of `ramp` at plot fraction `at`.
 *
 * @param {Triple[]} ramp
 * @param {number} at
 * @returns {Triple}
 */
const rampAt = (ramp, at) => ramp[Math.round(clamp(at, 0, 1) * (ramp.length - 1))];

/** @param {number} c 0 to 255 */
const hexByte = (c) => c.toString(16).padStart(2, "0");

/**
 * The colour a part of the spectrum at plot fraction `at` is drawn in under `suite`, blended between the suite's
 * colours: its first on the floor, its last at full scale. Empty under Classic or a suite with no colours.
 *
 * @param {string} suite
 * @param {number} at  0 on the floor, 1 at full scale
 * @returns {string}  `#rrggbb`, or empty
 */
export function suiteColor(suite, at) {
  const ramp = rampOf(suite);
  if (!ramp) return "";
  const [r, g, b] = rampAt(ramp, at);
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

/**
 * The colour a line style draws level `at` in under `suite`: the suite from its second colour on the floor to its
 * last at full scale, so a line never takes the floor colour it would vanish into. Empty under Classic.
 *
 * @param {string} suite
 * @param {number} at  0 on the floor, 1 at full scale
 * @returns {string}  `#rrggbb`, or empty
 */
function suiteLineColor(suite, at) {
  const stops = stopsOf(suite);
  if (!stops) return "";
  const from = 1 / (stops.length - 1);
  return suiteColor(suite, from + clamp(at, 0, 1) * (1 - from));
}

/**
 * The stops of a line style's gradient coloured by level under `suite`, LEVEL_STOPS of them from the floor (0) to full
 * scale (1), each its offset and its colour as suiteLineColor gives it. None under Classic.
 *
 * @param {string} suite
 * @returns {[number, string][]}
 */
export function suiteLineStops(suite) {
  if (!stopsOf(suite)) return [];
  return Array.from({ length: LEVEL_STOPS }, (_, i) => {
    const at = i / (LEVEL_STOPS - 1);
    return /** @type {[number, string]} */ ([at, suiteLineColor(suite, at)]);
  });
}

/**
 * Aurora's ramp under `suite`: `count` colours spread evenly from the suite's floor to its full scale, one RGB triple
 * each in one flat list, each channel 0 to 1. Empty under Classic, where aurora keeps its own ramp.
 *
 * @param {string} suite
 * @param {number} count
 * @returns {number[]}
 */
export function suiteRamp(suite, count) {
  const ramp = rampOf(suite);
  if (!ramp) return [];
  return Array.from({ length: count }, (_, i) => rampAt(ramp, i / Math.max(1, count - 1))).flatMap((c) =>
    c.map((v) => v / CHANNEL_MAX),
  );
}
