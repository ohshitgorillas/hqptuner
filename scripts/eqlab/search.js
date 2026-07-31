// The search job: a declarative space, hard constraints, one objective.
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

function candidates(space) {
  const amends = expandChange(space.amend);
  const appends = expandChange(space.append);
  const out = [];
  for (const amend of amends) {
    for (const append of appends) {
      out.push({ ...(amend ? { amend } : {}), ...(append ? { append } : {}) });
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
// indices (`select` is a single frequency), so the split is computed from one
// sample and reused.
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

function checkConstraint(constraint, values) {
  const v = values[constraint.metric];
  if (v === undefined) throw new Error(`search: constraint names unknown metric "${constraint.metric}"`);
  if (constraint.min !== undefined && v < constraint.min) return false;
  if (constraint.max !== undefined && v > constraint.max) return false;
  return true;
}

function parseObjective(text) {
  const m = /^\s*(maximize|minimize)\s+(.+)$/i.exec(String(text || ""));
  if (!m) throw new Error('search: objective must read "maximize <expr>" or "minimize <expr>"');
  return { direction: m[1].toLowerCase(), ast: parse(m[2]), expr: m[2].trim() };
}

function measureCandidate(measure, changes, ctx) {
  const { stages, edits, curve } = measure(changes);
  const panel = computeMetrics(curve, ctx.metrics);
  return { changes, stages, edits, values: metricValues(panel), preamp: preampDb(curve), partial: curve.partial };
}

function survivor(cand, objective) {
  return {
    changes: cand.changes,
    score: round(evaluate(objective.ast, { vars: cand.values, funcs: {} }), 4),
    metrics: Object.fromEntries(Object.entries(cand.values).map(([k, v]) => [k, round(v)])),
    preamp_db: round(cand.preamp, 2),
    process: serialize(cand.stages),
    partial: cand.partial,
    flags: guidanceFlags(cand.edits, cand.stages),
  };
}

export function searchJob(job, ctx) {
  const objective = parseObjective(job.objective);
  const constraints = job.constraints || [];
  const combos = candidates(job.space || {});
  const measure = makeMeasurer(ctx, combos[0]);
  const rejected = {};
  const survived = [];
  for (const changes of combos) {
    const cand = measureCandidate(measure, changes, ctx);
    const failed = constraints.find((c) => !checkConstraint(c, cand.values));
    if (failed) rejected[failed.metric] = (rejected[failed.metric] || 0) + 1;
    else survived.push(survivor(cand, objective));
  }
  const sign = objective.direction === "maximize" ? -1 : 1;
  survived.sort((a, b) => sign * (a.score - b.score));
  return {
    objective: { direction: objective.direction, expr: objective.expr },
    constraints,
    considered: combos.length,
    survived: survived.length,
    rejected_by: rejected,
    returned: Math.min(job.top ?? 10, survived.length),
    top: survived.slice(0, job.top ?? 10),
  };
}
