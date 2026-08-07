// The continuous refinement layer: a discrete change space mapped onto the unit
// box, a deterministic descent across that box, and the scoring that judges the
// walk.
//
// Measurement, scoring and ranking reach this module through the `env` object
// its entry points already carry, so nothing here imports the sweep it serves.

import { round } from "./curve.js";
import { refinePoint } from "./refine.js";
import { expandValue } from "./space.js";

/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").MatrixStage} MatrixStage */
/** @typedef {import("./curve.js").Curve} Curve */
/** @typedef {import("./chain.js").Edit} Edit */
/** @typedef {import("./jobs.js").JobCtx} JobCtx */
/** @typedef {import("./space.js").Space} Space */
/** @typedef {import("./guidance.js").Flag} Flag */

/**
 * One change set as this module handles it.
 *
 * The band objects inside carry whatever parameters the space declared, so
 * their values stay `any`: the coordinate machinery below addresses them by
 * string path (`group`/`i`/`j`/`key`) and never interprets what it finds.
 *
 * @typedef {{ amend?: any[], replace?: any[], append?: any[] }} ChangeSet
 */

/**
 * One parsed objective: which way to go, the expression's AST, and its source
 * text (which doubles as the objective's name in pareto output).
 *
 * @typedef {{ direction: string, ast: import("./expr.js").Node, expr: string }} Objective
 */

/**
 * Scalar or pareto, plus the objectives themselves. `pareto` is the
 * discriminant that decides whether output carries one `score` or a `scores`
 * map.
 *
 * @typedef {{ pareto: boolean, objectives: Objective[] }} ObjSpec
 */

/**
 * One declared hard constraint. At least one bound is present; both may be.
 *
 * @typedef {{ metric: string, min?: number, max?: number }} Constraint
 */

/**
 * One bound a candidate missed, and by how much.
 *
 * @typedef {{ metric: string, bound: string, limit: number, by: number }} Failure
 */

/**
 * A measured, scored candidate. `scores` is per objective in each objective's
 * own direction; `signed` is the same flipped so smaller is always better.
 *
 * @typedef {{
 *   changes: ChangeSet,
 *   stages: MatrixStage[],
 *   edits: Edit[],
 *   values: Record<string, number>,
 *   preamp: number,
 *   partial: boolean,
 *   scores: number[],
 *   signed: number[],
 * }} Candidate
 */

/**
 * One survivor as it appears in the job's JSON. `refined` and `violations` are
 * written afterwards by the refinement pass, and are absent on a plain sweep.
 *
 * @typedef {{
 *   changes: ChangeSet,
 *   score?: number,
 *   scores?: Record<string, number>,
 *   metrics: Record<string, number>,
 *   preamp_db: number,
 *   preamp_db_full: number,
 *   fit?: ReturnType<typeof import("./fit.js").fitOfEdits>,
 *   binding?: { metric: string, bound: string, slack: number } | null,
 *   process: string,
 *   partial: boolean,
 *   flags: Flag[],
 *   refined?: { from_score: number, score: number, evals: number, converged: boolean, improved: boolean },
 *   violations?: Failure[],
 * }} SurvivorOut
 */

/**
 * A survivor carried through ranking: its signed scores alongside its output.
 *
 * @typedef {{ signed: number[], out: SurvivorOut }} Entry
 */

/**
 * One free coordinate of a space, and the box it moves in. `j` is present only
 * for a replace spec's `with` bands. `lo`/`hi` are already in the coordinate's
 * own space — log for f and Q, linear otherwise.
 *
 * @typedef {{ group: string, i: number, j?: number, key: string, lo: number, hi: number, log: boolean }} Coord
 */

/**
 * A prepared measurer: a change set in, the resolved chain and its summed
 * curve out.
 *
 * @typedef {(changes: ChangeSet) => { stages: MatrixStage[], edits: Edit[], curve: Curve }} Measurer
 */

/**
 * Everything a candidate needs to be measured, scored and judged.
 *
 * The four operations travel as values rather than imports, which is what lets
 * the dependency between this module and the sweep run one way.
 *
 * @typedef {{
 *   measure: Measurer,
 *   ctx: JobCtx,
 *   spec: ObjSpec,
 *   constraints: Constraint[],
 *   scoreCandidate: (measure: Measurer, changes: ChangeSet, ctx: JobCtx, spec: ObjSpec) => Candidate,
 *   survivorOut: (cand: Candidate, spec: ObjSpec, constraints: Constraint[], ctx: JobCtx) => SurvivorOut,
 *   constraintFailures: (constraints: Constraint[], values: Record<string, number>) => Failure[],
 *   paretoFront: (cands: Entry[]) => Entry[],
 * }} Env
 */

/**
 * One value, a list of them, or nothing, as a list — the shape every change
 * group is written in.
 *
 * @template T
 * @param {T | T[] | undefined} x
 * @returns {T[]}
 */
export const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

// ---- continuous refinement (job.refine / kind "refine") --------------------
//
// The grid winner seeds a deterministic local descent (refine.js) over every
// parameter the space declared more than one value for. Bounds are that
// parameter's declared min/max — refinement sharpens INSIDE the declared box,
// never leaves it; widening the box is the caller's move, made in the space.
// f and Q move in log space, everything else linearly.

const LOG_PARAMS = new Set(["f", "q"]);

// Slack for the pareto no-worsening caps only: decode(encode(seed)) reproduces
// the seed to ~1e-12, and without this a refined entry could be rejected for a
// float-noise "worsening" of an objective it never touched.
const CAP_EPS = 1e-9;

// Constraint violations are scored in their own (dB-scale) units; the factor
// only has to dwarf any real objective improvement.
const PENALTY = 1e3;

/**
 * @param {string} group
 * @param {Record<string, any> | null | undefined} spec
 * @param {number} i
 * @param {number} [j]
 * @returns {Coord[]}
 */
function coordsOfSpec(group, spec, i, j) {
  /** @type {Coord[]} */
  const out = [];
  const fields = spec || {};
  for (const key of Object.keys(fields)) {
    if (key === "select") continue;
    const values = expandValue(fields[key]);
    if (values.length < 2 || !values.every((v) => typeof v === "number")) continue;
    const [lo, hi] = [Math.min(...values), Math.max(...values)];
    const log = LOG_PARAMS.has(key) && lo > 0;
    out.push({
      group,
      i,
      ...(j === undefined ? {} : { j }),
      key,
      lo: log ? Math.log(lo) : lo,
      hi: log ? Math.log(hi) : hi,
      log,
    });
  }
  return out;
}

/**
 * Every free coordinate of a space: (group, spec index[, band index],
 * parameter) plus its box. Parameters given a single literal stay fixed;
 * non-numeric lists (e.g. a type sweep) are grid-only. A replace spec's free
 * coordinates live on its `with` bands; `remove` is literal by definition.
 *
 * @param {Space} space
 * @returns {Coord[]}
 */
export function coordsOf(space) {
  const amend = asList(space.amend).flatMap((spec, i) => coordsOfSpec("amend", spec, i));
  const replace = asList(space.replace).flatMap((spec, i) =>
    asList(spec.with).flatMap((band, j) => coordsOfSpec("replace", band, i, j)),
  );
  const append = asList(space.append).flatMap((spec, i) => coordsOfSpec("append", spec, i));
  const coords = [...amend, ...replace, ...append];
  if (!coords.length)
    throw new Error("refine: space declares no numeric parameter with more than one value — nothing to refine");
  return coords;
}

// The change object a coordinate addresses: the spec itself, or one of a
// replace spec's `with` bands.
/**
 * @param {ChangeSet} changes
 * @param {Coord} c
 * @returns {Record<string, any>}
 */
const slotOf = (changes, c) => {
  const group = /** @type {any[]} */ (changes[/** @type {keyof ChangeSet} */ (c.group)]);
  return c.j === undefined ? group[c.i] : group[c.i].with[c.j];
};

/**
 * Changes -> unit-box vector. A warm-start seed outside the box lands outside
 * [0,1] here; the optimizers clamp, so descent starts from the box edge.
 *
 * @param {ChangeSet} changes
 * @param {Coord[]} coords
 * @returns {number[]}
 */
const encode = (changes, coords) =>
  coords.map((c) => {
    const v = slotOf(changes, c)[c.key];
    const t = c.log ? Math.log(v) : v;
    return c.hi === c.lo ? 0 : (t - c.lo) / (c.hi - c.lo);
  });

/**
 * Deep copy of a change set, down to a replace spec's `with` bands.
 *
 * @param {ChangeSet} changes
 * @returns {ChangeSet}
 */
export function copyChanges(changes) {
  return {
    ...(changes.amend ? { amend: changes.amend.map((c) => ({ ...c })) } : {}),
    ...(changes.replace
      ? { replace: changes.replace.map((r) => ({ ...r, with: asList(r.with).map((b) => ({ ...b })) })) }
      : {}),
    ...(changes.append ? { append: changes.append.map((c) => ({ ...c })) } : {}),
  };
}

/**
 * Unit-box vector -> changes, free coordinates written over a copy of the seed.
 *
 * @param {number[]} x
 * @param {ChangeSet} seed
 * @param {Coord[]} coords
 * @returns {ChangeSet}
 */
function decode(x, seed, coords) {
  const out = copyChanges(seed);
  coords.forEach((c, k) => {
    const t = c.lo + x[k] * (c.hi - c.lo);
    slotOf(out, c)[c.key] = round(c.log ? Math.exp(t) : t, 6);
  });
  return out;
}

// Total violation: declared constraints plus, in pareto mode, the caps that
// forbid worsening any objective past the seed's own value.
/**
 * @param {Candidate} cand
 * @param {Constraint[]} constraints
 * @param {number[] | null} caps
 * @param {Env["constraintFailures"]} constraintFailures
 * @returns {number}
 */
function penaltyOf(cand, constraints, caps, constraintFailures) {
  let p = 0;
  for (const r of constraintFailures(constraints, cand.values)) p += r.by;
  if (caps) for (let i = 1; i < cand.signed.length; i += 1) p += Math.max(0, cand.signed[i] - caps[i] - CAP_EPS);
  return p;
}

/**
 * Refine one survivor in place: descend from its changes, keep the endpoint
 * only when it is feasible and strictly better on the (penalized) first
 * objective. Every entry comes back carrying a `refined` block; an infeasible
 * seed (standalone warm start) additionally reports its `violations`.
 *
 * @param {Entry} entry
 * @param {Coord[]} coords
 * @param {Env} env
 * @param {{ maxEvals?: number, tol?: number }} opts
 * @returns {Entry}
 */
export function refineEntry(entry, coords, env, opts) {
  const { measure, ctx, spec, constraints, scoreCandidate, survivorOut, constraintFailures } = env;
  const seed = entry.out.changes;
  const caps = spec.pareto ? entry.signed : null;
  const objective = (/** @type {ChangeSet} */ changes) => {
    const cand = scoreCandidate(measure, changes, ctx, spec);
    return { cand, val: cand.signed[0] + PENALTY * penaltyOf(cand, constraints, caps, constraintFailures) };
  };
  const r = refinePoint((x) => objective(decode(x, seed, coords)).val, encode(seed, coords), opts);
  const seedPt = objective(seed);
  const endPt = objective(decode(r.x, seed, coords));
  const improved = endPt.val < seedPt.val && penaltyOf(endPt.cand, constraints, caps, constraintFailures) === 0;
  const pick = improved ? endPt : seedPt;
  const out = survivorOut(pick.cand, spec, constraints, ctx);
  out.refined = {
    from_score: round(seedPt.cand.scores[0], 4),
    score: round(pick.cand.scores[0], 4),
    evals: r.evals,
    converged: r.converged,
    improved,
  };
  const violations = constraintFailures(constraints, pick.cand.values);
  if (violations.length) out.violations = violations;
  return { signed: pick.cand.signed, out };
}

// `"refine": true` means "with defaults".
/**
 * @typedef {{ max_evals?: number, tol?: number, survivors?: number }} RefineSpec
 */

/** The job's refine block, an empty spec where it is `true`, undefined where no refinement was asked for. */
export const refineSpecOf = (/** @type {Record<string, any>} */ job) =>
  /** @type {RefineSpec | undefined} */ (job.refine === true ? {} : job.refine);

/** Descent settings from a refine spec: evaluation budget and convergence tolerance, defaulted. */
export const refineOptsOf = (/** @type {RefineSpec} */ spec) => ({
  maxEvals: spec.max_evals ?? 600,
  tol: spec.tol ?? 1e-5,
});

/**
 * Scalar mode: refine the top-N survivors, then re-rank — a refined runner-up
 * may overtake the grid winner.
 *
 * @param {Entry[]} survived
 * @param {RefineSpec} rspec
 * @param {Space} space
 * @param {Env} env
 * @returns {void}
 */
export function refineTop(survived, rspec, space, env) {
  const coords = coordsOf(space);
  const opts = refineOptsOf(rspec);
  const n = Math.min(rspec.survivors ?? 3, survived.length);
  for (let i = 0; i < n; i += 1) survived[i] = refineEntry(survived[i], coords, env, opts);
  survived.sort((a, b) => a.signed[0] - b.signed[0]);
}

/**
 * Pareto mode: refine each returned front member under no-worsening caps on
 * the other objectives, then prune — a refined member can come to dominate
 * another.
 *
 * @param {Entry[]} entries
 * @param {RefineSpec} rspec
 * @param {Space} space
 * @param {Env} env
 * @returns {Entry[]}
 */
export function refineFront(entries, rspec, space, env) {
  const coords = coordsOf(space);
  const opts = refineOptsOf(rspec);
  const refined = entries.map((e) => refineEntry(e, coords, env, opts));
  return env.paretoFront(refined).sort((a, b) => a.signed[0] - b.signed[0]);
}

/**
 * Throws unless the seed carries a number at every free coordinate of the
 * space — a warm start has to mirror the space's change specs to be encodable.
 *
 * @param {ChangeSet} seed
 * @param {Coord[]} coords
 * @returns {void}
 */
export function checkSeed(seed, coords) {
  for (const c of coords) {
    const group = /** @type {any[] | undefined} */ (seed[/** @type {keyof ChangeSet} */ (c.group)]);
    const spec = (group || [])[c.i];
    const change = c.j === undefined ? spec : spec && asList(spec.with)[c.j];
    if (!change || typeof change[c.key] !== "number")
      throw new Error(
        `refine: seed carries no numeric "${c.key}" for ${c.group} spec ${c.i}${
          c.j === undefined ? "" : ` band ${c.j}`
        } — the seed must mirror the space's change specs`,
      );
  }
}
