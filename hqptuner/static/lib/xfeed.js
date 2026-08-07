// Bauer-crossfeed M/S compensation math (crossfeed-comp spec). Model verified
// against libbs2b source (MIT, Boris Mikhaylov); HQPlayer's bauer matches its
// preset trio and parameter ranges exactly (spec: flagged inference). All
// analog-prototype math — rate-independent, matching the daemon's parametrics.
//
// The 2x2 crossfeed is symmetric, so it diagonalizes in M/S:
//   R_M = norm*(H_hi + H_lo)  — center path, LF exactly 0 dB, HF tilted down
//   R_S = norm*(H_hi - H_lo)  — side path (LF width narrowing, left untouched)
// Compensation C = (1/R_M)^s is realized as two cascaded RBJ high-shelves
// fitted numerically (reference-validated: fit <=0.031 dB at s=100%, linear
// gain scaling <=0.046 dB over s=25..150%).
//
// The tilt is not an artifact of bs2b: Brown & Duda's structural head model at
// +/-30 deg speaker azimuth gives a centre tilt of 1.80 dB, and bs2b's default
// preset computes to 1.81 dB here. So compensation trades a loudspeaker-accurate
// centre for a neutral one -- a tonal choice, not a bug fix. Independent of any
// headphone EQ, which rides through untouched. See docs/crossfeed-math.md.

import { fmtArg, withoutEq } from "./matrixspec.js";

/**
 * @typedef {import("./matrixspec.js").PipelineRow} PipelineRow
 * @typedef {{ f: number, g: number, q: number }} Shelf
 *   One fitted high-shelf: corner, gain in dB, RBJ Q.
 * @typedef {{ stages: Shelf[], errDb: number }} CompFit
 *   A coordinate-descent fit of the compensation, with its worst-case error.
 * @typedef {{ eqProcess: string, preampDb: number, sFraction: number, stale: boolean }} MsRecognition
 *   What msRecognize reads back out of eight compiled rows.
 */

export const BAUER_PRESETS = {
  default: { fc: 700, feed: 4.5 },
  cmoy: { fc: 700, feed: 6.0 },
  jmeier: { fc: 650, feed: 9.5 },
};

/**
 * @param {number} fc cross-over frequency
 * @param {number} feed feed level in dB
 * @returns {{ gLo: number, gHi: number, fcHi: number, norm: number }}
 */
function bauerParams(fc, feed) {
  const gbLo = (-5 * feed) / 6 - 3;
  const gbHi = feed / 6 - 3;
  const gLo = 10 ** (gbLo / 20);
  const gHi = 1 - 10 ** (gbHi / 20);
  const fcHi = fc * 2 ** ((gbLo - 20 * Math.log10(gHi)) / 12);
  const norm = 1 / (1 - gHi + gLo);
  return { gLo, gHi, fcHi, norm };
}

// Complex response of the M and S paths at frequency f (analog prototype).
/**
 * @param {number} fc
 * @param {number} feed
 * @param {number} f
 * @returns {{ m: [number, number], s: [number, number] }}
 */
function msResponse(fc, feed, f) {
  const { gLo, gHi, fcHi, norm } = bauerParams(fc, feed);
  // H_lo = gLo/(1 + j f/fc); H_hi = ((1-gHi) + j f/fcHi)/(1 + j f/fcHi)
  const div = (
    /** @type {number} */ nr,
    /** @type {number} */ ni,
    /** @type {number} */ dr,
    /** @type {number} */ di,
  ) => {
    const d = dr * dr + di * di;
    return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
  };
  const [lor, loi] = div(gLo, 0, 1, f / fc);
  const [hir, hii] = div(1 - gHi, f / fcHi, 1, f / fcHi);
  return {
    m: [norm * (hir + lor), norm * (hii + loi)],
    s: [norm * (hir - lor), norm * (hii - loi)],
  };
}

/** @param {[number, number]} c a complex response as [real, imaginary] */
const magDb = ([re, im]) => 10 * Math.log10(re * re + im * im);

/**
 * Per-ear magnitude (dB) of a centered source through the crossfeed.
 * @param {number} fc
 * @param {number} feed
 * @param {number} f
 * @returns {number}
 */
export function centerMagDb(fc, feed, f) {
  return magDb(msResponse(fc, feed, f).m);
}

/**
 * Magnitude (dB) of the side (L-R) component through the crossfeed.
 * @param {number} fc
 * @param {number} feed
 * @param {number} f
 * @returns {number}
 */
export function sideMagDb(fc, feed, f) {
  return magDb(msResponse(fc, feed, f).s);
}

/**
 * The center tilt the compensation removes: HF loss relative to LF (positive dB).
 * @param {number} fc
 * @param {number} feed
 * @returns {number}
 */
export function centerTiltDb(fc, feed) {
  return 20 * Math.log10(1 / bauerParams(fc, feed).norm);
}

// RBJ cookbook high shelf, analog prototype (matches dsp.js coefficients).
/**
 * @param {number} f0
 * @param {number} gainDb
 * @param {number} q
 * @param {number} f
 * @returns {number}
 */
function hshelfMagDb(f0, gainDb, q, f) {
  const a = 10 ** (gainDb / 40);
  const w = f / f0;
  const s2 = -(w * w);
  const k = Math.sqrt(a) / q;
  /** @type {[number, number]} */
  const num2 = [a * (a * s2 + 1), a * k * w];
  /** @type {[number, number]} */
  const den2 = [s2 + a, k * w];
  return magDb(num2) - magDb(den2);
}

const FIT_N = 200;
const FIT_FREQS = Array.from({ length: FIT_N }, (_, i) => 20 * 1000 ** (i / (FIT_N - 1)));

// One sweep of every coordinate in both directions at the current step sizes.
// Frequency and gain coordinates must stay above 1, Q coordinates above 0.05.
/**
 * @param {number[]} p the current coordinate vector
 * @param {number[]} steps per-coordinate step sizes
 * @param {(p: number[]) => number} err
 * @param {number} best the error at `p`
 * @returns {{ p: number[], best: number, improved: boolean }}
 */
function sweepCoords(p, steps, err, best) {
  let cur = p;
  let bestErr = best;
  let improved = false;
  for (let i = 0; i < steps.length; i += 1) {
    for (const sign of [1, -1]) {
      const trial = cur.slice();
      trial[i] += sign * steps[i];
      if (trial[i] <= (i % 3 === 2 ? 0.05 : 1)) continue;
      const e = err(trial);
      if (e < bestErr) {
        bestErr = e;
        cur = trial;
        improved = true;
      }
    }
  }
  return { p: cur, best: bestErr, improved };
}

// Coordinate descent: halve the step sizes whenever a full sweep finds no
// improvement, and stop once every step is below the resolution floor.
/**
 * @param {number[]} seed
 * @param {number[]} seedSteps
 * @param {(p: number[]) => number} err
 * @returns {{ p: number[], best: number }}
 */
function descend(seed, seedSteps, err) {
  let p = seed;
  let steps = seedSteps;
  let best = err(p);
  for (let round = 0; round < 600; round += 1) {
    const swept = sweepCoords(p, steps, err, best);
    p = swept.p;
    best = swept.best;
    if (!swept.improved) {
      steps = steps.map((s) => s / 2);
      if (Math.max(...steps) < 1e-5) break;
    }
  }
  return { p, best };
}

/** @type {Map<string, CompFit>} */
const fitCache = new Map();
/**
 * Coordinate-descent fit of two cascaded high-shelves to the exact inverse of the
 * centre response, from the reference-validated analytic seed. One fit per
 * (fc, feed); cached.
 * @param {number} fc
 * @param {number} feed
 * @returns {CompFit}
 */
export function fitComp(fc, feed) {
  const key = `${fc}/${feed}`;
  const hit = fitCache.get(key);
  if (hit) return hit;
  const { fcHi } = bauerParams(fc, feed);
  const total = centerTiltDb(fc, feed);
  const target = FIT_FREQS.map((f) => -centerMagDb(fc, feed, f));
  const err = (/** @type {number[]} */ p) => {
    let worst = 0;
    for (let i = 0; i < FIT_N; i += 1) {
      const got = hshelfMagDb(p[0], p[1], p[2], FIT_FREQS[i]) + hshelfMagDb(p[3], p[4], p[5], FIT_FREQS[i]);
      const e = Math.abs(got - target[i]);
      if (e > worst) worst = e;
    }
    return worst;
  };
  const seed = [0.54 * fc, total / 2, 0.58, 0.8 * fcHi, total / 2, 0.66];
  const { p, best } = descend(seed, [30, 0.08, 0.03, 30, 0.08, 0.03], err);
  const fit = {
    stages: [
      { f: p[0], g: p[1], q: p[2] },
      { f: p[3], g: p[4], q: p[5] },
    ],
    errDb: best,
  };
  fitCache.set(key, fit);
  return fit;
}

/**
 * The comp chain as process-spec text at slider fraction s (1 = 100%), in
 * matrixspec buildRaw arg order — round-trips byte-exact through parseProcess.
 * @param {CompFit} fit
 * @param {number} s slider fraction, 1 = 100%
 * @returns {string}
 */
export function compProcess(fit, s) {
  return fit.stages
    .map((st) => `iir:type=hshelf;f=${fmtArg(st.f, 1)};q=${fmtArg(st.q, 3)};g=${fmtArg(st.g * s, 2)}`)
    .join(",");
}

// --- M/S pipeline block (spec wire shape) ------------------------------------

/**
 * Compile the compensated block for a stereo pair: 8 canonical rows.
 * @param {string} eqProcess the shared per-channel EQ chain
 * @param {number} preampDb row gain the EQ pair carried, folded into the Lin gains
 * @param {{ fit: CompFit, s: number }} comp
 * @param {{ a: number, b: number }} pair wire channel indexes
 * @returns {PipelineRow[]}
 */
export function msCompile(eqProcess, preampDb, { fit, s }, { a: srcA, b: srcB }) {
  const k = 0.5 * 10 ** (preampDb / 20);
  const gp = k.toFixed(6);
  const gm = (-k).toFixed(6);
  const comp = eqProcess ? `${eqProcess},${compProcess(fit, s)}` : compProcess(fit, s);
  const row = (
    /** @type {number} */ source,
    /** @type {string} */ process,
    /** @type {string} */ gain,
    /** @type {number} */ mixdown,
  ) => ({
    gain,
    gainunit: "Lin",
    mixdown: String(mixdown),
    process,
    source: String(source),
  });
  return [
    row(srcA, comp, gp, srcA),
    row(srcB, comp, gp, srcA),
    row(srcA, eqProcess, gp, srcA),
    row(srcB, eqProcess, gm, srcA),
    row(srcA, comp, gp, srcB),
    row(srcB, comp, gp, srcB),
    row(srcA, eqProcess, gm, srcB),
    row(srcB, eqProcess, gp, srcB),
  ];
}

// Switching to the structural crossfeed has to come through here first: the
// block's rows are Lin, and the structural compiler builds from a dB pair, so
// without this the mode toggle just refuses.
/**
 * The plain stereo EQ pair a compensation block was built from, with the rest of
 * the row list intact.
 * @param {PipelineRow[]} rows the whole row list
 * @param {MsRecognition} rec
 * @returns {PipelineRow[]}
 */
export function uncompensatedRows(rows, rec) {
  const g = String(Math.round(rec.preampDb * 100) / 100);
  return [
    { gain: g, gainunit: "dB", mixdown: "0", process: rec.eqProcess, source: "0" },
    { gain: g, gainunit: "dB", mixdown: "1", process: rec.eqProcess, source: "1" },
    ...rows.slice(8),
  ];
}

// The block holds its EQ once, shared by all eight rows, and its gains are Lin
// with the preamp folded in. Appending to a single row the way a plain pipeline
// import does breaks both invariants at once: recognition dies on the first
// gainunit check, and the touched rows end up carrying the EQ twice at a gain
// meant for a dB row. Rows 1+2 are the left ear's centre path, so the damage is
// a one-channel mid/side imbalance — silent, since the badge simply disappears.
//
// `addition` is the serialized new stages, `preamp` the profile's Preamp line as
// a string (or null to keep the block's own). `replace` drops the block's existing
// EQ first — what loading a headphone profile from the library means, since two
// stacked profiles are never what anyone wants. The crossfeed's own stages are
// untouched either way: they are not part of eqProcess, msCompile re-adds them.
/**
 * Route an EQ import INTO a recognized block instead of onto its individual rows:
 * recompile all eight rows around the new shared EQ chain.
 * @param {PipelineRow[]} rows
 * @param {MsRecognition} rec
 * @param {CompFit} fit
 * @param {{ addition: string, preamp: string | null, replace?: boolean }} imported
 * @returns {PipelineRow[]}
 */
export function applyEqToBlock(rows, rec, fit, { addition, preamp, replace = false }) {
  const base = replace ? withoutEq(rec.eqProcess) : rec.eqProcess;
  const eqProcess = base ? `${base},${addition}` : addition;
  const preampDb = preamp !== null && preamp !== undefined ? Number(preamp) : rec.preampDb;
  return [...msCompile(eqProcess, preampDb, { fit, s: rec.sFraction }, { a: 0, b: 1 }), ...rows.slice(8)];
}

// Same contract as binaural.js's usableRow, deliberately duplicated: that module
// has no imports at all and this one imports only matrixspec, and a shared
// one-line predicate is not worth coupling them. Rows reaching a recognizer are
// whatever was last hand-edited, so a malformed one must DECLINE the block
// (dropping the badge) rather than throw out of the render path it runs in.
const usableRow = (/** @type {PipelineRow} */ r) =>
  !!r && r.gainunit === "Lin" && (r.process == null || typeof r.process === "string");

// Recognition stages, private for the same reason as binaural.js's: the
// contract is msRecognize's return value, and tests/js/xfeed.test.js reaches
// all of them through it.

// The block is one magnitude carried with a sign pattern, so every row must
// share it. Returns that magnitude, or null if any row disagrees by more than
// wire rounding.
/**
 * @param {PipelineRow[]} b the eight candidate rows
 * @returns {number | null}
 */
function blockGain(b) {
  const k = Math.abs(Number(b[0].gain));
  if (Number.isNaN(k) || k <= 0) return null;
  return b.some((r) => Math.abs(Math.abs(Number(r.gain)) - k) > 1e-6) ? null : k;
}

// The source / mixdown / sign signature of the eight rows, for a channel pair.
/**
 * @param {PipelineRow[]} b
 * @param {string} srcA
 * @param {string} srcB
 * @returns {boolean}
 */
function routingMatches(b, srcA, srcB) {
  const pat = [
    [srcA, srcA, 1],
    [srcB, srcA, 1],
    [srcA, srcA, 1],
    [srcB, srcA, -1],
    [srcA, srcB, 1],
    [srcB, srcB, 1],
    [srcA, srcB, -1],
    [srcB, srcB, 1],
  ];
  return b.every(
    (r, i) => r.source === pat[i][0] && r.mixdown === pat[i][1] && Math.sign(Number(r.gain)) === pat[i][2],
  );
}

// The two chains the block carries: the EQ tail (rows 2,3,6,7) and the full
// compensated chain (rows 0,1,4,5), each internally identical.
//
// A missing chain reads as the empty one. usableRow admits `process == null`
// (a bare flat row is legal), so reading it raw would leave compFull undefined
// and the startsWith below would throw — the crash this normalization prevents.
/**
 * @param {PipelineRow[]} b
 * @returns {{ eqProcess: string, compFull: string } | null}
 */
function blockChains(b) {
  const chainOf = (/** @type {PipelineRow} */ r) => r.process ?? "";
  const eqProcess = chainOf(b[2]);
  if (chainOf(b[3]) !== eqProcess || chainOf(b[6]) !== eqProcess || chainOf(b[7]) !== eqProcess) return null;
  const compFull = chainOf(b[0]);
  if (chainOf(b[1]) !== compFull || chainOf(b[4]) !== compFull || chainOf(b[5]) !== compFull) return null;
  return { eqProcess, compFull };
}

// Anchored: any extra stage in the tail means these are not our two shelves.
const COMP_RE =
  /^iir:type=hshelf;f=([\d.]+);q=([\d.]+);g=(-?[\d.]+),iir:type=hshelf;f=([\d.]+);q=([\d.]+);g=(-?[\d.]+)$/;

// The compensation shelves sitting after the EQ, if the tail is exactly ours.
/**
 * @param {string} compFull
 * @param {string} eqProcess
 * @returns {Shelf[] | null}
 */
function compShelves(compFull, eqProcess) {
  let suffix = compFull;
  if (eqProcess) {
    if (!compFull.startsWith(`${eqProcess},`)) return null;
    suffix = compFull.slice(eqProcess.length + 1);
  }
  if (!suffix) return null;
  const m = suffix.match(COMP_RE);
  if (!m) return null;
  return [
    { f: +m[1], q: +m[2], g: +m[3] },
    { f: +m[4], q: +m[5], g: +m[6] },
  ];
}

/**
 * Recognize a compiled block at rows[at..at+7]. Purely structural — returns
 * {eqProcess, preampDb, sFraction, stale} or null. `stale` is true when the comp
 * stages' f/q don't match a fresh fit for the CURRENT bauer settings, and
 * sFraction is then relative to the stored gains' own 100% and only indicative.
 * @param {PipelineRow[]} rows
 * @param {number} at first row of the candidate block
 * @param {number} fc current bauer cross-over frequency
 * @param {number} feed current bauer feed level
 * @returns {MsRecognition | null}
 */
export function msRecognize(rows, at, fc, feed) {
  const b = rows.slice(at, at + 8);
  if (b.length < 8 || !b.every(usableRow)) return null;
  const k = blockGain(b);
  if (k === null) return null;

  const srcA = b[0].source;
  const srcB = b[1].source;
  // Both halves feeding off one channel is degenerate — there is no stereo pair
  // to cross-feed. The structural recognizer already refuses its equivalent;
  // this one accepted it, which is the asymmetry rather than a second opinion.
  if (srcA === srcB || !routingMatches(b, srcA, srcB)) return null;

  const chains = blockChains(b);
  if (!chains) return null;
  const got = compShelves(chains.compFull, chains.eqProcess);
  if (!got) return null;

  const fit = fitComp(fc, feed);
  const near = (/** @type {number} */ a, /** @type {number} */ x, /** @type {number} */ tol) => Math.abs(a - x) <= tol;
  const stale = !fit.stages.every((st, i) => near(got[i].f, st.f, 0.5) && near(got[i].q, st.q, 0.005));
  const sExact = fit.stages[0].g + fit.stages[1].g;
  return {
    eqProcess: chains.eqProcess,
    preampDb: 20 * Math.log10(k / 0.5),
    // fraction of the exact 100% compensation, snapped to the slider's 1% grid
    // (wire gains are 2-dp quantized); meaningless when the block was generated
    // under different bauer settings, so pinned to 1 then
    sFraction: stale ? 1 : Math.round(((got[0].g + got[1].g) / sExact) * 100) / 100,
    stale,
  };
}
