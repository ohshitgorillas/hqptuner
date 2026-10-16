// Page spectrum colors and bands, free of the DOM and of time: the same call answers the same way whatever was asked
// before it. Levels become plot fractions and bands, every height a fraction of the plot, 0 on the floor and 1 at full
// scale; fractions and bands handed a buffer write into it, allocating nothing. A color suite gives the color a part of
// the spectrum is drawn in by its height, the line styles and the Fade halo their gradient stops, the bars their
// gradient if any, and aurora its ramp; aurora gives way to the trace without WebGL2.

import { clamp } from "../../../lib/coerce.js";
import { rampFrom, rgb } from "../../../lib/spectroraster.js";
import { ACCENT_SHADES } from "../../shell/settings.js";
import { fraction } from "./meter.js";

export const BANDS = 64; // bars the bar styles draw across the plot
const HALO_START = 0.5; // the halo's glow where a white trace has just been, share of the trace's strength
const HALO_START_DARK = 1; // the halo's glow where a black trace has just been, share of the trace's strength

/**
 * Levels as plot fractions on a plot spanning `range` dB down from full scale, clamped to [0, 1].
 *
 * @param {ArrayLike<number>} disp  dBFS
 * @param {number} range  dB, positive
 * @param {Float32Array} [out]  written in place where as long as `disp`, a new array taking its place otherwise
 * @returns {Float32Array}
 */
export function fractionsOf(disp, range, out) {
  const fracs = out?.length === disp.length ? out : new Float32Array(disp.length);
  for (let i = 0; i < disp.length; i++) fracs[i] = fraction(disp[i], range);
  return fracs;
}

/**
 * Band `b` of `n` across the columns: the largest fraction from column `floor(b·len/n)` up to, not including,
 * `floor((b+1)·len/n)`, so the last band ends on the last column.
 *
 * @param {ArrayLike<number>} fracs  plot fractions
 * @param {number} b
 * @param {number} n
 * @returns {number}
 */
export function bandTop(fracs, b, n) {
  const len = fracs.length;
  const end = Math.floor(((b + 1) * len) / n);
  let top = 0;
  for (let c = Math.floor((b * len) / n); c < end; c++) top = Math.max(top, fracs[c]);
  return top;
}

/**
 * Columns grouped into `n` bands, each as bandTop gives it.
 *
 * @param {ArrayLike<number>} fracs  plot fractions
 * @param {number} n
 * @param {Float32Array} [out]  written in place where it holds `n`, a new array taking its place otherwise
 * @returns {Float32Array}
 */
export function bandsOf(fracs, n, out) {
  const bands = out?.length === n ? out : new Float32Array(n);
  for (let b = 0; b < n; b++) bands[b] = bandTop(fracs, b, n);
  return bands;
}

/** The color suite drawn in the four shades of the accent in force. */
export const ACCENT = "accent";

/**
 * The color suites the page spectrum can draw in besides Accent, each its colors as `#rrggbb`, floor first, full last.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const SPECTRUM_SUITES = Object.freeze({
  retro: ["#29ce10", "#d6b521", "#ef3110"],
  inferno: ["#08090b", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  borealis: ["#0a2a2e", "#0e6b45", "#2bdc7a", "#8ef0b0", "#7a5cff", "#e04f8a"],
  mono: ["#1a1c20", "#5a5e66", "#b8bcc4", "#ffffff"],
});

/** Every color suite the page spectrum can draw in, Accent first. */
export const SPECTRUM_PALETTES = Object.freeze([ACCENT, ...Object.keys(SPECTRUM_SUITES)]);

/** The suites under which the bars are drawn over one gradient fixed across the canvas, floor to full scale. */
const FIXED_BARS = new Set(["retro"]);

const LEVEL_STOPS = 9; // stops a gradient colored by level carries, floor to full scale
export const CHANNEL_MAX = 255;
const PERCENT = 100;

/** @typedef {[number, number, number]} Triple */

/** @type {Map<string, Triple[]>} each fixed suite's ramp, 0 to 255 per channel, built on first use */
const ramps = new Map();
/** The Accent ramp built last, and the accent it was built from. */
let accentRamp = { accent: "", ramp: /** @type {Triple[]} */ ([]) };

/** @param {number} c 0 to 255 */
const hexByte = (c) => c.toString(16).padStart(2, "0");

const BLACK = [0, 0, 0]; // what a color that is not hex reads as

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
 * The Accent suite's colors for the accent `accent`: its low, dim, own and rim shades, floor to full scale.
 *
 * @param {string} accent  `#rrggbb`
 * @returns {string[]}
 */
function accentShades(accent) {
  const pick = rgb(accent, BLACK);
  return [shadeOf(pick, "--acc-lo"), shadeOf(pick, "--acc-dim"), hexOf(pick), shadeOf(pick, "--acc-rim")];
}

/**
 * `suite`'s colors, the accent's shades under Accent or a name that is no suite.
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
export function rampOf(suite, accent) {
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
 * The color of `ramp` at plot fraction `at`.
 *
 * @param {Triple[]} ramp
 * @param {number} at
 * @returns {Triple}
 */
export const rampAt = (ramp, at) => ramp[Math.round(clamp(at, 0, 1) * (ramp.length - 1))];

/**
 * The color a part of the spectrum at plot fraction `at` is drawn in under `suite`, blended between the suite's
 * colors: its first on the floor, its last at full scale.
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
 * The color a line style draws level `at` in under `suite`: the suite from its second color on the floor to its
 * last at full scale, so a line never takes the floor color it would vanish into.
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
 * A line style's gradient stops under `suite`: LEVEL_STOPS from floor (0) to full scale (1), colored by suiteLineColor.
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
 * The Trace style's gradient stops under `suite`: solid in the accent under Accent, else as suiteLineStops gives them.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {[number, string][]}
 */
export function traceStops(suite, accent) {
  if (Object.hasOwn(SPECTRUM_SUITES, suite)) return suiteLineStops(suite, accent);
  return [
    [0, accent],
    [1, accent],
  ];
}

/**
 * The stops of the one gradient the bars are drawn over under `suite`, fixed across the canvas: the suite's colors
 * spread evenly from floor (0) to full scale (1). None under a suite whose bars each take the color at their height.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {[number, string][]}
 */
export function suiteBarStops(suite, accent) {
  if (!FIXED_BARS.has(suite)) return [];
  const stops = stopsOf(suite, accent);
  return stops.map((color, i) => /** @type {[number, string]} */ ([i / Math.max(1, stops.length - 1), color]));
}

/** @param {number} c  sRGB channel, 0 to 1 @returns {number} the channel's linear light */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * How light `channels` look: CIE lightness from the color's relative luminance, 0 for black and 1 for white.
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
 * The Fade halo's starting strength in a color `channels`, as a share of the trace's: HALO_START in white, rising
 * evenly with how dark the color looks to HALO_START_DARK in black, so a dark halo shows as plainly as a light one.
 *
 * @param {number[]} channels  RGB, 0 to 255 each
 * @returns {number}
 */
function haloStart(channels) {
  return HALO_START + (HALO_START_DARK - HALO_START) * (1 - lightness(channels));
}

/**
 * The Fade halo's gradient stops under `suite`: suiteLineStops', each at the halo's starting strength in its color.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`, which Accent draws in
 * @returns {[number, string][]}  each stop's offset and its color as `rgba(r, g, b, a)`
 */
export function suiteHaloStops(suite, accent) {
  return suiteLineStops(suite, accent).map(([at, color]) => {
    const channels = rgb(color, BLACK);
    const alpha = haloStart(channels).toFixed(3);
    return /** @type {[number, string]} */ ([at, `rgba(${channels.join(", ")}, ${alpha})`]);
  });
}

/**
 * Aurora's ramp under `suite`: `count` colors evenly from floor to full scale, one flat RGB list, channels 0 to 1.
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
