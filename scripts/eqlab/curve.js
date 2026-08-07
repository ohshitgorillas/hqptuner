// The measurement grid, the summed response sampled on it, and the curve
// algebra every reduction is built from.
//
// Every curve here comes out of `chainMagDbGrid` (lib/dsp/chain.js), the same
// math the UI plots minus phase. Nothing is ever measured band by band: a
// response is the whole chain summed.

import { chainMagDbGrid, chainResponse } from "../../hqptuner/static/lib/dsp/chain.js";

/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").MatrixStage} MatrixStage */
/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").StageArgs} StageArgs */

/**
 * A sampled response: the grid, and the summed magnitude on it.
 *
 * The minimum any range reduction needs. `residualFit` builds one of exactly
 * this shape — a difference of two curves, with no sample rate of its own —
 * which is why the reducers below take `CurveLike` rather than `Curve`.
 *
 * `db` admits both spellings because the two producers honestly differ: the DSP
 * grid answers with a `Float64Array`, while a target curve (target.js) is built
 * by interpolation and transforms in plain arrays. Every reducer here only
 * indexes it and reads `.length`, which both support identically.
 *
 * @typedef {{ freqs: number[], db: Float64Array | number[] }} CurveLike
 */

/**
 * A full curve: a `CurveLike` that knows its sample rate, and whether any stage
 * in the chain went unmodelled (`partial`).
 *
 * @typedef {{ freqs: number[], db: Float64Array, fs: number, partial: boolean }} Curve
 */

export const F_LO = 20;
export const F_HI = 20000;
export const GRID_N = 4096;

/**
 * @param {number} n
 * @param {number} f0
 * @param {number} f1
 * @returns {number[]}
 */
function logGrid(n, f0, f1) {
  const k = Math.log(f1 / f0) / (n - 1);
  return Array.from({ length: n }, (_, i) => f0 * Math.exp(k * i));
}

const GRID = logGrid(GRID_N, F_LO, F_HI);

/**
 * Summed response of a stage list over the standard 20 Hz - 20 kHz log grid.
 *
 * @param {MatrixStage[]} stages
 * @param {number} fs
 * @returns {Curve}
 */
export function curveOf(stages, fs) {
  const { db, partial } = chainMagDbGrid(stages, GRID, fs);
  return { freqs: GRID, db, fs, partial };
}

/**
 * Point-wise sum of two curves over the shared grid. dB responses of stages in
 * series add, so a search can hold the unchanged part of a chain fixed and
 * recompute only the stages a candidate actually varies.
 *
 * @param {Curve} a
 * @param {Curve} b
 * @returns {Curve}
 */
export function sumCurves(a, b) {
  const db = new Float64Array(a.db.length);
  for (let i = 0; i < db.length; i += 1) db[i] = a.db[i] + b.db[i];
  return { freqs: a.freqs, db, fs: a.fs, partial: a.partial || b.partial };
}

/**
 * Round for output — raw doubles print 17 digits of noise nobody can act on.
 *
 * Passes a missing value straight through rather than rounding it to zero: a
 * metric that did not apply and a metric that came out at 0.0 are different
 * answers, and the job's JSON keeps them different.
 *
 * Overloaded so the common case does not have to prove itself: rounding a
 * number yields a number, and only a caller that might pass null gets the
 * nullable answer back. Without this every arithmetic call site needs a cast to
 * discharge a null that the argument type already ruled out.
 *
 * @overload
 * @param {number} x
 * @param {number} [dp]
 * @returns {number}
 *
 * @overload
 * @param {number | null | undefined} x
 * @param {number} [dp]
 * @returns {number | null}
 *
 * @param {number | null | undefined} x
 * @param {number} [dp]
 * @returns {number | null}
 */
export const round = (x, dp = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** dp) / 10 ** dp);

/**
 * Preamp per PRIMER guardrails: negative of the max of the SUMMED response.
 *
 * @param {CurveLike} curve
 * @returns {number}
 */
export function preampDb(curve) {
  let max = -Infinity;
  for (let i = 0; i < curve.db.length; i += 1) if (curve.db[i] > max) max = curve.db[i];
  return -max;
}

// The 20 Hz-bounded grid misses a low shelf whose plateau keeps rising below
// the grid floor; this samples 1-20 Hz and folds the sub-bass maximum in.
const SUB_GRID = logGrid(256, 1, F_LO);

/**
 * Preamp including the sub-20 Hz shelf asymptote: max over 1 Hz - 20 kHz.
 *
 * @param {MatrixStage[]} stages
 * @param {number} fs
 * @param {number} preamp
 * @returns {number}
 */
export function preampDbFull(stages, fs, preamp) {
  const subMax = Math.max(...SUB_GRID.map((f) => chainResponse(stages, f, fs).db));
  return Math.min(preamp, -subMax);
}

/**
 * Response at an arbitrary frequency, linearly interpolated in log f.
 *
 * @param {CurveLike} curve
 * @param {number} f
 * @returns {number}
 */
export function valueAt(curve, f) {
  const { freqs, db } = curve;
  if (f <= freqs[0]) return db[0];
  if (f >= freqs[freqs.length - 1]) return db[db.length - 1];
  const k = Math.log(freqs[1] / freqs[0]);
  const x = Math.log(f / freqs[0]) / k;
  const i = Math.floor(x);
  return db[i] + (db[i + 1] - db[i]) * (x - i);
}

/**
 * Least-squares line over [x, y] pairs -> { slope, icept }.
 *
 * @param {[number, number][]} pts
 * @returns {{ slope: number, icept: number }}
 */
export function linfit(pts) {
  const n = pts.length;
  const [sx, sy] = [pts.reduce((s, p) => s + p[0], 0), pts.reduce((s, p) => s + p[1], 0)];
  const [sxx, sxy] = [pts.reduce((s, p) => s + p[0] * p[0], 0), pts.reduce((s, p) => s + p[0] * p[1], 0)];
  const d = n * sxx - sx * sx;
  const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;
  return { slope, icept: (sy - slope * sx) / n };
}

// Quadratic refinement in (log f, dB) — the grid is 4096 points over three
// decades, so the true peak sits between samples and the naive grid maximum
// under-reports both its height and its frequency.
/**
 * @param {CurveLike} curve
 * @param {number} i
 * @returns {{ hz: number, db: number }}
 */
function refine(curve, i) {
  const [y0, y1, y2] = [curve.db[i - 1], curve.db[i], curve.db[i + 1]];
  const denom = y0 - 2 * y1 + y2;
  const d = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom;
  const k = Math.log(curve.freqs[1] / curve.freqs[0]);
  return { hz: curve.freqs[i] * Math.exp(k * d), db: y1 - 0.25 * (y0 - y2) * d };
}

/**
 * Local maxima and minima of the summed curve, refined off-grid.
 *
 * @param {CurveLike} curve
 * @returns {{ kind: string, hz: number, db: number }[]}
 */
export function extrema(curve) {
  const last = curve.db.length - 1;
  // Band edges are reported as `edge`: a shelf's plateau is the chain's
  // maximum without ever being a local maximum, and it is usually what sets
  // the preamp. Omitting it makes the extrema list contradict `preamp_db`.
  const out = [{ kind: "edge", hz: curve.freqs[0], db: curve.db[0] }];
  for (let i = 1; i < curve.db.length - 1; i += 1) {
    const [prev, here, next] = [curve.db[i - 1], curve.db[i], curve.db[i + 1]];
    const isMax = here > prev && here >= next;
    const isMin = here < prev && here <= next;
    if (isMax || isMin) out.push({ kind: isMax ? "max" : "min", ...refine(curve, i) });
  }
  out.push({ kind: "edge", hz: curve.freqs[last], db: curve.db[last] });
  return out;
}
