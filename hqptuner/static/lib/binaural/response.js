// Analysis of the compiled crossfeed block. Complex response of the compiled
// block, for plots and for verifying that the rows really do realize G_M and
// G_S. Evaluated on the analog prototype, which is what the daemon's
// rate-independent parametrics implement.
//
// Its own module because it is the frequency-domain read of the same
// coefficients compile.js emits as rows: only plotting needs it, and nothing
// else in the block depends on it.

import { SPEAKER_ANGLE, HEAD_RADIUS, pathParams } from "./geometry.js";
import { earCoefficients } from "./compile.js";

/**
 * @typedef {import("./geometry.js").PathParams} PathParams
 * @typedef {import("./compile.js").EarCoefficient} EarCoefficient
 */

/**
 * @param {number} f
 * @param {number} cornerHz
 * @returns {[number, number]}
 */
function lp1Response(f, cornerHz) {
  const x = f / cornerHz;
  const d = 1 + x * x;
  return [1 / d, -x / d];
}

/**
 * @param {number} f
 * @param {number} seconds
 * @returns {[number, number]}
 */
function delayResponse(f, seconds) {
  const w = -2 * Math.PI * f * seconds;
  return [Math.cos(w), Math.sin(w)];
}

/** @type {(a: [number, number], b: [number, number]) => [number, number]} */
const mul = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];

// Sum of one ear's eight rows at frequency f, as [re, im]. `sameSide` picks
// which source the signal arrived on: pass 1 for correlated (center) content in
// both sources, or use midSideResponse below.
/**
 * @param {number} f
 * @param {EarCoefficient[]} coeffs
 * @param {PathParams} p
 * @param {(opposite: boolean) => number} sourceGain
 * @returns {[number, number]}
 */
function earResponse(f, coeffs, p, sourceGain) {
  let re = 0;
  let im = 0;
  for (const c of coeffs) {
    /** @type {[number, number]} */
    let term = [1, 0];
    if (c.lowpass) term = mul(term, lp1Response(f, p.cornerHz));
    if (c.delayed) term = mul(term, delayResponse(f, p.itd));
    const g = c.gain * sourceGain(c.opposite === true);
    re += g * term[0];
    im += g * term[1];
  }
  return [re, im];
}

/**
 * Center and side transfer functions of the compiled block at frequency f.
 * Center drives both sources in phase; side drives them in antiphase.
 * @param {number} f
 * @param {{ lambda?: number, angle?: number, headRadius?: number }} [controls]
 * @returns {{ mid: [number, number], side: [number, number] }}
 */
export function midSideResponse(f, { lambda = 1, angle = SPEAKER_ANGLE, headRadius = HEAD_RADIUS } = {}) {
  const p = pathParams(angle, headRadius);
  const coeffs = earCoefficients(lambda, p.alphaNear, p.alphaFar);
  return {
    mid: earResponse(f, coeffs, p, () => 1),
    side: earResponse(f, coeffs, p, (opposite) => (opposite ? -1 : 1)),
  };
}

/**
 * Magnitude of a complex response in dB.
 * @param {[number, number]} c a complex response as [real, imaginary]
 */
export const magDb = ([re, im]) => 10 * Math.log10(re * re + im * im);
