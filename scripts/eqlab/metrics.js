// Response sampling, extrema, and metric evaluation — all on the SUMMED chain.
//
// Every number this file produces comes out of `chainMagDbGrid` (lib/dsp.js),
// the same math the UI plots minus phase. No band is ever measured in isolation:
// a metric over a range is a reduction over the summed curve inside that range.

import { chainMagDbGrid, chainResponse } from "../../hqptuner/static/lib/dsp.js";
import { parse, evaluate } from "./expr.js";
import { noteRange } from "./notes.js";

export const F_LO = 20;
export const F_HI = 20000;
export const GRID_N = 4096;

function logGrid(n, f0, f1) {
  const k = Math.log(f1 / f0) / (n - 1);
  return Array.from({ length: n }, (_, i) => f0 * Math.exp(k * i));
}

const GRID = logGrid(GRID_N, F_LO, F_HI);

/** Summed response of a stage list over the standard 20 Hz - 20 kHz log grid. */
export function curveOf(stages, fs) {
  const { db, partial } = chainMagDbGrid(stages, GRID, fs);
  return { freqs: GRID, db, fs, partial };
}

/**
 * Point-wise sum of two curves over the shared grid. dB responses of stages in
 * series add, so a search can hold the unchanged part of a chain fixed and
 * recompute only the stages a candidate actually varies.
 */
export function sumCurves(a, b) {
  const db = new Float64Array(a.db.length);
  for (let i = 0; i < db.length; i += 1) db[i] = a.db[i] + b.db[i];
  return { freqs: a.freqs, db, fs: a.fs, partial: a.partial || b.partial };
}

/** Round for output — raw doubles print 17 digits of noise nobody can act on. */
export const round = (x, dp = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** dp) / 10 ** dp);

/** Preamp per PRIMER guardrails: negative of the max of the SUMMED response. */
export function preampDb(curve) {
  let max = -Infinity;
  for (let i = 0; i < curve.db.length; i += 1) if (curve.db[i] > max) max = curve.db[i];
  return -max;
}

// The 20 Hz-bounded grid misses a low shelf whose plateau keeps rising below
// the grid floor; this samples 1-20 Hz and folds the sub-bass maximum in.
const SUB_GRID = logGrid(256, 1, F_LO);

/** Preamp including the sub-20 Hz shelf asymptote: max over 1 Hz - 20 kHz. */
export function preampDbFull(stages, fs, preamp) {
  const subMax = Math.max(...SUB_GRID.map((f) => chainResponse(stages, f, fs).db));
  return Math.min(preamp, -subMax);
}

/** Response at an arbitrary frequency, linearly interpolated in log f. */
export function valueAt(curve, f) {
  const { freqs, db } = curve;
  if (f <= freqs[0]) return db[0];
  if (f >= freqs[freqs.length - 1]) return db[db.length - 1];
  const k = Math.log(freqs[1] / freqs[0]);
  const x = Math.log(f / freqs[0]) / k;
  const i = Math.floor(x);
  return db[i] + (db[i + 1] - db[i]) * (x - i);
}

// Closed-form bounds — the grid is uniform in log f, so the first and last
// in-range indices need no scan. The one-step nudges settle float edge cases
// so boundary membership matches the exact `f >= a && f <= b` test.
function rangeIndices(curve, range) {
  const [a, b] = range;
  const { freqs } = curve;
  const n = freqs.length;
  const k = Math.log(freqs[n - 1] / freqs[0]) / (n - 1);
  let lo = Math.max(0, Math.min(n - 1, Math.ceil(Math.log(a / freqs[0]) / k)));
  let hi = Math.max(0, Math.min(n - 1, Math.floor(Math.log(b / freqs[0]) / k)));
  while (lo > 0 && freqs[lo - 1] >= a) lo -= 1;
  while (lo < n && freqs[lo] < a) lo += 1;
  while (hi < n - 1 && freqs[hi + 1] <= b) hi += 1;
  while (hi >= 0 && freqs[hi] > b) hi -= 1;
  if (lo > hi) throw new Error(`metric range [${a}, ${b}] Hz contains no grid point`);
  return { lo, hi };
}

function extremum(curve, range, wantMax) {
  const { lo, hi } = rangeIndices(curve, range);
  let best = lo;
  for (let i = lo; i <= hi; i += 1) {
    if (wantMax ? curve.db[i] > curve.db[best] : curve.db[i] < curve.db[best]) best = i;
  }
  return { value: curve.db[best], hz: curve.freqs[best] };
}

function meanOver(curve, range) {
  const { lo, hi } = rangeIndices(curve, range);
  let sum = 0;
  for (let i = lo; i <= hi; i += 1) sum += curve.db[i];
  return { value: sum / (hi - lo + 1) };
}

/** Least-squares line over [x, y] pairs -> { slope, icept }. */
export function linfit(pts) {
  const n = pts.length;
  const [sx, sy] = [pts.reduce((s, p) => s + p[0], 0), pts.reduce((s, p) => s + p[1], 0)];
  const [sxx, sxy] = [pts.reduce((s, p) => s + p[0] * p[0], 0), pts.reduce((s, p) => s + p[0] * p[1], 0)];
  const d = n * sxx - sx * sx;
  const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;
  return { slope, icept: (sy - slope * sx) / n };
}

// Functions an `expr` metric may call. All reduce the summed curve; `at` is the
// only one that reads a single frequency.
function exprFuncs(curve) {
  return {
    mean: (a, b) => meanOver(curve, [a, b]).value,
    max: (a, b) => extremum(curve, [a, b], true).value,
    min: (a, b) => extremum(curve, [a, b], false).value,
    at: (f) => valueAt(curve, f),
  };
}

/**
 * Fit of a replacement segment against the segment it removed: the residual is
 * the replacement bands' response minus the removed bands' contribution, each
 * measured alone. Reported, never gating — a deliberate reshape has a large
 * residual on purpose.
 */
export function residualFit(removedStages, addedStages, fs, range) {
  const rem = curveOf(removedStages, fs);
  const add = curveOf(addedStages, fs);
  const residual = { freqs: rem.freqs, db: add.db.map((v, i) => v - rem.db[i]) };
  const { lo, hi } = rangeIndices(residual, range || [F_LO, F_HI]);
  let [best, sq] = [lo, 0];
  for (let i = lo; i <= hi; i += 1) {
    sq += residual.db[i] * residual.db[i];
    if (Math.abs(residual.db[i]) > Math.abs(residual.db[best])) best = i;
  }
  return {
    rmse: round(Math.sqrt(sq / (hi - lo + 1))),
    maxdev: round(Math.abs(residual.db[best])),
    hz: round(residual.freqs[best], 2),
    range: range || [F_LO, F_HI],
  };
}

/** Per replace edit, its residual fit — [] when the change set replaced nothing. */
export function fitOfEdits(edits, fs) {
  return (edits || [])
    .filter((e) => e.kind === "replace")
    .map((e) =>
      residualFit(
        e.removed.map((r) => ({ kind: "iir", args: r.before })),
        e.added.map((a) => ({ kind: "iir", args: a.after })),
        fs,
        e.fit_range,
      ),
    );
}

// ---- target-relative kinds -------------------------------------------------
//
// These score the curve's DEVIATION from a declared target (target.js), so an
// objective like "minimize maxdev(1000,3500)" leaves nothing to game: every dB
// of collateral damage inside the range scores against it directly.
//
// `domain: "erb"` weights the reduction by ERB-rate density (Glasberg & Moore
// 1990, PSYCHOACOUSTICS.md §1) instead of log-uniform — one ERB is the ear's
// resolution unit, and ERBs per octave RISE with frequency (~1 in the 20-40 Hz
// octave, ~9 in 10-20 kHz), so a log-uniform grid over-weights the bass and
// ERB weighting counts treble deviation for more, bass for less. Per
// log-spaced grid point the weight is dz/d(ln f) ∝ u/(1+u) with u = 4.37·f/kHz;
// the constant factor cancels in the weighted mean. `domain` applies to rmse
// and mean_signed; a maximum is weight-independent.

function needTarget(target, kind) {
  if (!target) throw new Error(`metric kind "${kind}" needs a target — declare job.target`);
  return target;
}

function weightOf(domain) {
  if (domain === undefined || domain === "log") return () => 1;
  if (domain === "erb") return (f) => (4.37 * f) / 1000 / (1 + (4.37 * f) / 1000);
  throw new Error(`unknown domain "${domain}" (log or erb)`);
}

// Weighted mean of `fn(curve - target)` over a range, folded into one loop —
// no per-point deviation objects.
function weightedDevMean(curve, target, range, domain, fn) {
  const wf = weightOf(domain);
  const { lo, hi } = rangeIndices(curve, range);
  let [sw, s] = [0, 0];
  for (let i = lo; i <= hi; i += 1) {
    const w = wf(curve.freqs[i]);
    sw += w;
    s += w * fn(curve.db[i] - target.db[i]);
  }
  return s / sw;
}

// One-sided scoring for target-relative kinds: "above" keeps only excess over
// the target, "below" only shortfall. Zeroed points still count in the mean's
// denominator — the metric prices unserved deviation on one side without
// paying for the other, which is what lets an objective demand full peak
// service while leaving valleys to explicit guards.
function sideClip(dev, side) {
  if (side === undefined) return dev;
  if (side === "above") return Math.max(dev, 0);
  if (side === "below") return Math.min(dev, 0);
  throw new Error(`unknown side "${side}" (above or below)`);
}

function maxDev(curve, target, spec, signed) {
  const t = needTarget(target, signed ? "maxdev_signed" : "maxdev");
  const { lo, hi } = rangeIndices(curve, spec.range);
  let [best, bestDev] = [lo, curve.db[lo] - t.db[lo]];
  for (let i = lo + 1; i <= hi; i += 1) {
    const dev = curve.db[i] - t.db[i];
    if (Math.abs(dev) > Math.abs(bestDev)) [best, bestDev] = [i, dev];
  }
  return { value: signed ? bestDev : Math.abs(bestDev), hz: curve.freqs[best] };
}

// ---- shape kinds -----------------------------------------------------------

// Peak height above local trend: the straight line in (log f, dB) joining the
// curve's values at the range edges. Distinct from `max`, which conflates a
// bump with the plateau under it — the plateau is what sets the preamp, the
// prominence is what sets the colouration. The declared range IS the trend
// width: widen it to measure against a broader baseline.
function prominenceOver(curve, range) {
  const [a, b] = range;
  const [ya, yb] = [valueAt(curve, a), valueAt(curve, b)];
  let best = null;
  const { lo, hi } = rangeIndices(curve, range);
  for (let i = lo; i <= hi; i += 1) {
    const base = ya + ((yb - ya) * Math.log(curve.freqs[i] / a)) / Math.log(b / a);
    const p = curve.db[i] - base;
    if (!best || p > best.value) best = { value: p, hz: curve.freqs[i] };
  }
  return best;
}

const KINDS = {
  max: (curve, spec) => extremum(curve, spec.range, true),
  min: (curve, spec) => extremum(curve, spec.range, false),
  mean: (curve, spec) => meanOver(curve, spec.range),
  at: (curve, spec) => ({ value: valueAt(curve, spec.f), hz: spec.f }),
  expr: (curve, spec, vars) => ({
    value: evaluate(parse(spec.expr), { funcs: exprFuncs(curve), vars }),
  }),
  rmse: (curve, spec, _vars, target) => ({
    value: Math.sqrt(
      weightedDevMean(curve, needTarget(target, "rmse"), spec.range, spec.domain, (dev) => {
        const d = sideClip(dev, spec.side);
        return d * d;
      }),
    ),
  }),
  maxdev: (curve, spec, _vars, target) => maxDev(curve, target, spec, false),
  maxdev_signed: (curve, spec, _vars, target) => maxDev(curve, target, spec, true),
  mean_signed: (curve, spec, _vars, target) => ({
    value: weightedDevMean(curve, needTarget(target, "mean_signed"), spec.range, spec.domain, (dev) => dev),
  }),
  prominence: (curve, spec) => prominenceOver(curve, spec.range),
  ripple: (curve, spec) => ({
    value: extremum(curve, spec.range, true).value - extremum(curve, spec.range, false).value,
  }),
  slope: (curve, spec) => {
    const { lo, hi } = rangeIndices(curve, spec.range);
    const pts = [];
    for (let i = lo; i <= hi; i += 1) pts.push([Math.log2(curve.freqs[i]), curve.db[i]]);
    return { value: linfit(pts).slope };
  },
  note_spread: (curve, spec) => {
    const vals = noteRange(spec.from, spec.to).map((n) => valueAt(curve, n.hz));
    return { value: Math.max(...vals) - Math.min(...vals) };
  },
};

// The standing panel PRIMER requires on every answer, as a named preset —
// retyping it per job invites drift. `"metrics": "standard"` uses it as-is;
// `{"preset": "standard", ...more}` extends it.
const PRESETS = {
  standard: {
    bass_50_150: { kind: "mean", range: [50, 150] },
    oomph_80_160: { kind: "mean", range: [80, 160] },
    mud_200_400: { kind: "mean", range: [200, 400] },
    mid_400_1500: { kind: "mean", range: [400, 1500] },
    treble_4k_10k: { kind: "mean", range: [4000, 10000] },
    v_db: { kind: "expr", expr: "(mean(50,150)+mean(4000,10000))/2 - mean(400,1500)" },
    ripple_150_1000: { kind: "ripple", range: [150, 1000] },
    spread_A2_G4: { kind: "note_spread", from: "A2", to: "G4" },
  },
};

/** job.metrics -> concrete spec object: a preset name, {preset, ...extras}, or specs as given. */
export function resolveMetricSpecs(metrics) {
  const name = typeof metrics === "string" ? metrics : metrics && metrics.preset;
  if (!name) return metrics;
  const preset = PRESETS[name];
  if (!preset) throw new Error(`metrics: unknown preset "${name}" (${Object.keys(PRESETS).join(", ")})`);
  const { preset: _p, ...extras } = typeof metrics === "string" ? { preset: name } : metrics;
  return { ...preset, ...extras };
}

/**
 * Evaluate a caller-defined metric panel against one curve.
 * Metrics are evaluated in declaration order; an `expr` metric may reference
 * any metric declared before it by name. `target` (a curve from target.js) is
 * required by the target-relative kinds and ignored by the rest.
 */
export function computeMetrics(curve, specs, target) {
  const out = {};
  const vars = {};
  for (const [name, spec] of Object.entries(specs || {})) {
    const kind = KINDS[spec.kind];
    if (!kind) throw new Error(`metric "${name}": unknown kind "${spec.kind}"`);
    out[name] = kind(curve, spec, vars, target);
    vars[name] = out[name].value;
  }
  return out;
}

/** Flat name -> number view of a metric panel (objective / constraint scope). */
export function metricValues(panel) {
  return Object.fromEntries(Object.entries(panel).map(([k, v]) => [k, v.value]));
}

// Quadratic refinement in (log f, dB) — the grid is 4096 points over three
// decades, so the true peak sits between samples and the naive grid maximum
// under-reports both its height and its frequency.
function refine(curve, i) {
  const [y0, y1, y2] = [curve.db[i - 1], curve.db[i], curve.db[i + 1]];
  const denom = y0 - 2 * y1 + y2;
  const d = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom;
  const k = Math.log(curve.freqs[1] / curve.freqs[0]);
  return { hz: curve.freqs[i] * Math.exp(k * d), db: y1 - 0.25 * (y0 - y2) * d };
}

/** Local maxima and minima of the summed curve, refined off-grid. */
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
