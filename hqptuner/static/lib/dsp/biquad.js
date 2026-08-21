// The shared RBJ biquad kernel: the coefficient builders and the two
// transfer-function evaluators every other dsp module is written on top of. Its
// own module because a loudness band, an iir matrix stage and the eqlab grid hot
// path are all the same algebra — one copy of it, and nothing above it in the
// import graph.
//
// The loudness bands use exact RBJ "Audio EQ Cookbook" biquad coefficients
// (Robert Bristow-Johnson), matching HQPlayer's own shelving/peaking filters —
// no approximation. Verified against the live daemon on 6.0.4:
// six chains through /matrix/plot fit this math at 0.019 dB RMS with
// `q` read as RBJ Q — vs 2.66 dB reading it as bandwidth, 0.18 dB as shelf slope.
// The digital biquad's shape near the corner depends on the sample rate
// (bilinear warping), so `fs` is an explicit argument; the plots pass the active
// output rate. Caveat: the daemon's plot lane evaluates at a fixed ~96-99 kHz,
// so it grounds the coefficients but NOT the warping at the running source rate.

export const TAU = 2 * Math.PI;
const LN2_2 = Math.LN2 / 2;

export const DEG = 180 / Math.PI;

/** Wrap an angle in degrees into the half-open range [-180, 180). */
export const wrapDeg = (/** @type {number} */ x) => (((x % 360) + 540) % 360) - 180;

/**
 * @typedef {Record<string, string | number | undefined>} StageArgs
 *   One plugin stage's arguments as the wire carries them — values arrive as
 *   strings and are coerced with `Number()` at the point of use.
 * @typedef {{ b0: number, b1: number, b2: number, a1: number, a2: number }} Biquad
 *   Biquad coefficients normalized so a0 is 1.
 * @typedef {{ db: number, deg: number }} Response
 *   One point of a response curve: magnitude in dB, phase in degrees.
 * @typedef {{ args: StageArgs, f0: number, fs: number, g: number, w0: number, A: number }} IirCtx
 *   Everything a second-order builder derives once from a stage's args.
 */

/**
 * Magnitude in dB of a normalized biquad (a0 = 1) at frequency f.
 * @param {Biquad} c
 * @param {number} f
 * @param {number} fs
 * @returns {number}
 */
export function biquadMagDb(c, f, fs) {
  const w = (TAU * f) / fs;
  const cw = Math.cos(w);
  const c2w = Math.cos(2 * w);
  const sw = Math.sin(w);
  const s2w = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2w;
  const numIm = -(c.b1 * sw + c.b2 * s2w);
  const denRe = 1 + c.a1 * cw + c.a2 * c2w;
  const denIm = -(c.a1 * sw + c.a2 * s2w);
  const mag2 = (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm);
  return 10 * Math.log10(mag2);
}

/**
 * Phase in degrees of a normalized biquad at f (same transfer function as
 * biquadMagDb, atan2 instead of magnitude; wrapped to ±180 by construction).
 * @param {Biquad} c
 * @param {number} f
 * @param {number} fs
 * @returns {number}
 */
export function biquadPhaseDeg(c, f, fs) {
  const w = (TAU * f) / fs;
  const cw = Math.cos(w);
  const c2w = Math.cos(2 * w);
  const sw = Math.sin(w);
  const s2w = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2w;
  const numIm = -(c.b1 * sw + c.b2 * s2w);
  const denRe = 1 + c.a1 * cw + c.a2 * c2w;
  const denIm = -(c.a1 * sw + c.a2 * s2w);
  return (Math.atan2(numIm, numRe) - Math.atan2(denIm, denRe)) * DEG;
}

/**
 * RBJ alpha from whichever shape parameter the iir spec carries: q, bandwidth
 * (octaves), or shelf slope S (shelves only; A is the shelf amplitude). The
 * manual allows s on lp/hp too — approximated at Butterworth there (flagged).
 * @param {number} w0
 * @param {StageArgs} args
 * @param {number} [A]
 * @returns {number}
 */
export function rbjAlpha(w0, args, A = 1) {
  const sw = Math.sin(w0);
  if (args.q !== undefined) return sw / (2 * Number(args.q));
  if (args.bw !== undefined) return sw * Math.sinh((LN2_2 * Number(args.bw) * w0) / sw);
  if (args.s !== undefined) return (sw / 2) * Math.sqrt((A + 1 / A) * (1 / Number(args.s) - 1) + 2);
  return sw / (2 * 0.7071); // unspecified — Butterworth
}

/**
 * First-order lp1/hp1 as a biquad with b2 = a2 = 0: bilinear transform of the
 * one-pole prototype, corner f0 prewarped through K = tan(pi f0 / fs), unity in
 * the passband.
 * @param {string} type
 * @param {number} f0
 * @param {number} fs
 * @returns {Biquad}
 */
export function firstOrder(type, f0, fs) {
  const K = Math.tan((Math.PI * f0) / fs);
  const a0 = 1 + K;
  if (type === "lp1") return { b0: K / a0, b1: K / a0, b2: 0, a1: (K - 1) / a0, a2: 0 };
  return { b0: 1 / a0, b1: -1 / a0, b2: 0, a1: (K - 1) / a0, a2: 0 }; // hp1
}

/**
 * RBJ shelf coefficients from an explicit alpha (q- or slope-shaped alike).
 * @param {string} type
 * @param {number} alpha
 * @param {{ f0: number, g: number, fs: number }} at
 * @returns {Biquad}
 */
export function shelfFromAlpha(type, alpha, { f0, g, fs }) {
  const A = 10 ** (g / 40);
  const cw = Math.cos((TAU * f0) / fs);
  const t = 2 * Math.sqrt(A) * alpha;
  if (type === "lshelf") {
    const a0 = A + 1 + (A - 1) * cw + t;
    return {
      b0: (A * (A + 1 - (A - 1) * cw + t)) / a0,
      b1: (2 * A * (A - 1 - (A + 1) * cw)) / a0,
      b2: (A * (A + 1 - (A - 1) * cw - t)) / a0,
      a1: (-2 * (A - 1 + (A + 1) * cw)) / a0,
      a2: (A + 1 + (A - 1) * cw - t) / a0,
    };
  }
  const a0 = A + 1 - (A - 1) * cw + t;
  return {
    b0: (A * (A + 1 + (A - 1) * cw + t)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    b2: (A * (A + 1 + (A - 1) * cw - t)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
    a2: (A + 1 - (A - 1) * cw - t) / a0,
  };
}

/**
 * RBJ lp/hp/bp(0 dB peak)/notch/ap from an explicit alpha.
 * @param {string} type
 * @param {number} w0
 * @param {number} alpha
 * @returns {Biquad}
 */
export function plainBiquad(type, w0, alpha) {
  const cw = Math.cos(w0);
  const a0 = 1 + alpha;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - alpha) / a0;
  if (type === "lp") return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1, a2 };
  if (type === "hp") return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1, a2 };
  if (type === "bp") return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1, a2 };
  if (type === "notch") return { b0: 1 / a0, b1: (-2 * cw) / a0, b2: 1 / a0, a1, a2 };
  return { b0: (1 - alpha) / a0, b1: (-2 * cw) / a0, b2: (1 + alpha) / a0, a1, a2 }; // ap
}

/**
 * User-supplied raw coefficients, normalized by a0 (absent a0 = 1, never 0).
 * @param {StageArgs} args
 * @returns {Biquad}
 */
export function rawBiquad(args) {
  const a0 = Number(args.a0 ?? 1) || 1;
  return {
    b0: Number(args.b0 ?? 0) / a0,
    b1: Number(args.b1 ?? 0) / a0,
    b2: Number(args.b2 ?? 0) / a0,
    a1: Number(args.a1 ?? 0) / a0,
    a2: Number(args.a2 ?? 0) / a0,
  };
}

/**
 * RBJ peaking-EQ coefficients at center w0 from an explicit alpha, boosting or
 * cutting by the shelf amplitude A (= 10^(g/40), so ±g dB at the center).
 * @param {number} w0
 * @param {number} alpha
 * @param {number} A
 * @returns {Biquad}
 */
export function peakBiquad(w0, alpha, A) {
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * Math.cos(w0)) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

/**
 * Everything a second-order builder needs, derived once from the stage args.
 * @param {StageArgs} args
 * @param {number} f0
 * @param {number} fs
 * @returns {IirCtx}
 */
export function iirContext(args, f0, fs) {
  const g = Number(args.g ?? 0);
  const w0 = (TAU * f0) / fs;
  return { args, f0, fs, g, w0, A: 10 ** (g / 40) };
}
