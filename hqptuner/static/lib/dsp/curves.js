// The curves the UI plots directly — loudness shelving, its volume-adaptive
// scale, the crossfeed feed path, and the log frequency grid they all share.
// Its own module because this is exactly what components/plots.js consumes: the
// plot side of the dsp math, with no matrix-pipeline machinery attached.
//
// Pure DSP math for the post-processing response plots. No daemon round-trip —
// every curve here is recomputed client-side on each knob move so dragging feels
// instantaneous.
//
// The Bauer crossfeed feed path is a deliberate first-order MODEL (not the exact
// bs2b filter): a low-pass whose DC level is the feed level and whose corner is
// the cross-over frequency — enough to show the frequency/level interaction.

import { TAU, biquadMagDb, peakBiquad, rbjAlpha, shelfFromAlpha } from "./biquad.js";

/** @typedef {import("./biquad.js").Biquad} Biquad */

// --- loudness bands ----------------------------------------------------------
// The coefficient builders live in ./biquad.js: a loudness band and an iir stage
// are the same RBJ algebra, so they share one copy of it.

// One loudness band -> coefficients, dispatched by the form's `type` value.
// Steepness/Q is the shelf slope S for shelves, bandwidth for peak, Q for peakq
// — exactly the three shape parameters rbjAlpha already dispatches on.
/**
 * @param {{ type: string, f0: number, g: number, shape: number }} band
 * @param {number} fs
 * @returns {Biquad}
 */
function bandCoeffs({ type, f0, g, shape }, fs) {
  const w0 = (TAU * f0) / fs;
  const A = 10 ** (g / 40);
  if (type === "peak") return peakBiquad(w0, rbjAlpha(w0, { bw: shape }), A);
  if (type === "peakq") return peakBiquad(w0, rbjAlpha(w0, { q: shape }), A);
  const shelf = type === "hshelf" ? "hshelf" : "lshelf"; // lshelf is the default
  return shelfFromAlpha(shelf, rbjAlpha(w0, { s: shape }, A), { f0, g, fs });
}

/**
 * Combined bass + treble magnitude in dB at f, each band's gain scaled by
 * `scale` (0..1) — the volume-adaptive shelving fraction.
 * @param {{ lowType: string, lowFreq: number, lowLevel: number, lowSteep: number,
 *           highType: string, highFreq: number, highLevel: number, highSteep: number }} p
 * @param {number} f
 * @param {number} fs
 * @param {number} scale
 * @returns {number}
 */
export function loudnessMagDb(p, f, fs, scale) {
  const bass = bandCoeffs({ type: p.lowType, f0: p.lowFreq, g: p.lowLevel * scale, shape: p.lowSteep }, fs);
  const treble = bandCoeffs({ type: p.highType, f0: p.highFreq, g: p.highLevel * scale, shape: p.highSteep }, fs);
  return biquadMagDb(bass, f, fs) + biquadMagDb(treble, f, fs);
}

/**
 * Volume -> shelving fraction: full (1) at/below the lower bound, none (0) at/
 * above the upper bound, linearly interpolated between. This is the loudness
 * compensation curve — more shelving the quieter you listen.
 * @param {number} volume
 * @param {number} rangeLow
 * @param {number} rangeHigh
 * @returns {number}
 */
export function shelfScale(volume, rangeLow, rangeHigh) {
  if (rangeHigh <= rangeLow) return volume <= rangeLow ? 1 : 0;
  return Math.max(0, Math.min(1, (rangeHigh - volume) / (rangeHigh - rangeLow)));
}

/**
 * First-order Bauer-crossfeed feed-path model: the cross-fed (opposite-channel)
 * signal sits `levelDb` below the direct path at DC and rolls off first-order
 * above the cross-over frequency `fc`. The direct path is flat 0 dB.
 * @param {number} f
 * @param {number} fc
 * @param {number} levelDb
 * @returns {number}
 */
export function crossfeedMagDb(f, fc, levelDb) {
  return -Math.abs(levelDb) - 10 * Math.log10(1 + (f / fc) ** 2);
}

// Logarithmically-spaced frequency points across [f0, f1] for a plot trace.
/**
 * @param {number} f0
 * @param {number} f1
 * @param {number} n
 * @returns {number[]}
 */
function logFreqs(f0, f1, n) {
  const out = new Array(n);
  const k = Math.log(f1 / f0) / (n - 1);
  for (let i = 0; i < n; i += 1) out[i] = f0 * Math.exp(k * i);
  return out;
}

// The audio band every response plot spans. Its endpoints double as the plot
// x-domain (components/plots.js), so they live here instead of being retyped at
// each of the nine call sites `bandFreqs` replaced.
export const F0 = 20;
export const F1 = 20000;
/** `n` logarithmically-spaced frequency points spanning F0..F1, for a plot trace. */
export const bandFreqs = (/** @type {number} */ n) => logFreqs(F0, F1, n);
