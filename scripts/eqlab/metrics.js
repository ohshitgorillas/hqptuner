// Metric kinds, presets, and panel evaluation — all on the SUMMED chain.
//
// Every number this file produces is a reduction over a curve from curve.js,
// the same math the UI plots minus phase. No band is ever measured in isolation:
// a metric over a range is a reduction over the summed curve inside that range.

import { linfit, valueAt } from "./curve.js";
import { parse, evaluate } from "./expr.js";
import { noteRange } from "./notes.js";

/** @typedef {import("./curve.js").CurveLike} CurveLike */
/** @typedef {import("./curve.js").Curve} Curve */

/**
 * One metric's answer. `hz` is present only where the metric localizes to a
 * frequency — a mean or an rmse has no single place it happened.
 *
 * @typedef {{ value: number, hz?: number }} MetricResult
 */

/**
 * One metric as a job declares it. One shape rather than a union per kind: the
 * handler for each kind reads the fields that kind defines and the others are
 * absent, which is exactly what the optionality says.
 *
 * @typedef {{
 *   kind: string,
 *   range?: [number, number],
 *   f?: number,
 *   expr?: string,
 *   side?: string,
 *   domain?: string,
 *   from?: string,
 *   to?: string,
 * }} MetricSpec
 */

/**
 * First and last grid index whose frequency falls inside a [lo, hi] Hz range,
 * inclusive; throws when the range spans no grid point.
 *
 * Closed-form bounds — the grid is uniform in log f, so the first and last
 * in-range indices need no scan. The one-step nudges settle float edge cases
 * so boundary membership matches the exact `f >= a && f <= b` test.
 *
 * @param {CurveLike} curve
 * @param {[number, number]} range
 * @returns {{ lo: number, hi: number }}
 */
export function rangeIndices(curve, range) {
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

/**
 * @param {CurveLike} curve
 * @param {[number, number]} range
 * @param {boolean} wantMax
 * @returns {MetricResult}
 */
function extremum(curve, range, wantMax) {
  const { lo, hi } = rangeIndices(curve, range);
  let best = lo;
  for (let i = lo; i <= hi; i += 1) {
    if (wantMax ? curve.db[i] > curve.db[best] : curve.db[i] < curve.db[best]) best = i;
  }
  return { value: curve.db[best], hz: curve.freqs[best] };
}

/**
 * @param {CurveLike} curve
 * @param {[number, number]} range
 * @returns {MetricResult}
 */
function meanOver(curve, range) {
  const { lo, hi } = rangeIndices(curve, range);
  let sum = 0;
  for (let i = lo; i <= hi; i += 1) sum += curve.db[i];
  return { value: sum / (hi - lo + 1) };
}

// Functions an `expr` metric may call. All reduce the summed curve; `at` is the
// only one that reads a single frequency.
/**
 * @param {CurveLike} curve
 * @returns {Record<string, (...args: number[]) => number>}
 */
function exprFuncs(curve) {
  return {
    mean: (a, b) => meanOver(curve, [a, b]).value,
    max: (a, b) => extremum(curve, [a, b], true).value,
    min: (a, b) => extremum(curve, [a, b], false).value,
    at: (f) => valueAt(curve, f),
  };
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

/**
 * The range a range-taking kind declares.
 *
 * A type assertion, deliberately not a check: the kinds below that reach
 * `rangeIndices` all define a range, and a spec that omits one has always died
 * on the destructure inside it. Throwing a nicer error here would be a second,
 * different failure for the same bad job — so this narrows and leaves the
 * runtime exactly where it was.
 *
 * @param {[number, number] | undefined} range
 * @returns {[number, number]}
 */
const needRange = (range) => /** @type {[number, number]} */ (range);

/**
 * @param {CurveLike | null | undefined} target
 * @param {string} kind
 * @returns {CurveLike}
 */
function needTarget(target, kind) {
  if (!target) throw new Error(`metric kind "${kind}" needs a target — declare job.target`);
  return target;
}

/**
 * @param {string | undefined} domain
 * @returns {(f: number) => number}
 */
function weightOf(domain) {
  if (domain === undefined || domain === "log") return () => 1;
  if (domain === "erb") return (f) => (4.37 * f) / 1000 / (1 + (4.37 * f) / 1000);
  throw new Error(`unknown domain "${domain}" (log or erb)`);
}

// Weighted mean of `fn(curve - target)` over a range, folded into one loop —
// no per-point deviation objects.
/**
 * @param {CurveLike} curve
 * @param {CurveLike} target
 * @param {MetricSpec} spec
 * @param {(dev: number) => number} fn
 * @returns {number}
 */
function weightedDevMean(curve, target, { range, domain }, fn) {
  const wf = weightOf(domain);
  const { lo, hi } = rangeIndices(curve, needRange(range));
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
/**
 * @param {number} dev
 * @param {string | undefined} side
 * @returns {number}
 */
function sideClip(dev, side) {
  if (side === undefined) return dev;
  if (side === "above") return Math.max(dev, 0);
  if (side === "below") return Math.min(dev, 0);
  throw new Error(`unknown side "${side}" (above or below)`);
}

/**
 * @param {CurveLike} curve
 * @param {CurveLike | null | undefined} target
 * @param {MetricSpec} spec
 * @param {boolean} signed
 * @returns {MetricResult}
 */
function maxDev(curve, target, spec, signed) {
  const t = needTarget(target, signed ? "maxdev_signed" : "maxdev");
  const { lo, hi } = rangeIndices(curve, needRange(spec.range));
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
// prominence is what sets the coloration. The declared range IS the trend
// width: widen it to measure against a broader baseline.
/**
 * @param {CurveLike} curve
 * @param {[number, number]} range
 * @returns {MetricResult}
 */
function prominenceOver(curve, range) {
  const [a, b] = range;
  const [ya, yb] = [valueAt(curve, a), valueAt(curve, b)];
  /** @type {MetricResult | null} */
  let best = null;
  const { lo, hi } = rangeIndices(curve, range);
  for (let i = lo; i <= hi; i += 1) {
    const base = ya + ((yb - ya) * Math.log(curve.freqs[i] / a)) / Math.log(b / a);
    const p = curve.db[i] - base;
    if (!best || p > best.value) best = { value: p, hz: curve.freqs[i] };
  }
  // `rangeIndices` throws when the range holds no grid point, so the loop above
  // always ran at least once and `best` is always set by here.
  return /** @type {MetricResult} */ (best);
}

/**
 * Every metric kind, by name. The four arguments are fixed across the table
 * even though most kinds ignore the last two — `computeMetrics` calls them
 * uniformly.
 *
 * @type {Record<string, (
 *   curve: Curve,
 *   spec: MetricSpec,
 *   vars: Record<string, number>,
 *   target: CurveLike | null | undefined,
 * ) => MetricResult>}
 */
const KINDS = {
  max: (curve, spec) => extremum(curve, needRange(spec.range), true),
  min: (curve, spec) => extremum(curve, needRange(spec.range), false),
  mean: (curve, spec) => meanOver(curve, needRange(spec.range)),
  at: (curve, spec) => ({ value: valueAt(curve, Number(spec.f)), hz: spec.f }),
  expr: (curve, spec, vars) => ({
    value: evaluate(parse(spec.expr), { funcs: exprFuncs(curve), vars }),
  }),
  rmse: (curve, spec, _vars, target) => ({
    value: Math.sqrt(
      weightedDevMean(curve, needTarget(target, "rmse"), spec, (dev) => {
        const d = sideClip(dev, spec.side);
        return d * d;
      }),
    ),
  }),
  maxdev: (curve, spec, _vars, target) => maxDev(curve, target, spec, false),
  maxdev_signed: (curve, spec, _vars, target) => maxDev(curve, target, spec, true),
  mean_signed: (curve, spec, _vars, target) => ({
    value: weightedDevMean(curve, needTarget(target, "mean_signed"), spec, (dev) => dev),
  }),
  prominence: (curve, spec) => prominenceOver(curve, needRange(spec.range)),
  ripple: (curve, spec) => ({
    value: extremum(curve, needRange(spec.range), true).value - extremum(curve, needRange(spec.range), false).value,
  }),
  slope: (curve, spec) => {
    const { lo, hi } = rangeIndices(curve, needRange(spec.range));
    /** @type {[number, number][]} */
    const pts = [];
    for (let i = lo; i <= hi; i += 1) pts.push([Math.log2(curve.freqs[i]), curve.db[i]]);
    return { value: linfit(pts).slope };
  },
  note_spread: (curve, spec) => {
    const vals = noteRange(String(spec.from), String(spec.to)).map((n) => valueAt(curve, n.hz));
    return { value: Math.max(...vals) - Math.min(...vals) };
  },
};

// The standing panel PRIMER requires on every answer, as a named preset —
// retyping it per job invites drift. `"metrics": "standard"` uses it as-is;
// `{"preset": "standard", ...more}` extends it.
/** @type {Record<string, Record<string, MetricSpec>>} */
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

/**
 * A spec bag as a job writes it: named specs, optionally alongside a `preset`
 * naming a bag to start from. The index signature admits the `string` that
 * `preset` carries, because an intersection with `Record<string, MetricSpec>`
 * would demand `preset` be a spec AND a string at once — a bag no caller can
 * write.
 *
 * @typedef {{ preset?: string } & { [k: string]: MetricSpec | string | undefined }} MetricSpecBag
 */

/**
 * job.metrics -> concrete spec object: a preset name, {preset, ...extras}, or specs as given.
 *
 * @param {string | MetricSpecBag | null | undefined} metrics
 * @returns {Record<string, MetricSpec> | null | undefined}
 */
export function resolveMetricSpecs(metrics) {
  const name = typeof metrics === "string" ? metrics : metrics && metrics.preset;
  // A `metrics` of "" names no preset and declares no specs. It resolves to
  // nothing rather than to the empty string it arrived as; downstream is
  // unchanged, since `computeMetrics` reads `specs || {}` and both are falsy.
  // No preset named means every remaining key is a spec — the one key that
  // could have held a string is the `preset` this branch has ruled out.
  if (!name) return typeof metrics === "string" ? undefined : /** @type {Record<string, MetricSpec>} */ (metrics);
  const preset = PRESETS[name];
  if (!preset) throw new Error(`metrics: unknown preset "${name}" (${Object.keys(PRESETS).join(", ")})`);
  // `metrics ?? {}` is unreachable — a null/undefined `metrics` yields no `name`
  // and returned above — and is here only to narrow the object branch.
  const { preset: _p, ...extras } = typeof metrics === "string" ? { preset: name } : (metrics ?? {});
  // `extras` is the bag with its `preset` key destructured away, so the string
  // that key held is gone and every value left is a spec.
  return { ...preset, .../** @type {Record<string, MetricSpec>} */ (extras) };
}

/**
 * Evaluate a caller-defined metric panel against one curve.
 * Metrics are evaluated in declaration order; an `expr` metric may reference
 * any metric declared before it by name. `target` (a curve from target.js) is
 * required by the target-relative kinds and ignored by the rest.
 *
 * @param {Curve} curve
 * @param {Record<string, MetricSpec> | null | undefined} specs
 * @param {CurveLike | null | undefined} [target]
 * @returns {Record<string, MetricResult>}
 */
export function computeMetrics(curve, specs, target) {
  /** @type {Record<string, MetricResult>} */
  const out = {};
  /** @type {Record<string, number>} */
  const vars = {};
  for (const [name, spec] of Object.entries(specs || {})) {
    const kind = KINDS[spec.kind];
    if (!kind) throw new Error(`metric "${name}": unknown kind "${spec.kind}"`);
    out[name] = kind(curve, spec, vars, target);
    vars[name] = out[name].value;
  }
  return out;
}

/**
 * Flat name -> number view of a metric panel (objective / constraint scope).
 *
 * @param {Record<string, MetricResult>} panel
 * @returns {Record<string, number>}
 */
export function metricValues(panel) {
  return Object.fromEntries(Object.entries(panel).map(([k, v]) => [k, v.value]));
}
