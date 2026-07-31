// The search job: a declarative space, hard constraints, and either one scalar
// objective or a Pareto front over several — for the spaces where a single
// scalar would have to lie about the tradeoff.
//
// Speed comes from the fact that dB responses in series add: the stages a
// candidate does not vary are summed ONCE, and each candidate re-measures only
// the band(s) it actually moves. Metrics are still read off the summed chain.

import { applyChanges, serialize } from "./chain.js";
import { evaluate, parse } from "./expr.js";
import { guidanceFlags } from "./guidance.js";
import { computeMetrics, curveOf, metricValues, preampDb, round, sumCurves } from "./metrics.js";

// Runaway guards, nothing more. They exist so a typo'd step of 0.0001 fails in
// a second instead of eating the machine — they are NOT a budget, and hitting
// one is not a decision to escalate. A space too big for one pass is split and
// run in batches. Measured rate: 2880 candidates in 4.3 s with two varied bands
// on the 4096-point grid (~670/s), so plan batches by the clock, not by asking.
export const MAX_COMBOS = 2_000_000;
export const MAX_STEPS = 100_000;

// How many of the best-scoring rejected candidates survive into the report.
export const REJECTS_KEPT = 5;

function rangeValues(from, to, step) {
  if (!(step > 0)) throw new Error(`search: step must be positive, got ${step}`);
  if (to < from) throw new Error(`search: range [${from}, ${to}] runs backwards`);
  const n = Math.floor((to - from) / step + 1e-9) + 1;
  if (n > MAX_STEPS)
    throw new Error(`search: range [${from}, ${to}] step ${step} yields ${n} values (max ${MAX_STEPS})`);
  return Array.from({ length: n }, (_, i) => round(from + i * step, 6));
}

const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number");

/** One parameter spec -> its list of values. [a,b,step] is a range; any other array is a literal list. */
export function expandValue(spec) {
  if (isTriple(spec)) return rangeValues(spec[0], spec[1], spec[2]);
  if (Array.isArray(spec)) return spec;
  if (spec && typeof spec === "object" && Array.isArray(spec.values)) return spec.values;
  if (spec && typeof spec === "object" && "from" in spec) return rangeValues(spec.from, spec.to, spec.step);
  return [spec];
}

/** A change spec with per-parameter value lists -> every concrete change object. */
export function expandChange(spec) {
  if (!spec) return [null];
  const keys = Object.keys(spec);
  return keys.reduce(
    (acc, key) => acc.flatMap((partial) => expandValue(spec[key]).map((v) => ({ ...partial, [key]: v }))),
    [{}],
  );
}

const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

// Every combination across a LIST of change specs — one concrete change per
// spec per combination. This is what lets a space carry two appends (a cut
// plus a broader lift): one append forced every candidate to solve a
// two-feature problem with a single band.
function crossChanges(specs) {
  return specs.reduce((acc, spec) => acc.flatMap((set) => expandChange(spec).map((c) => [...set, c])), [[]]);
}

// `select` stays a literal inside each amend spec: a search varies band
// parameters, never which band a spec amends — the fixed-index split in
// makeMeasurer depends on it, and "which band" is a different question that a
// second amend spec answers directly.
function checkSelects(specs) {
  for (const spec of specs) {
    if (spec && typeof spec.select === "object")
      throw new Error(
        "search: select must be a literal frequency per amend spec — to vary which band moves, give one amend spec per band",
      );
  }
}

function candidates(space) {
  const amendSpecs = asList(space.amend);
  checkSelects(amendSpecs);
  const amendSets = crossChanges(amendSpecs);
  const appendSets = crossChanges(asList(space.append));
  const out = [];
  for (const amend of amendSets) {
    for (const append of appendSets) {
      out.push({ ...(amend.length ? { amend } : {}), ...(append.length ? { append } : {}) });
    }
  }
  if (out.length > MAX_COMBOS) {
    throw new Error(
      `search: ${out.length} combinations exceeds the ${MAX_COMBOS} runaway guard — split the space and run it in batches`,
    );
  }
  return out;
}

// Fixed part of the chain, summed once. Every candidate amends the same stage
// indices (each amend spec's `select` is a literal frequency), so the split is
// computed from one sample and reused.
function makeMeasurer(ctx, sample) {
  const first = applyChanges(ctx.stages, sample);
  const amended = new Set(first.edits.filter((e) => e.kind === "amend").map((e) => e.index));
  const base = curveOf(
    ctx.stages.filter((_, i) => !amended.has(i)),
    ctx.fs,
  );
  return (changes) => {
    const { stages, edits } = applyChanges(ctx.stages, changes);
    const varied = stages.filter((_, i) => amended.has(i) || i >= ctx.stages.length);
    return { stages, edits, curve: sumCurves(base, curveOf(varied, ctx.fs)) };
  };
}

function parseObjective(text) {
  const m = /^\s*(maximize|minimize)\s+(.+)$/i.exec(String(text || ""));
  if (!m) throw new Error('search: objective must read "maximize <expr>" or "minimize <expr>"');
  return { direction: m[1].toLowerCase(), ast: parse(m[2]), expr: m[2].trim() };
}

// "objective" and "pareto" are mutually exclusive: a scalar ranking of a
// multi-objective space is exactly the false ordering pareto exists to avoid.
function parseObjectives(job) {
  if (job.pareto !== undefined) {
    if (job.objective !== undefined) throw new Error('search: give "objective" or "pareto", not both');
    const objectives = asList(job.pareto).map(parseObjective);
    if (objectives.length < 2)
      throw new Error('search: pareto needs two or more objectives — one objective is scalar, use "objective"');
    return { pareto: true, objectives };
  }
  return { pareto: false, objectives: [parseObjective(job.objective)] };
}

// Every bound a candidate violates, with how far past the bound it sits. A
// candidate is judged against ALL constraints, so rejected_by counts every
// violated constraint, not just the first one checked.
function constraintFailures(constraints, values) {
  const out = [];
  for (const c of constraints) {
    const v = values[c.metric];
    if (v === undefined) throw new Error(`search: constraint names unknown metric "${c.metric}"`);
    if (c.min !== undefined && v < c.min)
      out.push({ metric: c.metric, bound: "min", limit: c.min, by: round(c.min - v) });
    if (c.max !== undefined && v > c.max)
      out.push({ metric: c.metric, bound: "max", limit: c.max, by: round(v - c.max) });
  }
  return out;
}

// The constraint sitting closest to its bound: the one actually shaping this
// candidate. Slack is distance to the bound, in the metric's own units.
function bindingOf(constraints, values) {
  let best = null;
  for (const c of constraints) {
    const v = values[c.metric];
    const slacks = [];
    if (c.min !== undefined) slacks.push({ bound: "min", slack: v - c.min });
    if (c.max !== undefined) slacks.push({ bound: "max", slack: c.max - v });
    for (const s of slacks) if (!best || s.slack < best.slack) best = { metric: c.metric, ...s };
  }
  return best && { metric: best.metric, bound: best.bound, slack: round(best.slack) };
}

function measureCandidate(measure, changes, ctx) {
  const { stages, edits, curve } = measure(changes);
  const panel = computeMetrics(curve, ctx.metrics, ctx.target);
  return { changes, stages, edits, values: metricValues(panel), preamp: preampDb(curve), partial: curve.partial };
}

function survivorOut(cand, spec, constraints) {
  return {
    changes: cand.changes,
    ...(spec.pareto
      ? { scores: Object.fromEntries(spec.objectives.map((o, i) => [o.expr, round(cand.scores[i], 4)])) }
      : { score: round(cand.scores[0], 4) }),
    metrics: Object.fromEntries(Object.entries(cand.values).map(([k, v]) => [k, round(v)])),
    preamp_db: round(cand.preamp, 2),
    ...(constraints.length ? { binding: bindingOf(constraints, cand.values) } : {}),
    process: serialize(cand.stages),
    partial: cand.partial,
    flags: guidanceFlags(cand.edits, cand.stages),
  };
}

// a dominates b when a is at least as good everywhere and strictly better
// somewhere. `signed` is every score flipped to smaller-is-better.
const dominates = (a, b) => a.every((v, i) => v <= b[i]) && a.some((v, i) => v < b[i]);

// Incremental non-dominated archive. Candidates that no survivor beats on
// every objective at once; the archive stays small in practice.
function paretoFront(cands) {
  const front = [];
  for (const c of cands) {
    if (front.some((f) => dominates(f.signed, c.signed))) continue;
    for (let i = front.length - 1; i >= 0; i -= 1) if (dominates(c.signed, front[i].signed)) front.splice(i, 1);
    front.push(c);
  }
  return front;
}

// Best-scoring rejects, ranked by the first objective. What the constraints
// cost, made visible instead of silently counted.
function noteReject(rejects, cand, reasons) {
  rejects.push({ signed: cand.signed[0], score: round(cand.scores[0], 4), changes: cand.changes, reasons });
  rejects.sort((a, b) => a.signed - b.signed);
  if (rejects.length > REJECTS_KEPT) rejects.pop();
}

// Per constraint bound, the best candidate rejected by that bound ALONE — the
// one a relaxation of just that constraint would admit.
function noteSoleReject(sole, cand, reason) {
  const key = `${reason.metric}:${reason.bound}`;
  const cur = sole.get(key);
  if (!cur || cand.signed[0] < cur.signed) sole.set(key, { signed: cand.signed[0], score: cand.scores[0], reason });
}

// What relaxing each constraint would buy: the relaxation that admits the best
// sole-reject, its score, and its gain over the current winner. Bounds whose
// best sole-reject would not beat the winner are dropped — relaxing them buys
// nothing.
function sensitivityOf(sole, winnerSigned) {
  return [...sole.values()]
    .filter((s) => winnerSigned === undefined || s.signed < winnerSigned)
    .map(({ signed, score, reason }) => ({
      metric: reason.metric,
      bound: reason.bound,
      limit: reason.limit,
      relax_by: reason.by,
      score: round(score, 4),
      ...(winnerSigned === undefined ? {} : { gain: round(winnerSigned - signed, 4) }),
    }));
}

// One pass over every candidate: measure, score, judge against constraints.
function sweep(combos, measure, ctx, spec, constraints) {
  const signs = spec.objectives.map((o) => (o.direction === "maximize" ? -1 : 1));
  const acc = { rejected: {}, rejects: [], sole: new Map(), survived: [] };
  for (const changes of combos) {
    const cand = measureCandidate(measure, changes, ctx);
    cand.scores = spec.objectives.map((o) => evaluate(o.ast, { vars: cand.values, funcs: {} }));
    cand.signed = cand.scores.map((s, i) => s * signs[i]);
    const reasons = constraintFailures(constraints, cand.values);
    if (reasons.length) {
      for (const r of reasons) acc.rejected[r.metric] = (acc.rejected[r.metric] || 0) + 1;
      noteReject(acc.rejects, cand, reasons);
      if (reasons.length === 1) noteSoleReject(acc.sole, cand, reasons[0]);
    } else {
      acc.survived.push({ signed: cand.signed, out: survivorOut(cand, spec, constraints) });
    }
  }
  return acc;
}

export function searchJob(job, ctx) {
  const spec = parseObjectives(job);
  const constraints = job.constraints || [];
  const combos = candidates(job.space || {});
  const measure = makeMeasurer(ctx, combos[0]);
  const { rejected, rejects, sole, survived } = sweep(combos, measure, ctx, spec, constraints);
  const keep = job.top ?? 10;
  const common = {
    constraints,
    considered: combos.length,
    survived: survived.length,
    rejected_by: rejected,
    rejected_top: rejects.map(({ score, changes, reasons }) => ({ score, changes, reasons })),
  };
  if (spec.pareto) {
    const front = paretoFront(survived).sort((a, b) => a.signed[0] - b.signed[0]);
    return {
      pareto: { objectives: spec.objectives.map((o) => ({ direction: o.direction, expr: o.expr })) },
      ...common,
      front_size: front.length,
      returned: Math.min(keep, front.length),
      front: front.slice(0, keep).map((s) => s.out),
    };
  }
  survived.sort((a, b) => a.signed[0] - b.signed[0]);
  return {
    objective: { direction: spec.objectives[0].direction, expr: spec.objectives[0].expr },
    ...common,
    returned: Math.min(keep, survived.length),
    top: survived.slice(0, keep).map((s) => s.out),
    margin: survived.length > 1 ? round(Math.abs(survived[0].signed[0] - survived[1].signed[0]), 4) : null,
    sensitivity: sensitivityOf(sole, survived.length ? survived[0].signed[0] : undefined),
  };
}
