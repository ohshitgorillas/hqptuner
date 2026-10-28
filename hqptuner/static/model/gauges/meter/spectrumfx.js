// The spectrum's color and band surface, free of the DOM and of any clock: the palette choices (the page accent and the
// named color suites), each suite's ramp from the floor to full scale and its color at a fraction along it, a fraction
// past either end taking that end. Under Accent the ramp runs through the accent's own shades, derived from the accent
// handed in as the page derives them, so it carries no hex of its own. Every ramp is a new object holding each step's
// color both as channels and as `#rrggbb`, so reading a color off a ramp the caller holds allocates nothing; a ramp or
// a set of stops is built on a change of suite or accent, never on every paint, since building one allocates.
// The bands: plot fractions grouped into bands, each band the top of its group, refilled into the buffers a paint hands
// back, and the reusable buffer both the bands and the shown columns' fractions are written into. The stops a line is
// stroked in; the Trace style's trace, solid in the accent under Accent and colored by level under a named suite; the
// one gradient the bars are drawn over under a suite that fixes it; and the Fade style's halo.

import { clamp } from "../../../lib/coerce.js";
import { rgb, rampFrom, toLinear } from "../../../lib/spectroraster.js";
import { ACCENT_SHADES } from "../../shell/settings.js";

/** @typedef {[number, string]} Stop */

/**
 * A ramp from the floor to full scale, as rampOf builds it.
 *
 * @typedef {object} Ramp
 * @property {Uint8Array[]} colors  each step's red, green and blue, 0 to CHANNEL_MAX each, floor first
 * @property {string[]} hexes  each step's color as `#rrggbb`, floor first
 */

/** The palette that draws in the accent's shades. */
export const ACCENT = "accent";

/** The named color suites, each its control points from the floor to full scale. */
const SUITES = Object.freeze({
  retro: ["#29ce10", "#d6b521", "#ef3110"],
  inferno: ["#08090b", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  borealis: ["#0a2a2e", "#0e6b45", "#2bdc7a", "#8ef0b0", "#7a5cff", "#e04f8a"],
  mono: ["#1a1c20", "#5a5e66", "#b8bcc4", "#ffffff"],
});

/** The palette identifiers the store holds, Accent first. @type {readonly string[]} */
export const SPECTRUM_PALETTES = Object.freeze([ACCENT, ...Object.keys(SUITES)]);

/** The suites under which the bars are drawn over one gradient fixed across the canvas, floor to full scale. */
const FIXED_BARS = new Set(["retro"]);

/** The top of a color channel, 8 bits. */
export const CHANNEL_MAX = 255;

/** Color channels a ramp step holds: red, green, blue. */
const CHANNELS = 3;

/** The bands the shown columns are grouped into across the plot, low frequencies first. */
export const BANDS = 64;

/** The stops a line's gradient takes from its ramp, floor to full scale. */
const LINE_STOPS = 9;

/** The halo's glow where a white trace has just been, share of the trace's strength. */
const HALO_START = 0.5;

/** The halo's glow where a black trace has just been, share of the trace's strength. */
const HALO_START_DARK = 1;

/**
 * Red, green and blue, 0 to CHANNEL_MAX each, as `#rrggbb`.
 *
 * @param {ArrayLike<number>} rgbs
 * @returns {string}
 */
function hexOf(rgbs) {
  return "#" + Array.from(rgbs, (c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/**
 * `hex` mixed into `into` in sRGB, `share` % of `hex`, as `#rrggbb`: the page's `color-mix(in srgb, ...)`.
 *
 * @param {string} hex
 * @param {number} share
 * @param {string} into
 * @returns {string}
 */
function mixHex(hex, share, into) {
  const [a, b] = [rgb(hex, [0, 0, 0]), rgb(into, [0, 0, 0])];
  return hexOf(a.map((c, i) => (c * share + b[i] * (100 - share)) / 100));
}

/**
 * The accent's shades from the floor to full scale: its low, its dim, the accent itself and its rim.
 *
 * @param {string} accent  `#rrggbb`
 * @returns {string[]}
 */
function accentStops(accent) {
  const shade = (/** @type {string} */ name) => mixHex(accent, ...ACCENT_SHADES[name]);
  return [shade("--acc-lo"), shade("--acc-dim"), accent, shade("--acc-rim")];
}

/**
 * `suite`'s control points from the floor to full scale; Accent's, and any identifier that names no suite, the accent's
 * shades.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {string[]}
 */
function stopsOf(suite, accent) {
  return Object.hasOwn(SUITES, suite) ? SUITES[/** @type {keyof typeof SUITES} */ (suite)] : accentStops(accent);
}

/**
 * The ramp blended through `stops`, each step's channels a view on one buffer and its hex beside it.
 *
 * @param {string[]} stops  `#rrggbb` each, floor first
 * @returns {Ramp}
 */
function rampThrough(stops) {
  const steps = rampFrom(stops);
  const rgbs = Uint8Array.from(steps.flat());
  const colors = steps.map((_, s) => rgbs.subarray(s * CHANNELS, (s + 1) * CHANNELS));
  return { colors, hexes: colors.map(hexOf) };
}

/**
 * The ramp `suite` draws in, from the floor to full scale; Accent's, and any identifier that names no suite, in the
 * accent's shades.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Ramp}
 */
export function rampOf(suite, accent) {
  return rampThrough(stopsOf(suite, accent));
}

/**
 * The step of `ramp` at fraction `at`: 0 is the floor, 1 full scale, a fraction past either end takes that end.
 *
 * @param {Ramp} ramp
 * @param {number} at
 * @returns {number}
 */
function stepAt(ramp, at) {
  return Math.round((at > 0 ? Math.min(at, 1) : 0) * (ramp.colors.length - 1));
}

/**
 * A ramp's color at fraction `at` along it, red, green and blue, as the ramp holds it: the same ramp and fraction hand
 * back the same object.
 *
 * @param {Ramp} ramp  as rampOf gives it
 * @param {number} at  0 is the floor, 1 full scale, a fraction past either end takes that end
 * @returns {Uint8Array}
 */
export function rampAt(ramp, at) {
  return ramp.colors[stepAt(ramp, at)];
}

/**
 * A ramp's color at fraction `at` along it, as `#rrggbb`, as the ramp holds it.
 *
 * @param {Ramp} ramp  as rampOf gives it
 * @param {number} at  0 is the floor, 1 full scale, a fraction past either end takes that end
 * @returns {string}
 */
export function hexAt(ramp, at) {
  return ramp.hexes[stepAt(ramp, at)];
}

/**
 * The color `suite` draws at plot fraction `at`, under Accent in the accent's shades, as `#rrggbb`.
 *
 * @param {string} suite
 * @param {number} at
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {string}
 */
export function suiteColor(suite, at, accent) {
  return hexAt(rampOf(suite, accent), at);
}

/**
 * A buffer of `length` values: `out` where it holds that many, a new one otherwise.
 *
 * @param {Float32Array | undefined} out
 * @param {number} length
 * @returns {Float32Array}
 */
export function bufferOf(out, length) {
  return out?.length === length ? out : new Float32Array(length);
}

/**
 * The top of band `band` of `bands`: the largest of the plot fractions its group spans, the fractions split into
 * `bands` groups of as near equal size as whole fractions allow, each group at least one fraction. No fractions has
 * no top: 0.
 *
 * @param {ArrayLike<number>} fracs  plot fractions, low frequencies first
 * @param {number} band  0 is the lowest
 * @param {number} bands
 * @returns {number}
 */
export function bandTop(fracs, band, bands) {
  const n = fracs.length;
  if (n === 0) return 0;
  const from = Math.min(n - 1, Math.floor((band * n) / bands));
  const to = Math.max(from + 1, Math.min(n, Math.floor(((band + 1) * n) / bands)));
  let top = fracs[from];
  for (let i = from + 1; i < to; i++) if (fracs[i] > top) top = fracs[i];
  return top;
}

/**
 * Each of `bands` bands' top, as bandTop reads it, lowest band first. Written into `out` where it holds `bands` values,
 * into a new buffer otherwise.
 *
 * @param {ArrayLike<number>} fracs  plot fractions, low frequencies first
 * @param {number} bands
 * @param {Float32Array} [out]  an earlier paint's bands, reused where it fits
 * @returns {Float32Array}
 */
export function bandsOf(fracs, bands, out) {
  const tops = bufferOf(out, bands);
  for (let b = 0; b < bands; b++) tops[b] = bandTop(fracs, b, bands);
  return tops;
}

/**
 * `suite`'s ramp as `stops` colors from the floor to full scale, under Accent in the accent's shades: red, green and
 * blue a color, each 0 to 1, color `k` read at `k / (stops - 1)` of the way along the ramp.
 *
 * @param {string} suite
 * @param {number} stops
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Float32Array}
 */
export function suiteRamp(suite, stops, accent) {
  const ramp = rampOf(suite, accent);
  const out = new Float32Array(stops * CHANNELS);
  for (let k = 0; k < stops; k++) {
    const color = rampAt(ramp, stops > 1 ? k / (stops - 1) : 0);
    for (let c = 0; c < CHANNELS; c++) out[k * CHANNELS + c] = color[c] / CHANNEL_MAX;
  }
  return out;
}

/**
 * The stops a line in `suite` is stroked in, from the floor to full scale, under Accent in the accent's shades: the
 * ramp from the suite's second color on the floor to its last at full scale, so a line never takes the floor color it
 * would vanish into.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Stop[]}
 */
export function suiteLineStops(suite, accent) {
  const stops = stopsOf(suite, accent);
  const ramp = rampThrough(stops);
  const from = 1 / (stops.length - 1);
  return Array.from({ length: LINE_STOPS }, (_, k) => {
    const at = k / (LINE_STOPS - 1);
    return /** @type {Stop} */ ([at, hexAt(ramp, from + at * (1 - from))]);
  });
}

/**
 * The stops the Trace style's trace is stroked in, from the floor to full scale: solid in the accent under Accent, and
 * under any identifier that names no suite; colored by level as suiteLineStops gives them under a named suite.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Stop[]}
 */
export function traceStops(suite, accent) {
  if (!Object.hasOwn(SUITES, suite))
    return [
      [0, accent],
      [1, accent],
    ];
  return suiteLineStops(suite, accent);
}

/**
 * The stops of the one gradient the bars are drawn over under `suite`, fixed across the canvas: the suite's colors
 * spread evenly from the floor (0) to full scale (1). None under a suite whose bars each take the color at their height.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Stop[] | null}
 */
export function suiteBarStops(suite, accent) {
  if (!FIXED_BARS.has(suite)) return null;
  const stops = stopsOf(suite, accent);
  return stops.map((color, i) => /** @type {Stop} */ ([i / Math.max(1, stops.length - 1), color]));
}

/**
 * How light `channels` look: CIE lightness from the color's relative luminance, 0 for black and 1 for white.
 *
 * @param {number[]} channels  red, green and blue, 0 to CHANNEL_MAX each
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
 * @param {number[]} channels  red, green and blue, 0 to CHANNEL_MAX each
 * @returns {number}
 */
function haloStart(channels) {
  return HALO_START + (HALO_START_DARK - HALO_START) * (1 - lightness(channels));
}

/**
 * The Fade halo's gradient stops under `suite`: suiteLineStops', each at the halo's starting strength in its color.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Stop[]}  each stop's offset and its color as `rgba(r, g, b, a)`
 */
export function suiteHaloStops(suite, accent) {
  return suiteLineStops(suite, accent).map(([at, color]) => {
    const channels = rgb(color, [0, 0, 0]);
    const alpha = haloStart(channels).toFixed(3);
    return /** @type {Stop} */ ([at, `rgba(${channels.join(", ")}, ${alpha})`]);
  });
}
