// The search job: a declarative space, hard constraints, and either one scalar
// objective or a Pareto front over several — for the spaces where a single
// scalar would have to lie about the tradeoff.
//
// Speed comes from the fact that dB responses in series add: the stages a
// candidate does not vary are summed ONCE, and each candidate re-measures only
// the band(s) it actually moves. Metrics are still read off the summed chain.

import { serializeProcess } from "../../hqptuner/static/lib/matrixspec.js";
import { applyChanges } from "./chain.js";
import { curveOf, preampDb, preampDbFull, round, sumCurves } from "./curve.js";
import { evaluate, parse } from "./expr.js";
import { fitOfEdits } from "./fit.js";
import { guidanceFlags, headroomFlags } from "./guidance.js";
import { computeMetrics, metricValues } from "./metrics.js";
import {
  asList,
  checkSeed,
  coordsOf,
  copyChanges,
  refineEntry,
  refineFront,
  refineOptsOf,
  refineSpecOf,
  refineTop,
} from "./search-space.js";
import { candidates } from "./space.js";

/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").MatrixStage} MatrixStage */
/** @typedef {import("./curve.js").Curve} Curve */
/** @typedef {import("./jobs.js").JobCtx} JobCtx */
/** @typedef {import("./space.js").Space} Space */
/** @typedef {import("./search-space.js").ChangeSet} ChangeSet */
/** @typedef {import("./search-space.js").Objective} Objective */
/** @typedef {import("./search-space.js").ObjSpec} ObjSpec */
/** @typedef {import("./search-space.js").Constraint} Constraint */
/** @typedef {import("./search-space.js").Failure} Failure */
/** @typedef {import("./search-space.js").Candidate} Candidate */
/** @typedef {import("./search-space.js").SurvivorOut} SurvivorOut */
/** @typedef {import("./search-space.js").Entry} Entry */
/** @typedef {import("./search-space.js").Measurer} Measurer */
/** @typedef {import("./search-space.js").Env} Env */
/** @typedef {import("./search-space.js").RefineSpec} RefineSpec */

// How many of the best-scoring rejected candidates survive into the report.
export const REJECTS_KEPT = 5;

// Fixed part of the chain, summed once. Which stages a candidate touches is
// constant across the space (amend selects and replace removals are literal
// frequencies), so the untouched set is read off ONE sample by object identity
// — applyChanges copies every stage it amends, removes, or adds — and reused.
/**
 * @param {JobCtx} ctx
 * @param {ChangeSet} sample
 * @returns {Measurer}
 */
function makeMeasurer(ctx, sample) {
  const first = applyChanges(ctx.stages, sample);
  const untouched = new Set(first.stages.filter((s) => ctx.stages.includes(s)));
  const base = curveOf([...untouched], ctx.fs);
  // Per-stage curve memo, scoped to this job. The space is a cross product, so
  // the same varied band recurs across candidates; its curve is computed once
  // per distinct (kind, args) and summed from cache. Args come out of
  // editedStage in fixed schema order, so JSON.stringify is a stable key. An
  // unplottable stage's `partial` lives on its cached curve and propagates
  // through sumCurves.
  /** @type {Map<string, Curve>} */
  const cache = new Map();
  const stageCurve = (/** @type {MatrixStage} */ s) => {
    const key = JSON.stringify([s.kind, s.args]);
    let curve = cache.get(key);
    if (!curve) cache.set(key, (curve = curveOf([s], ctx.fs)));
    return curve;
  };
  return (changes) => {
    const { stages, edits } = applyChanges(ctx.stages, changes);
    const varied = stages.filter((s) => !untouched.has(s));
    return { stages, edits, curve: varied.reduce((c, s) => sumCurves(c, stageCurve(s)), base) };
  };
}

/**
 * @param {unknown} text
 * @returns {Objective}
 */
function parseObjective(text) {
  const m = /^\s*(maximize|minimize)\s+(\S.*)$/i.exec(String(text || ""));
  if (!m) throw new Error('search: objective must read "maximize <expr>" or "minimize <expr>"');
  return { direction: m[1].toLowerCase(), ast: parse(m[2]), expr: m[2].trim() };
}

const SWEEP_KEYS = ["amend", "replace", "append"];

// Fail fast on a missing or empty space. Without this, a sweep spec misplaced
// at job level (job.replace instead of job.space.replace) is silently ignored
// and the failure only surfaces later as refine's misleading "nothing to
// refine" — so name the real problem before any grid work starts.
/**
 * @param {Record<string, any>} job
 * @returns {Space}
 */
function checkSpace(job) {
  const space = job.space;
  if (!space || typeof space !== "object" || Array.isArray(space)) {
    const misplaced = space === undefined ? SWEEP_KEYS.filter((k) => job[k] !== undefined) : [];
    const hint = misplaced.length
      ? ` — found ${misplaced.map((k) => `"${k}"`).join(" and ")} directly under job; sweep specs belong under job.space`
      : "";
    throw new Error(`search: job.space must be an object declaring the sweep (amend / replace / append)${hint}`);
  }
  if (!SWEEP_KEYS.some((k) => asList(space[k]).length))
    throw new Error("search: job.space declares no changes — give at least one non-empty amend, replace, or append");
  return space;
}

// "objective" and "pareto" are mutually exclusive: a scalar ranking of a
// multi-objective space is exactly the false ordering pareto exists to avoid.
/**
 * @param {Record<string, any>} job
 * @returns {ObjSpec}
 */
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
/**
 * @param {Constraint[]} constraints
 * @param {Record<string, number>} values
 * @returns {Failure[]}
 */
function constraintFailures(constraints, values) {
  /** @type {Failure[]} */
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
/**
 * @param {Constraint[]} constraints
 * @param {Record<string, number>} values
 * @returns {{ metric: string, bound: string, slack: number } | null}
 */
function bindingOf(constraints, values) {
  /** @type {{ metric: string, bound: string, slack: number } | null} */
  let best = null;
  for (const c of constraints) {
    const v = values[c.metric];
    /** @type {{ bound: string, slack: number }[]} */
    const slacks = [];
    if (c.min !== undefined) slacks.push({ bound: "min", slack: v - c.min });
    if (c.max !== undefined) slacks.push({ bound: "max", slack: c.max - v });
    for (const s of slacks) if (!best || s.slack < best.slack) best = { metric: c.metric, ...s };
  }
  return best && { metric: best.metric, bound: best.bound, slack: round(best.slack) };
}

/**
 * @param {Measurer} measure
 * @param {ChangeSet} changes
 * @param {JobCtx} ctx
 * @returns {Omit<Candidate, "scores" | "signed">}
 */
function measureCandidate(measure, changes, ctx) {
  const { stages, edits, curve } = measure(changes);
  const panel = computeMetrics(curve, ctx.metrics, ctx.target);
  return { changes, stages, edits, values: metricValues(panel), preamp: preampDb(curve), partial: curve.partial };
}

const signsOf = (/** @type {Objective[]} */ objectives) => objectives.map((o) => (o.direction === "maximize" ? -1 : 1));

/**
 * Measure + score in one step: `scores` in each objective's own direction,
 * `signed` flipped to smaller-is-better.
 *
 * @param {Measurer} measure
 * @param {ChangeSet} changes
 * @param {JobCtx} ctx
 * @param {ObjSpec} spec
 * @returns {Candidate}
 */
function scoreCandidate(measure, changes, ctx, spec) {
  const signs = signsOf(spec.objectives);
  const cand = measureCandidate(measure, changes, ctx);
  const scores = spec.objectives.map((o) => evaluate(o.ast, { vars: cand.values, funcs: {} }));
  return { ...cand, scores, signed: scores.map((s, i) => s * signs[i]) };
}

// Fit is computed here, not in measureCandidate: survivors only — a rejected
// candidate never reports one.
/**
 * @param {Candidate} cand
 * @param {ObjSpec} spec
 * @param {Constraint[]} constraints
 * @param {JobCtx} ctx
 * @returns {SurvivorOut}
 */
function survivorOut(cand, spec, constraints, ctx) {
  const fit = fitOfEdits(cand.edits, ctx.fs);
  const preampFull = preampDbFull(cand.stages, ctx.fs, cand.preamp);
  return {
    changes: cand.changes,
    ...(spec.pareto
      ? { scores: Object.fromEntries(spec.objectives.map((o, i) => [o.expr, round(cand.scores[i], 4)])) }
      : { score: round(cand.scores[0], 4) }),
    metrics: Object.fromEntries(Object.entries(cand.values).map(([k, v]) => [k, round(v)])),
    preamp_db: round(cand.preamp, 2),
    preamp_db_full: round(preampFull, 2),
    ...(fit.length ? { fit } : {}),
    ...(constraints.length ? { binding: bindingOf(constraints, cand.values) } : {}),
    process: serializeProcess(cand.stages),
    partial: cand.partial,
    flags: [...guidanceFlags(cand.edits, cand.stages), ...headroomFlags(cand.preamp, preampFull)],
  };
}

// a dominates b when a is at least as good everywhere and strictly better
// somewhere. `signed` is every score flipped to smaller-is-better.
const dominates = (/** @type {number[]} */ a, /** @type {number[]} */ b) =>
  a.every((v, i) => v <= b[i]) && a.some((v, i) => v < b[i]);

// Incremental non-dominated archive. Candidates that no survivor beats on
// every objective at once; the archive stays small in practice.
/**
 * @param {Entry[]} cands
 * @returns {Entry[]}
 */
function paretoFront(cands) {
  /** @type {Entry[]} */
  const front = [];
  for (const c of cands) {
    if (front.some((f) => dominates(f.signed, c.signed))) continue;
    for (let i = front.length - 1; i >= 0; i -= 1) if (dominates(c.signed, front[i].signed)) front.splice(i, 1);
    front.push(c);
  }
  return front;
}

// What the refinement layer (search-space.js) calls back into, carried on the
// env rather than imported, so the dependency between the two runs one way.
const OPS = { scoreCandidate, survivorOut, constraintFailures, paretoFront };

// Best-scoring rejects, ranked by the first objective. What the constraints
// cost, made visible instead of silently counted.
/**
 * @typedef {{ signed: number, score: number, changes: ChangeSet, reasons: Failure[] }} Reject
 */

/**
 * @param {Reject[]} rejects
 * @param {Candidate} cand
 * @param {Failure[]} reasons
 * @returns {void}
 */
function noteReject(rejects, cand, reasons) {
  rejects.push({ signed: cand.signed[0], score: round(cand.scores[0], 4), changes: cand.changes, reasons });
  rejects.sort((a, b) => a.signed - b.signed);
  if (rejects.length > REJECTS_KEPT) rejects.pop();
}

// Per constraint bound, the best candidate rejected by that bound ALONE — the
// one a relaxation of just that constraint would admit.
/**
 * @typedef {{ signed: number, score: number, reason: Failure }} SoleReject
 */

/**
 * @param {Map<string, SoleReject>} sole
 * @param {Candidate} cand
 * @param {Failure} reason
 * @returns {void}
 */
function noteSoleReject(sole, cand, reason) {
  const key = `${reason.metric}:${reason.bound}`;
  const cur = sole.get(key);
  if (!cur || cand.signed[0] < cur.signed) sole.set(key, { signed: cand.signed[0], score: cand.scores[0], reason });
}

// What relaxing each constraint would buy: the relaxation that admits the best
// sole-reject, its score, and its gain over the current winner. Bounds whose
// best sole-reject would not beat the winner are dropped — relaxing them buys
// nothing.
/**
 * @param {Map<string, SoleReject>} sole
 * @param {number | undefined} winnerSigned
 * @returns {{ metric: string, bound: string, limit: number, relax_by: number, score: number, gain?: number }[]}
 */
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
/**
 * @param {ChangeSet[]} combos
 * @param {Env} env
 * @returns {{ rejected: Record<string, number>, rejects: Reject[], sole: Map<string, SoleReject>, survived: Entry[] }}
 */
function sweep(combos, env) {
  const { measure, ctx, spec, constraints } = env;
  /** @type {{ rejected: Record<string, number>, rejects: Reject[], sole: Map<string, SoleReject>, survived: Entry[] }} */
  const acc = { rejected: {}, rejects: [], sole: new Map(), survived: [] };
  for (const changes of combos) {
    const cand = scoreCandidate(measure, changes, ctx, spec);
    const reasons = constraintFailures(constraints, cand.values);
    if (reasons.length) {
      for (const r of reasons) acc.rejected[r.metric] = (acc.rejected[r.metric] || 0) + 1;
      noteReject(acc.rejects, cand, reasons);
      if (reasons.length === 1) noteSoleReject(acc.sole, cand, reasons[0]);
    } else {
      acc.survived.push({ signed: cand.signed, out: survivorOut(cand, spec, constraints, ctx) });
    }
  }
  return acc;
}

/**
 * @param {Entry[]} survived
 * @param {number} keep
 * @param {Env} env
 * @param {{ rspec: RefineSpec | undefined, job: Record<string, any>, common: Record<string, unknown> }} rest
 * @returns {Record<string, unknown>}
 */
function paretoResult(survived, keep, env, { rspec, job, common }) {
  const front = paretoFront(survived).sort((a, b) => a.signed[0] - b.signed[0]);
  let kept = front.slice(0, keep);
  if (rspec) kept = refineFront(kept, rspec, job.space || {}, env);
  return {
    pareto: { objectives: env.spec.objectives.map((o) => ({ direction: o.direction, expr: o.expr })) },
    ...common,
    front_size: front.length,
    returned: kept.length,
    front: kept.map((s) => s.out),
  };
}

/**
 * Grid sweep over a declared change space: every combination is applied,
 * measured and scored, candidates missing a constraint are rejected, and the
 * survivors are ranked and optionally refined. Pareto objectives return the
 * front; a scalar objective returns the top N with the winner's margin over
 * the runner-up and the per-parameter sensitivity of the score.
 *
 * @param {Record<string, any>} job
 * @param {JobCtx} ctx
 * @returns {Record<string, unknown>}
 */
export function searchJob(job, ctx) {
  const spec = parseObjectives(job);
  const space = checkSpace(job);
  const constraints = job.constraints || [];
  const combos = candidates(space);
  // Everything a candidate needs to be measured, scored and judged, carried as
  // one value through the sweep and the refinement passes.
  const env = { measure: makeMeasurer(ctx, combos[0]), ctx, spec, constraints, ...OPS };
  const { rejected, rejects, sole, survived } = sweep(combos, env);
  const keep = job.top ?? 10;
  const common = {
    constraints,
    considered: combos.length,
    survived: survived.length,
    rejected_by: rejected,
    rejected_top: rejects.map(({ score, changes, reasons }) => ({ score, changes, reasons })),
  };
  const rspec = refineSpecOf(job);
  if (spec.pareto) return paretoResult(survived, keep, env, { rspec, job, common });
  survived.sort((a, b) => a.signed[0] - b.signed[0]);
  if (rspec) refineTop(survived, rspec, job.space || {}, env);
  return {
    objective: { direction: spec.objectives[0].direction, expr: spec.objectives[0].expr },
    ...common,
    returned: Math.min(keep, survived.length),
    top: survived.slice(0, keep).map((s) => s.out),
    margin: survived.length > 1 ? round(Math.abs(survived[0].signed[0] - survived[1].signed[0]), 4) : null,
    sensitivity: sensitivityOf(sole, survived.length ? survived[0].signed[0] : undefined),
  };
}

// ---- standalone warm start (kind "refine") ---------------------------------

/**
 * Warm start: refine one explicit seed (typically a previous result's
 * `changes`) inside a declared space, no grid sweep. Scalar objective only —
 * pareto refinement needs a front to cap against, which only a search has.
 *
 * @param {Record<string, any>} job
 * @param {JobCtx} ctx
 * @returns {Record<string, unknown>}
 */
export function refineJob(job, ctx) {
  const spec = parseObjectives(job);
  if (spec.pareto)
    throw new Error(
      'refine: standalone refine takes a scalar "objective" — pareto refinement runs inside a search job via "refine"',
    );
  const constraints = job.constraints || [];
  const given = job.seed || {};
  const seed = copyChanges({
    ...(given.amend ? { amend: asList(given.amend) } : {}),
    ...(given.replace ? { replace: asList(given.replace) } : {}),
    ...(given.append ? { append: asList(given.append) } : {}),
  });
  const coords = coordsOf(job.space || {});
  checkSeed(seed, coords);
  const measure = makeMeasurer(ctx, seed);
  const seedCand = scoreCandidate(measure, seed, ctx, spec);
  const entry = { signed: seedCand.signed, out: survivorOut(seedCand, spec, constraints, ctx) };
  const rspec = refineSpecOf(job) || {};
  const refined = refineEntry(entry, coords, { measure, ctx, spec, constraints, ...OPS }, refineOptsOf(rspec));
  return {
    objective: { direction: spec.objectives[0].direction, expr: spec.objectives[0].expr },
    constraints,
    seed: { changes: seed, score: round(seedCand.scores[0], 4) },
    best: refined.out,
  };
}
