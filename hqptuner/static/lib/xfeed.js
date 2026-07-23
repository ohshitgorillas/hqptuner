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

export const BAUER_PRESETS = {
  default: { fc: 700, feed: 4.5 },
  cmoy: { fc: 700, feed: 6.0 },
  jmeier: { fc: 650, feed: 9.5 },
};

export function bauerParams(fc, feed) {
  const gbLo = (-5 * feed) / 6 - 3;
  const gbHi = feed / 6 - 3;
  const gLo = 10 ** (gbLo / 20);
  const gHi = 1 - 10 ** (gbHi / 20);
  const fcHi = fc * 2 ** ((gbLo - 20 * Math.log10(gHi)) / 12);
  const norm = 1 / (1 - gHi + gLo);
  return { gLo, gHi, fcHi, norm };
}

// Complex response of the M and S paths at frequency f (analog prototype).
function msResponse(fc, feed, f) {
  const { gLo, gHi, fcHi, norm } = bauerParams(fc, feed);
  // H_lo = gLo/(1 + j f/fc); H_hi = ((1-gHi) + j f/fcHi)/(1 + j f/fcHi)
  const div = (nr, ni, dr, di) => {
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

const magDb = ([re, im]) => 10 * Math.log10(re * re + im * im);

// Per-ear magnitude (dB) of a centered source through the crossfeed.
export function centerMagDb(fc, feed, f) {
  return magDb(msResponse(fc, feed, f).m);
}

// Magnitude (dB) of the side (L-R) component through the crossfeed.
export function sideMagDb(fc, feed, f) {
  return magDb(msResponse(fc, feed, f).s);
}

// The center tilt the compensation removes: HF loss relative to LF (positive dB).
export function centerTiltDb(fc, feed) {
  return 20 * Math.log10(1 / bauerParams(fc, feed).norm);
}

// RBJ cookbook high shelf, analog prototype (matches dsp.js coefficients).
function hshelfMagDb(f0, gainDb, q, f) {
  const a = 10 ** (gainDb / 40);
  const w = f / f0;
  const s2 = -(w * w);
  const k = Math.sqrt(a) / q;
  const num2 = [a * (a * s2 + 1), a * k * w];
  const den2 = [s2 + a, k * w];
  return magDb(num2) - magDb(den2);
}

const FIT_N = 200;
const FIT_FREQS = Array.from({ length: FIT_N }, (_, i) => 20 * 1000 ** (i / (FIT_N - 1)));

// Coordinate-descent fit of two cascaded high-shelves to the exact inverse,
// from the reference-validated analytic seed. One fit per (fc, feed); cached.
const fitCache = new Map();
export function fitComp(fc, feed) {
  const key = `${fc}/${feed}`;
  const hit = fitCache.get(key);
  if (hit) return hit;
  const { fcHi } = bauerParams(fc, feed);
  const total = centerTiltDb(fc, feed);
  const target = FIT_FREQS.map((f) => -centerMagDb(fc, feed, f));
  const err = (p) => {
    let worst = 0;
    for (let i = 0; i < FIT_N; i += 1) {
      const got = hshelfMagDb(p[0], p[1], p[2], FIT_FREQS[i]) + hshelfMagDb(p[3], p[4], p[5], FIT_FREQS[i]);
      const e = Math.abs(got - target[i]);
      if (e > worst) worst = e;
    }
    return worst;
  };
  let p = [0.54 * fc, total / 2, 0.58, 0.8 * fcHi, total / 2, 0.66];
  let steps = [30, 0.08, 0.03, 30, 0.08, 0.03];
  let best = err(p);
  for (let round = 0; round < 600; round += 1) {
    let improved = false;
    for (let i = 0; i < 6; i += 1) {
      for (const sign of [1, -1]) {
        const trial = p.slice();
        trial[i] += sign * steps[i];
        if (trial[i] <= (i % 3 === 2 ? 0.05 : 1)) continue;
        const e = err(trial);
        if (e < best) {
          best = e;
          p = trial;
          improved = true;
        }
      }
    }
    if (!improved) {
      steps = steps.map((s) => s / 2);
      if (Math.max(...steps) < 1e-5) break;
    }
  }
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

const fmt = (x, dp) => String(Math.round(x * 10 ** dp) / 10 ** dp);

// The comp chain as process-spec text at slider fraction s (1 = 100%), in
// matrixspec buildRaw arg order — round-trips byte-exact through parseProcess.
export function compProcess(fit, s) {
  return fit.stages
    .map((st) => `iir:type=hshelf;f=${fmt(st.f, 1)};q=${fmt(st.q, 3)};g=${fmt(st.g * s, 2)}`)
    .join(",");
}

// --- M/S pipeline block (spec wire shape) ------------------------------------

// Compile the compensated block for a stereo pair: 8 canonical rows.
// eqProcess: the shared per-channel EQ chain; preampDb: row gain the EQ pair
// carried (folded into the Lin gains); srcA/srcB: wire channel indexes.
export function msCompile(eqProcess, preampDb, fit, s, srcA, srcB) {
  const k = 0.5 * 10 ** (preampDb / 20);
  const gp = k.toFixed(6);
  const gm = (-k).toFixed(6);
  const comp = eqProcess ? `${eqProcess},${compProcess(fit, s)}` : compProcess(fit, s);
  const row = (source, process, gain, mixdown) => ({
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

// Route an EQ import INTO a recognized block instead of onto its individual rows.
//
// The block holds its EQ once, shared by all eight rows, and its gains are Lin
// with the preamp folded in. Appending to a single row the way a plain pipeline
// import does breaks both invariants at once: recognition dies on the first
// gainunit check, and the touched rows end up carrying the EQ twice at a gain
// meant for a dB row. Rows 1+2 are the left ear's centre path, so the damage is
// a one-channel mid/side imbalance — silent, since the badge simply disappears.
//
// `addition` is the serialized new stages, `preamp` the profile's Preamp line as
// a string (or null to keep the block's own). Returns the replacement rows.
export function applyEqToBlock(rows, rec, fit, addition, preamp) {
  const eqProcess = rec.eqProcess ? `${rec.eqProcess},${addition}` : addition;
  const preampDb = preamp !== null && preamp !== undefined ? Number(preamp) : rec.preampDb;
  return [...msCompile(eqProcess, preampDb, fit, rec.sFraction, 0, 1), ...rows.slice(8)];
}

// Recognize a compiled block at rows[at..at+7]. Purely structural — returns
// {eqProcess, preampDb, sFraction, stale} or null. `stale` is true when the
// comp stages' f/q don't match a fresh fit for the CURRENT bauer settings
// (bauer changed since the block was generated) — sFraction is then relative
// to the stored gains' own 100% and only indicative.
export function msRecognize(rows, at, fc, feed) {
  const b = rows.slice(at, at + 8);
  if (b.length < 8) return null;
  if (b.some((r) => r.gainunit !== "Lin")) return null;
  const k = Math.abs(Number(b[0].gain));
  if (!(k > 0) || b.some((r) => Math.abs(Math.abs(Number(r.gain)) - k) > 1e-6)) return null;
  const srcA = b[0].source;
  const srcB = b[1].source;
  const pat = [
    [srcA, srcA, 1], [srcB, srcA, 1], [srcA, srcA, 1], [srcB, srcA, -1],
    [srcA, srcB, 1], [srcB, srcB, 1], [srcA, srcB, -1], [srcB, srcB, 1],
  ];
  for (let i = 0; i < 8; i += 1) {
    if (b[i].source !== pat[i][0] || b[i].mixdown !== pat[i][1]) return null;
    if (Math.sign(Number(b[i].gain)) !== pat[i][2]) return null;
  }
  const eqProcess = b[2].process;
  if (b[3].process !== eqProcess || b[6].process !== eqProcess || b[7].process !== eqProcess) return null;
  const compFull = b[0].process;
  if (b[1].process !== compFull || b[4].process !== compFull || b[5].process !== compFull) return null;
  const suffix = eqProcess ? (compFull.startsWith(`${eqProcess},`) ? compFull.slice(eqProcess.length + 1) : null) : compFull;
  if (!suffix) return null;
  const m = suffix.match(
    /^iir:type=hshelf;f=([\d.]+);q=([\d.]+);g=(-?[\d.]+),iir:type=hshelf;f=([\d.]+);q=([\d.]+);g=(-?[\d.]+)$/,
  );
  if (!m) return null;
  const got = [
    { f: +m[1], q: +m[2], g: +m[3] },
    { f: +m[4], q: +m[5], g: +m[6] },
  ];
  const fit = fitComp(fc, feed);
  const near = (a, x, tol) => Math.abs(a - x) <= tol;
  const stale = !fit.stages.every(
    (st, i) => near(got[i].f, st.f, 0.5) && near(got[i].q, st.q, 0.005),
  );
  const sExact = fit.stages[0].g + fit.stages[1].g;
  return {
    eqProcess,
    preampDb: 20 * Math.log10(k / 0.5),
    // fraction of the exact 100% compensation, snapped to the slider's 1% grid
    // (wire gains are 2-dp quantized); meaningless when the block was generated
    // under different bauer settings, so pinned to 1 then
    sFraction: stale ? 1 : Math.round(((got[0].g + got[1].g) / sExact) * 100) / 100,
    stale,
  };
}
