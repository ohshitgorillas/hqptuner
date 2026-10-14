// Page spectrum display styles: the per-frame decisions behind each style, free of the DOM. Levels become plot
// fractions and bands; bars carry falling peak caps, gravity bars fall under acceleration, aurora bands fall under
// their own, ridge rows stack on a cadence, the Fade halo fades where the trace has been and says how much of the
// canvas to dim each frame, and aurora gives way to the trace without WebGL2. Every height is a fraction of the plot, 0
// on the floor and 1 at full scale; every step returns a new state and leaves its inputs alone, so a painter draws what
// it gets back and a test drives it from a table. A colour suite gives the colour a part of the spectrum is drawn in by
// its height, the Fade halo its colours and their starting strengths, and the bars the one gradient they are drawn
// over where the suite has one.

import { clamp } from "../../lib/coerce.js";
import { rampFrom, rgb } from "../../lib/spectroraster.js";
import { ACCENT_SHADES } from "../shell/settings.js";
import { fraction } from "./meter.js";

export const BANDS = 64; // bars the bar styles draw across the plot
export const CAP_HOLD_S = 0.5; // a peak cap's hold before it falls, s
const CAP_GRAVITY = 4; // a released peak cap's acceleration, plot fractions/s²
const GRAVITY = 4; // a gravity bar's acceleration, plot fractions/s²
export const AURORA_GRAVITY = 2.5; // an aurora band's acceleration, plot fractions/s²
export const RIDGE_ROWS = 12; // ridge rows kept, newest first
export const RIDGE_EVERY = 6; // steps between ridge rows
const HALO_START = 0.5; // the halo's glow where a white trace has just been, share of the trace's strength
const HALO_START_DARK = 1; // the halo's glow where a black trace has just been, share of the trace's strength
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
 * The halo's glow at a spot a white trace left `age` seconds ago, as a share of the trace's strength: HALO_START where
 * the trace has just been, falling continuously by e every HALO_TAU_S. A halo in a darker colour starts stronger and
 * falls by the same share.
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

/** The colour suite drawn in the four shades of the accent in force. */
export const ACCENT = "accent";

/**
 * The colour suites the page spectrum can draw in besides Accent, each its colours as `#rrggbb`, the floor first and
 * full scale last.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const SPECTRUM_SUITES = Object.freeze({
  retro: ["#29ce10", "#d6b521", "#ef3110"],
  inferno: ["#08090b", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  borealis: ["#0a2a2e", "#0e6b45", "#2bdc7a", "#8ef0b0", "#7a5cff", "#e04f8a"],
  mono: ["#1a1c20", "#5a5e66", "#b8bcc4", "#ffffff"],
});

/** Every colour suite the page spectrum can draw in, Accent first. */
export const SPECTRUM_PALETTES = Object.freeze([ACCENT, ...Object.keys(SPECTRUM_SUITES)]);

/** The suites under which the bars are drawn over one gradient fixed across the canvas, floor to full scale. */
const FIXED_BARS = new Set(["retro"]);

const LEVEL_STOPS = 9; // stops a gradient coloured by level carries, floor to full scale
const CHANNEL_MAX = 255;
const PERCENT = 100;

/** @typedef {[number, number, number]} Triple */

/** @type {Map<string, Triple[]>} each fixed suite's ramp, 0 to 255 per channel, built on first use */
const ramps = new Map();
/** The Accent ramp built last, and the accent it was built from. */
let accentRamp = { accent: "", ramp: /** @type {Triple[]} */ ([]) };

/** @param {number} c 0 to 255 */
const hexByte = (c) => c.toString(16).padStart(2, "0");

const BLACK = [0, 0, 0]; // what a colour that is not hex reads as

/** @param {number[]} channels  RGB, 0 to 255 each */
const hexOf = (channels) => `#${channels.map((c) => hexByte(c)).join("")}`;

/**
 * The accent token `name` derived from `pick`, as the stylesheet mixes it.
 *
 * @param {number[]} pick  RGB, 0 to 255 per channel
 * @param {string} name
 * @returns {string}  `#rrggbb`
 */
function shadeOf(pick, name) {
  const [share, into] = ACCENT_SHADES[name];
  const base = rgb(into, BLACK);
  return hexOf(pick.map((c, i) => Math.round((c * share + base[i] * (PERCENT - share)) / PERCENT)));
}

/**
 * The Accent suite's colours for the accent `accent`: its low, dim, own and rim shades, floor to full scale.
 *
 * @param {string} accent  `#rrggbb`
 * @returns {string[]}
 */
function accentShades(accent) {
  const pick = rgb(accent, BLACK);
  return [shadeOf(pick, "--acc-lo"), shadeOf(pick, "--acc-dim"), hexOf(pick), shadeOf(pick, "--acc-rim")];
}

/**
 * `suite`'s colours, the accent's shades under Accent or a name that is no suite.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {readonly string[]}
 */
const stopsOf = (suite, accent) =>
  Object.hasOwn(SPECTRUM_SUITES, suite) ? SPECTRUM_SUITES[suite] : accentShades(accent);

/**
 * `suite`'s ramp, floor first.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Triple[]}
 */
function rampOf(suite, accent) {
  if (!Object.hasOwn(SPECTRUM_SUITES, suite)) {
    if (accentRamp.accent !== accent) accentRamp = { accent, ramp: rampFrom(accentShades(accent)) };
    return accentRamp.ramp;
  }
  let ramp = ramps.get(suite);
  if (!ramp) {
    ramp = rampFrom([...SPECTRUM_SUITES[suite]]);
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

/**
 * The colour a part of the spectrum at plot fraction `at` is drawn in under `suite`, blended between the suite's
 * colours: its first on the floor, its last at full scale.
 *
 * @param {string} suite
 * @param {number} at  0 on the floor, 1 at full scale
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {string}  `#rrggbb`
 */
export function suiteColor(suite, at, accent) {
  return hexOf(rampAt(rampOf(suite, accent), at));
}

/**
 * The colour a line style draws level `at` in under `suite`: the suite from its second colour on the floor to its
 * last at full scale, so a line never takes the floor colour it would vanish into.
 *
 * @param {string} suite
 * @param {number} at  0 on the floor, 1 at full scale
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {string}  `#rrggbb`
 */
function suiteLineColor(suite, at, accent) {
  const from = 1 / (stopsOf(suite, accent).length - 1);
  return suiteColor(suite, from + clamp(at, 0, 1) * (1 - from), accent);
}

/**
 * The stops of a line style's gradient coloured by level under `suite`, LEVEL_STOPS of them from the floor (0) to full
 * scale (1), each its offset and its colour as suiteLineColor gives it.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {[number, string][]}
 */
export function suiteLineStops(suite, accent) {
  return Array.from({ length: LEVEL_STOPS }, (_, i) => {
    const at = i / (LEVEL_STOPS - 1);
    return /** @type {[number, string]} */ ([at, suiteLineColor(suite, at, accent)]);
  });
}

/**
 * The stops of the one gradient the bars are drawn over under `suite`, fixed across the canvas: the suite's colours
 * spread evenly from the floor (0) to full scale (1). None under a suite whose bars each take the colour at their own
 * height.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {[number, string][]}
 */
export function suiteBarStops(suite, accent) {
  if (!FIXED_BARS.has(suite)) return [];
  const stops = stopsOf(suite, accent);
  return stops.map((colour, i) => /** @type {[number, string]} */ ([i / Math.max(1, stops.length - 1), colour]));
}

/** @param {number} c  sRGB channel, 0 to 1 @returns {number} the channel's linear light */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * How light `channels` look: CIE lightness from the colour's relative luminance, 0 for black and 1 for white.
 *
 * @param {number[]} channels  RGB, 0 to 255 each
 * @returns {number}
 */
function lightness(channels) {
  const [r, g, b] = channels.map((c) => toLinear(c / CHANNEL_MAX));
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return clamp(y > 0.008856 ? 1.16 * Math.cbrt(y) - 0.16 : 9.033 * y, 0, 1);
}

/**
 * The Fade halo's starting strength in a colour `channels`, as a share of the trace's: HALO_START in white, rising
 * evenly with how dark the colour looks to HALO_START_DARK in black, so a dark halo shows as plainly as a light one.
 *
 * @param {number[]} channels  RGB, 0 to 255 each
 * @returns {number}
 */
function haloStart(channels) {
  return HALO_START + (HALO_START_DARK - HALO_START) * (1 - lightness(channels));
}

/**
 * The stops of the Fade halo's gradient coloured by level under `suite`: the trace's own stops as suiteLineStops gives
 * them, each colour at the halo's starting strength in that colour.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {[number, string][]}  each stop's offset and its colour as `rgba(r, g, b, a)`
 */
export function suiteHaloStops(suite, accent) {
  return suiteLineStops(suite, accent).map(([at, colour]) => {
    const channels = rgb(colour, BLACK);
    const alpha = haloStart(channels).toFixed(3);
    return /** @type {[number, string]} */ ([at, `rgba(${channels.join(", ")}, ${alpha})`]);
  });
}

/**
 * Aurora's ramp under `suite`: `count` colours spread evenly from the suite's floor to its full scale, one RGB triple
 * each in one flat list, each channel 0 to 1.
 *
 * @param {string} suite
 * @param {number} count
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {number[]}
 */
export function suiteRamp(suite, count, accent) {
  const ramp = rampOf(suite, accent);
  return Array.from({ length: count }, (_, i) => rampAt(ramp, i / Math.max(1, count - 1))).flatMap((c) =>
    c.map((v) => v / CHANNEL_MAX),
  );
}
