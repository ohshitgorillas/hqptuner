// Units for on-screen numbers.
//
// This module owns the two decisions the call sites kept making differently:
// whether a positive dB value carries a "+", and which unit a frequency picks.
// Eight dB sites had free-chosen signing — one of them hand-rolling the exact
// ternary another already had — and five sites picked a frequency unit their
// own way, so 1000 Hz read as "1 kHz", "1.0 kHz", "1.00 kHz" and "1000 Hz"
// depending on which card you were looking at.
//
// Precision deliberately does NOT live here. A drag readout wants fixed
// decimals so its width does not jitter under the pointer; a chip wants the
// shortest true figure. That is a real difference, not drift, so every function
// takes its decimals from the caller.

// Above this rate every signal HQPlayer emits is a 1-bit bitstream, and MHz is
// the idiom people read those in. PCM stays in kHz however high it goes, which
// is why the threshold is the DSD floor rather than a round 1e6.
const MHZ_FLOOR = 2822400; // DSD64 = 44.1k x 64

// Trailing zeros are noise on a rate — "96 kHz", not "96.0 kHz". `dp` is
// therefore a ceiling on the decimals rather than a count of them.
const trim = (/** @type {number} */ v, /** @type {number} */ dp) => String(Number(v.toFixed(dp)));

/**
 * A frequency, unit picked by magnitude, carrying at most `dp` decimals.
 * @param {number} n hertz
 * @param {number} dp maximum decimals on the scaled figure
 */
export function hz(n, dp) {
  if (n >= MHZ_FLOOR) return `${trim(n / 1e6, dp)} MHz`;
  if (n >= 1000) return `${trim(n / 1000, dp)} kHz`;
  return `${trim(n, dp)} Hz`;
}

/**
 * An absolute level. A level is not an offset, so a positive carries no sign.
 * @param {number | string} v decibels
 * @param {number} dp decimals
 */
export const db = (v, dp) => `${Number(v).toFixed(dp)} dB`;

/**
 * A relative offset. A positive carries "+" so the direction reads at a glance.
 * @param {number | string} v decibels
 * @param {number} dp decimals
 */
export const dbOffset = (v, dp) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(dp)} dB`;
