// Physical path parameters for the structural crossfeed compiler
// (docs/crossfeed-math.md). This module owns the Brown & Duda geometry alone —
// the head-shadow alpha, the Woodworth ray delay, the lp1 corner, and the
// PathParams bundle derived from the two physical controls. It is its own module
// because it is pure physics with no imports at all: row synthesis, frequency
// response and recognition all sit on top of it and none of them sit under it.
//
// The model is Brown & Duda's structural HRTF (IEEE TSAP 6(5), 1998), whose
// head-shadow filter is a single-pole/single-zero that factors EXACTLY into a
// constant plus a scaled first-order lowpass:
//
//   H_HS = (1 + jαx)/(1 + jx) = α + (1−α)/(1 + jx),   x = ω/(2ω₀),  ω₀ = c/a

/**
 * @typedef {{ alphaNear: number, alphaFar: number, itd: number, cornerHz: number,
 *   groupDelayNear: number, groupDelayFar: number }} PathParams
 *   Everything the row compiler derives from the two physical controls.
 */

// c is the paper's value, NOT HQPlayer's 343.956. That default belongs to the
// delay plugin's `v` argument, which converts `d=<metres>` into a delay — we emit
// `t=<seconds>`, so `v` is never consulted and there is nothing to match. The
// paper's 343 is the constant a, alpha_min and theta_min were fitted against on
// KEMAR data, and those travel together. The difference is 0.7 us of ITD, under
// the 22.7 us sample floor at 44.1 kHz and dominated ~37x by head-radius spread
// across adults (+/-26 us) — which is why `a` is a control and c is not.
// m/s — Brown & Duda §II.A, per the note above. Deliberately a constant, not a compileRows/recognizeRows parameter: a mismatch between the two recovers a silently wrong head radius (0.08673 m for a compiled 0.0875 m) rather than declining the block.
export const SPEED_OF_SOUND = 343;
export const HEAD_RADIUS = 0.0875; // m — Brown & Duda's stated average adult
export const SPEAKER_ANGLE = 30; // degrees off center — the stereo standard

export const ALPHA_MIN = 0.1;
export const THETA_MIN = 150;

// Eq. (5). `theta` is interaural-polar: measured from the interaural axis, so a
// source at `angle` degrees off center sits at 90−angle for the near ear and
// 90+angle for the far one.
/**
 * @param {number} theta interaural-polar angle in degrees
 * @returns {number}
 */
function alphaOf(theta) {
  return 1 + ALPHA_MIN / 2 + (1 - ALPHA_MIN / 2) * Math.cos((theta / THETA_MIN) * Math.PI);
}

// Eq. (2), Woodworth & Schlosberg: arrival time relative to the head center,
// in seconds. Negative = early (source on this side).
/**
 * @param {number} theta interaural-polar angle in degrees
 * @param {number} [a] head radius in metres
 * @param {number} [c] speed of sound in m/s
 * @returns {number}
 */
function rayDelay(theta, a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
  const rad = (Math.abs(theta) * Math.PI) / 180;
  const scale = a / c;
  return rad < Math.PI / 2 ? -scale * Math.cos(rad) : scale * (rad - Math.PI / 2);
}

// The lp1 corner: the pole sits at 2ω₀, so f = ω₀/π = c/(aπ).
/**
 * @param {number} [a] head radius in metres
 * @param {number} [c] speed of sound in m/s
 * @returns {number}
 */
function shadowCornerHz(a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
  return c / (a * Math.PI);
}

// Everything the row compiler needs, derived from the two physical controls.
// `itd` is the far ear's ray delay relative to the near ear's, so the near path
// carries no delay stage and the far path carries all of it.
/**
 * @param {number} [angle] speaker angle in degrees off center
 * @param {number} [a] head radius in metres
 * @param {number} [c] speed of sound in m/s
 * @returns {PathParams}
 */
export function pathParams(angle = SPEAKER_ANGLE, a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
  const near = 90 - angle;
  const far = 90 + angle;
  return {
    alphaNear: alphaOf(near),
    alphaFar: alphaOf(far),
    itd: rayDelay(far, a, c) - rayDelay(near, a, c),
    cornerHz: shadowCornerHz(a, c),
    // group delay each shadow filter contributes, ½(a/c)(1−α); reported for the
    // UI rather than used here — it is inherent to the lp1, not a stage
    groupDelayNear: 0.5 * (a / c) * (1 - alphaOf(near)),
    groupDelayFar: 0.5 * (a / c) * (1 - alphaOf(far)),
  };
}
