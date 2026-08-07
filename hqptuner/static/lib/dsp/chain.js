// --- magnitude-only grid evaluation (eqlab search hot path) ------------------
// Same math as chainResponse minus phase: coefficients built once per stage
// (not per point), grid trig cached per (freqs, fs), no atan2 work. The UI
// plots keep chainResponse; this path exists so a search can score thousands
// of candidate chains per second.
//
// Its own module because that caching is the whole point: the grid trig table is
// module-level mutable state with a lifetime spanning stages, candidates and
// jobs, and it has no business sitting next to the stateless per-point math.

import { TAU, wrapDeg } from "./biquad.js";
import { iirStageCoeffs, riaaResponse, stageResponse, stageArgs, stageFile } from "./stages.js";
import { convResponse, hasIr } from "./impulse.js";

/**
 * @typedef {import("./biquad.js").Biquad} Biquad
 * @typedef {import("./stages.js").Stage} Stage
 * @typedef {{ cw: Float64Array, c2w: Float64Array, sw: Float64Array, s2w: Float64Array }} GridTrig
 *   Per-(grid, fs) trig table for the magnitude-only hot path.
 */

// freqs array -> (fs -> {cw, c2w, sw, s2w}); w depends on both, and the same
// grid array is reused across stages, candidates, and jobs.
const gridTrigCache = new WeakMap();

/**
 * @param {number[]} freqs
 * @param {number} fs
 * @returns {GridTrig}
 */
function gridTrig(freqs, fs) {
  let byFs = gridTrigCache.get(freqs);
  if (!byFs) {
    byFs = new Map();
    gridTrigCache.set(freqs, byFs);
  }
  let t = byFs.get(fs);
  if (t) return t;
  const n = freqs.length;
  t = { cw: new Float64Array(n), c2w: new Float64Array(n), sw: new Float64Array(n), s2w: new Float64Array(n) };
  for (let i = 0; i < n; i += 1) {
    const w = (TAU * freqs[i]) / fs;
    t.cw[i] = Math.cos(w);
    t.c2w[i] = Math.cos(2 * w);
    t.sw[i] = Math.sin(w);
    t.s2w[i] = Math.sin(2 * w);
  }
  byFs.set(fs, t);
  return t;
}

// One biquad's magnitude accumulated across the grid — coefficients built once
// by the caller, trig from the grid cache.
/**
 * @param {Float64Array} db
 * @param {Biquad} c
 * @param {GridTrig} t
 * @returns {void}
 */
function addBiquadGridDb(db, c, t) {
  for (let i = 0; i < db.length; i += 1) {
    const numRe = c.b0 + c.b1 * t.cw[i] + c.b2 * t.c2w[i];
    const numIm = -(c.b1 * t.sw[i] + c.b2 * t.s2w[i]);
    const denRe = 1 + c.a1 * t.cw[i] + c.a2 * t.c2w[i];
    const denIm = -(c.a1 * t.sw[i] + c.a2 * t.s2w[i]);
    db[i] += 10 * Math.log10((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
  }
}

// One stage's magnitude accumulated across the grid; false = unplottable
// (mirrors stageResponse's null). Delay is pure phase — plottable, adds 0.
/**
 * @param {Stage} s
 * @param {Float64Array} db
 * @param {{ t: GridTrig, freqs: number[] }} grid
 * @param {number} fs
 * @returns {boolean}
 */
function addStageGridDb(s, db, { t, freqs }, fs) {
  if (s.kind === "iir") {
    const c = iirStageCoeffs(stageArgs(s), fs);
    if (c === null) return false;
    addBiquadGridDb(db, c, t);
    return true;
  }
  if (s.kind === "riaa") {
    const subsonic = stageArgs(s).subsonic !== "0";
    for (let i = 0; i < db.length; i += 1) db[i] += riaaResponse(freqs[i], subsonic).db;
    return true;
  }
  if (s.kind === "conv") {
    const file = stageFile(s);
    if (!hasIr(file)) return false;
    for (let i = 0; i < db.length; i += 1) {
      const r = convResponse(file, freqs[i]);
      if (r) db[i] += r.db;
    }
    return true;
  }
  return s.kind === "delay";
}

/**
 * Whole-chain magnitude in dB at every grid point. Mirrors chainResponse's
 * convention: an unplottable stage (bad args, conv file not registered,
 * unknown kind) contributes nothing and sets `partial`.
 * @param {Stage[]} stages
 * @param {number[]} freqs
 * @param {number} fs
 * @returns {{ db: Float64Array, partial: boolean }}
 */
export function chainMagDbGrid(stages, freqs, fs) {
  const db = new Float64Array(freqs.length);
  const t = gridTrig(freqs, fs);
  let partial = false;
  for (const s of stages) {
    if (!addStageGridDb(s, db, { t, freqs }, fs)) partial = true;
  }
  return { db, partial };
}

/**
 * Whole-chain response: per-stage sum; `partial` when any stage is unplottable.
 * @param {Stage[]} stages
 * @param {number} f
 * @param {number} fs
 * @returns {{ db: number, deg: number, partial: boolean }}
 */
export function chainResponse(stages, f, fs) {
  let db = 0;
  let deg = 0;
  let partial = false;
  for (const s of stages) {
    const r = stageResponse(s, f, fs);
    if (r === null) partial = true;
    else {
      db += r.db;
      deg += r.deg;
    }
  }
  return { db, deg: wrapDeg(deg), partial };
}
