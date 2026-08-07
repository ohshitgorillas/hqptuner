// Row synthesis for the structural crossfeed compiler (docs/crossfeed-math.md).
// Turns three physical controls — speaker angle, head radius, and the
// center-character blend λ — into matrix pipeline rows. This module owns the
// control-state -> sixteen-rows direction and nothing else; it is separate from
// the geometry it consumes and from the analysis and recognition that read its
// output back.
//
// Matrix rows sum into a shared mixdown and Lin gain may be negative, so that
// parallel form is directly expressible as two rows — a flat one at gain α and
// an lp1 one at gain (1−α). No fit, no rate-bound raw biquads.
//
// The center is on a continuous control while the side path stays physical:
//
//   G_S    = (H_n − H_f)/2                 side — never moves
//   G_M(λ) = λ·(H_n + H_f)/2 + (1 − λ)     center — λ=1 literal, λ=0 flat
//
// Per-source coefficients follow, and expanding H_n and H_f over {flat, lp1} ×
// {dry, delayed} gives four row types per source, eight per output ear:
//
//   A = (G_M + G_S)/2 = [(λ+1)·H_n + (λ−1)·H_f]/4 + (1−λ)/2    same-side
//   B = (G_M − G_S)/2 = [(λ−1)·H_n + (λ+1)·H_f]/4 + (1−λ)/2    opposite

import { fmtArg } from "../matrixspec.js";
import { HEAD_RADIUS, SPEAKER_ANGLE, pathParams } from "./geometry.js";

/**
 * @typedef {import("../matrixspec.js").PipelineRow} PipelineRow
 * @typedef {{ lowpass: boolean, delayed: boolean, gain: number, opposite?: boolean }} EarCoefficient
 *   One of the eight terms feeding an output ear.
 */

// A process chain in matrixspec's arg order, so it round-trips byte-identically.
/**
 * @param {boolean} lowpass
 * @param {number} delaySec 0 for the undelayed path
 * @param {number} cornerHz
 * @param {string} eqProcess
 * @returns {string}
 */
function chain(lowpass, delaySec, cornerHz, eqProcess) {
  /** @type {string[]} */
  const stages = [];
  if (lowpass) stages.push(`iir:type=lp1;f=${fmtArg(cornerHz, 1)}`);
  if (delaySec) stages.push(`delay:t=${delaySec.toFixed(9)}`);
  if (eqProcess) stages.push(eqProcess);
  return stages.join(",");
}

/**
 * The eight coefficients feeding one output ear, in row order: for each source
 * (same-side then opposite), the four {flat, lp1} × {dry, delayed} terms.
 * @param {number} lambda
 * @param {number} alphaNear
 * @param {number} alphaFar
 * @returns {EarCoefficient[]}
 */
export function earCoefficients(lambda, alphaNear, alphaFar) {
  const same = (lambda + 1) / 4;
  const cross = (lambda - 1) / 4;
  const dc = (1 - lambda) / 2;
  return [
    { lowpass: false, delayed: false, gain: same * alphaNear + dc },
    { lowpass: true, delayed: false, gain: same * (1 - alphaNear) },
    { lowpass: false, delayed: true, gain: cross * alphaFar },
    { lowpass: true, delayed: true, gain: cross * (1 - alphaFar) },
    { lowpass: false, delayed: false, gain: cross * alphaNear + dc, opposite: true },
    { lowpass: true, delayed: false, gain: cross * (1 - alphaNear), opposite: true },
    { lowpass: false, delayed: true, gain: same * alphaFar, opposite: true },
    { lowpass: true, delayed: true, gain: same * (1 - alphaFar), opposite: true },
  ];
}

// eqProcess and preampDb are PER EAR. A measured headphone correction is often
// asymmetric — the two drivers are not identical and the two ears are not either
// — and refusing those profiles would exclude exactly the listeners most likely
// to want an accurate crossfeed. Pass a string/number for both ears, or
// {left, right} to differ. EQ distributes over each output ear independently, so
// this costs nothing structurally: the rows feeding an ear all carry that ear's
// chain, and its preamp folds into that ear's gains.
/**
 * @template T
 * @param {T | { left?: T, right?: T } | null | undefined} v
 * @param {T} dflt
 * @returns {[T, T]}
 */
const perEar = (v, dflt) => {
  if (v === undefined || v === null) return [dflt, dflt];
  if (typeof v === "object") {
    const pair = /** @type {{ left?: T, right?: T }} */ (v);
    return [pair.left ?? dflt, pair.right ?? dflt];
  }
  return [v, v];
};

/**
 * Compile the block for a stereo pair, `srcA`/`srcB` being wire channel indexes.
 * Always emits 16 rows — four fall to zero at λ=1, and a fixed count keeps
 * structural recognition simple.
 * @param {{ lambda?: number, angle?: number, headRadius?: number, srcA?: string|number, srcB?: string|number,
 *   preampDb?: number|{left: number, right: number},
 *   eqProcess?: string|{left: string, right: string} }} [params]
 * Per-ear values are accepted wherever `perEar` is used: the two ears may carry
 * different corrections, and a block recognized from live rows hands them back
 * that way.
 * @returns {PipelineRow[]}
 */
export function compileRows({
  lambda = 1,
  angle = SPEAKER_ANGLE,
  headRadius = HEAD_RADIUS,
  srcA = 0,
  srcB = 1,
  preampDb = 0,
  eqProcess = "",
} = {}) {
  const p = pathParams(angle, headRadius);
  const eqs = perEar(eqProcess, "");
  const preamps = perEar(preampDb, 0);
  /** @type {PipelineRow[]} */
  const rows = [];
  const ears = [
    [srcA, srcA, srcB],
    [srcB, srcB, srcA],
  ];
  ears.forEach(([out, near, far], e) => {
    const k = 10 ** (preamps[e] / 20);
    for (const c of earCoefficients(lambda, p.alphaNear, p.alphaFar)) {
      rows.push({
        gain: (c.gain * k).toFixed(9),
        gainunit: "Lin",
        mixdown: String(out),
        process: chain(c.lowpass, c.delayed ? p.itd : 0, p.cornerHz, eqs[e]),
        source: String(c.opposite ? far : near),
      });
    }
  });
  return rows;
}
