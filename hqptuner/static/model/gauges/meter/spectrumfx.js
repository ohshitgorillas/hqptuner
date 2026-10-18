// The spectrum's color and band surface, free of the DOM and of any clock: the palette choices (the page accent and the
// named color suites), each suite's ramp from the floor to full scale and its color at a fraction along it, a fraction
// past either end taking that end. Under Accent the ramp runs through the accent's own shades, derived from the accent
// handed in as the page derives them, so it carries no hex of its own. A ramp is built once per suite, and once per
// accent under Accent, and handed back as built until either changes. The bands: plot fractions grouped into bands, each
// band the top of its group, refilled into the buffers a paint hands back, and the reusable buffer both that and the
// shown columns' fractions are written into. The stops a line is stroked in, and the Trace style's trace, solid in the accent under Accent and colored
// by level under a named suite.

import { rgb, rampFrom } from "../../../lib/spectroraster.js";
import { ACCENT_SHADES } from "../../shell/settings.js";

/** @typedef {[number, string]} Stop */

/** The palette that draws in the accent's shades. */
export const ACCENT = "accent";

/** The named color suites, each its control points from the floor to full scale. */
const SUITES = Object.freeze({
  retro: ["#0b3d12", "#22c03a", "#9be22d", "#f2d43a", "#f08a24", "#e8352a"],
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  borealis: ["#0b0f2a", "#2b2f7a", "#1f8a9a", "#3fe0a0", "#c9a0ff"],
  mono: ["#101214", "#f2f2f2"],
});

/** The palette identifiers the store holds, Accent first. @type {readonly string[]} */
export const SPECTRUM_PALETTES = Object.freeze([ACCENT, ...Object.keys(SUITES)]);

/** The top of a color channel, 8 bits. */
export const CHANNEL_MAX = 255;

/** Color channels a ramp step holds: red, green, blue. */
const CHANNELS = 3;

/** The bands the shown columns are grouped into across the plot, low frequencies first. */
export const BANDS = 32;

/** The stops a line's gradient takes from its ramp, floor to full scale. */
const LINE_STOPS = 6;

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
 * The last ramp built for each suite, with the accent it was built under ("" for a named suite).
 *
 * @type {Map<string, { accent: string, ramp: Float32Array }>}
 */
const built = new Map();

/**
 * The ramp `suite` draws in, from the floor to full scale, red, green and blue a step, 0 to CHANNEL_MAX each; Accent's,
 * and any identifier that names no suite, in the accent's shades. The same suite and accent hand back the same ramp.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Float32Array}
 */
export function rampOf(suite, accent) {
  const named = Object.hasOwn(SUITES, suite) ? suite : ACCENT;
  const key = named === ACCENT ? accent : "";
  const last = built.get(named);
  if (last && last.accent === key) return last.ramp;
  const stops = named === ACCENT ? accentStops(accent) : SUITES[/** @type {keyof typeof SUITES} */ (named)];
  const ramp = Float32Array.from(rampFrom(stops).flat());
  built.set(named, { accent: key, ramp });
  return ramp;
}

/**
 * A ramp's color at fraction `at` along it, red, green and blue: 0 is the floor, 1 full scale, a fraction past either
 * end takes that end.
 *
 * @param {Float32Array} ramp  as rampOf gives it
 * @param {number} at
 * @returns {Uint8Array}
 */
export function rampAt(ramp, at) {
  const steps = ramp.length / CHANNELS;
  const step = Math.round((at > 0 ? Math.min(at, 1) : 0) * (steps - 1));
  return Uint8Array.from(ramp.subarray(step * CHANNELS, (step + 1) * CHANNELS));
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
  return hexOf(rampAt(rampOf(suite, accent), at));
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
 * @param {Float32Array} [out]  the bands of the paint before, reused where it fits
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
 * The stops a line in `suite` is stroked in, from the floor to full scale, under Accent in the accent's shades.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {Stop[]}
 */
export function suiteLineStops(suite, accent) {
  return Array.from({ length: LINE_STOPS }, (_, k) => {
    const at = k / (LINE_STOPS - 1);
    return /** @type {Stop} */ ([at, suiteColor(suite, at, accent)]);
  });
}

/**
 * The stops the Trace style's trace is stroked in, from the floor to full scale: solid in the accent under Accent, and
 * under any identifier that names no suite; colored by level along the suite's ramp under a named suite.
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
