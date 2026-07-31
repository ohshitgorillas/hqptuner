// Response sampling, extrema, and metric evaluation — all on the SUMMED chain.
//
// Every number this file produces comes out of `chainResponse` (lib/dsp.js), the
// same math the UI plots. No band is ever measured in isolation: a metric over a
// range is a reduction over the summed curve inside that range.

import { chainResponse } from "../../hqptuner/static/lib/dsp.js";
import { parse, evaluate } from "./expr.js";

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
  let partial = false;
  const db = GRID.map((f) => {
    const r = chainResponse(stages, f, fs);
    if (r.partial) partial = true;
    return r.db;
  });
  return { freqs: GRID, db, fs, partial };
}

/**
 * Point-wise sum of two curves over the shared grid. dB responses of stages in
 * series add, so a search can hold the unchanged part of a chain fixed and
 * recompute only the stages a candidate actually varies.
 */
export function sumCurves(a, b) {
  return { freqs: a.freqs, db: a.db.map((v, i) => v + b.db[i]), fs: a.fs, partial: a.partial || b.partial };
}

/** Round for output — raw doubles print 17 digits of noise nobody can act on. */
export const round = (x, dp = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** dp) / 10 ** dp);

/** Preamp per PRIMER guardrails: negative of the max of the SUMMED response. */
export function preampDb(curve) {
  return -Math.max(...curve.db);
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

function rangeIndices(curve, range) {
  const [a, b] = range;
  const idx = [];
  for (let i = 0; i < curve.freqs.length; i += 1) {
    if (curve.freqs[i] >= a && curve.freqs[i] <= b) idx.push(i);
  }
  if (idx.length === 0) throw new Error(`metric range [${a}, ${b}] Hz contains no grid point`);
  return idx;
}

function extremum(curve, range, wantMax) {
  const idx = rangeIndices(curve, range);
  let best = idx[0];
  for (const i of idx) {
    if (wantMax ? curve.db[i] > curve.db[best] : curve.db[i] < curve.db[best]) best = i;
  }
  return { value: curve.db[best], hz: curve.freqs[best] };
}

function meanOver(curve, range) {
  const idx = rangeIndices(curve, range);
  const sum = idx.reduce((acc, i) => acc + curve.db[i], 0);
  return { value: sum / idx.length };
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

const KINDS = {
  max: (curve, spec) => extremum(curve, spec.range, true),
  min: (curve, spec) => extremum(curve, spec.range, false),
  mean: (curve, spec) => meanOver(curve, spec.range),
  at: (curve, spec) => ({ value: valueAt(curve, spec.f), hz: spec.f }),
  expr: (curve, spec, vars) => ({
    value: evaluate(parse(spec.expr), { funcs: exprFuncs(curve), vars }),
  }),
};

/**
 * Evaluate a caller-defined metric panel against one curve.
 * Metrics are evaluated in declaration order; an `expr` metric may reference
 * any metric declared before it by name.
 */
export function computeMetrics(curve, specs) {
  const out = {};
  const vars = {};
  for (const [name, spec] of Object.entries(specs || {})) {
    const kind = KINDS[spec.kind];
    if (!kind) throw new Error(`metric "${name}": unknown kind "${spec.kind}"`);
    out[name] = kind(curve, spec, vars);
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
