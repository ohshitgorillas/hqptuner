// Behavioral suite for eqlab's continuous-refinement feature — the pure
// optimizers in scripts/eqlab/refine.js and the `refine` paths through
// scripts/eqlab/search.js. Written blind from a spec block: no eqlab source
// was read.
//
// Search spaces follow the search suites' trick: one peaking band at 1 kHz
// and an `at` metric reading the curve right at its centre, so a candidate
// that sets the band to g dB scores spot ≈ g. The refined objective is the
// expr metric spot², whose continuous minimum (g = 0) falls between the grid
// points of a [-1, 1, 0.4] sweep — refinement must leave the grid to reach it.
//
// Run: node --test tests/js/eqlab-refine.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { coordinateDescent, nelderMead, refinePoint } from "../../../scripts/eqlab/refine.js";
import { searchJob, refineJob } from "../../../scripts/eqlab/search.js";
import { applyChanges } from "../../../scripts/eqlab/chain.js";
import { FS, near, below, band, argNum } from "../support/eqlab-helpers.js";

/** @typedef {import("../../../scripts/eqlab/search-space.js").SurvivorOut} SurvivorOut */
/** @typedef {import("../../../scripts/eqlab/search-space.js").ChangeSet} ChangeSet */
/** @typedef {import("../../../scripts/eqlab/search-space.js").Objective} Objective */

/**
 * A survivor from a refined run, where the four optional keys a refinement
 * pass writes are all present.
 *
 * @typedef {SurvivorOut & Required<Pick<SurvivorOut, "refined" | "score" | "scores" | "violations">>} RefinedOut
 */

/** @typedef {{ top: RefinedOut[] }} RefinedSearch */
/** @typedef {{ top: SurvivorOut[] }} PlainSearch */

// --- pure optimizers ---------------------------------------------------------

// Smooth, convex, minimum at (0.3, 0.7) inside the unit box.
/**
 * @param {number[]} x
 * @returns {number}
 */
const BOWL = (x) => (x[0] - 0.3) ** 2 + (x[1] - 0.7) ** 2;
const OPTIMUM = [0.3, 0.7];
/** @type {[string, typeof refinePoint][]} */
const OPTIMIZERS = [
  ["coordinate_descent", coordinateDescent],
  ["nelder_mead", nelderMead],
  ["refine_point", refinePoint],
];

/**
 * @param {number[]} x
 * @returns {number}
 */
const coordErr = (x) => Math.max(...x.map((v, i) => Math.abs(v - OPTIMUM[i])));

test("test_coordinate_descent_finds_the_minimum_of_a_convex_bowl", () => {
  const err = coordErr(coordinateDescent(BOWL, [0.9, 0.1]).x);
  assert.ok(...below(err, 5e-3 + 1e-12));
});

test("test_nelder_mead_finds_the_minimum_of_a_convex_bowl", () => {
  const err = coordErr(nelderMead(BOWL, [0.9, 0.1]).x);
  assert.ok(...below(err, 5e-3 + 1e-12));
});

test("test_nelder_mead_reports_convergence_on_a_convex_bowl", () => {
  assert.equal(nelderMead(BOWL, [0.9, 0.1]).converged, true);
});

test("test_refine_point_never_returns_worse_than_the_clamped_start", () => {
  const clamped = BOWL([1, 0]); // [1.2, -0.1] clamped into the unit box
  const result = refinePoint(BOWL, [1.2, -0.1]);
  assert.ok(result.fx <= clamped, `expected fx <= ${clamped}, got ${result.fx}`);
});

for (const [name, opt] of OPTIMIZERS) {
  test(`test_${name}_is_deterministic_across_identical_calls`, () => {
    assert.deepEqual(opt(BOWL, [0.55, 0.15]), opt(BOWL, [0.55, 0.15]));
  });

  test(`test_${name}_never_evaluates_outside_the_unit_box`, () => {
    /** @type {number[][]} */
    const seen = [];
    opt(
      (/** @type {number[]} */ x) => {
        seen.push([...x]);
        return BOWL(x);
      },
      [1.5, -0.2],
    );
    assert.ok(
      seen.every((x) => x.every((v) => v >= 0 && v <= 1)),
      `saw out-of-box evaluation among ${JSON.stringify(seen.filter((x) => x.some((v) => v < 0 || v > 1)))}`,
    );
  });

  test(`test_${name}_reports_evals_equal_to_actual_callback_invocations`, () => {
    let calls = 0;
    const result = opt(
      (/** @type {number[]} */ x) => {
        calls += 1;
        return BOWL(x);
      },
      [0.4, 0.6],
    );
    assert.equal(result.evals, calls);
  });
}

test("test_coordinate_descent_stays_within_its_eval_budget", () => {
  let calls = 0;
  coordinateDescent(
    (/** @type {number[]} */ x) => {
      calls += 1;
      return BOWL(x);
    },
    [0.9, 0.1],
    { maxEvals: 40 },
  );
  assert.ok(calls <= 40, `expected <= 40 objective calls, got ${calls}`);
});

// --- scalar search with refine -----------------------------------------------

const BASE = [band(1000, 0, 1)];
const METRICS = { spot: { kind: "at", f: 1000 }, sq: { kind: "expr", expr: "spot * spot" } };
const CTX = { stages: BASE, fs: FS, metrics: METRICS };
const GRID = [-1, -0.6, -0.2, 0.2, 0.6, 1];
const SPACE = { amend: [{ select: 1000, g: [-1, 1, 0.4], q: 1 }] };
/**
 * @param {Record<string, unknown>} [over]
 * @returns {Record<string, unknown>}
 */
const jobOf = (over) => ({ space: SPACE, constraints: [], objective: "minimize sq", top: 5, refine: true, ...over });

/**
 * @param {ChangeSet} changes
 * @returns {number}
 */
const gOf = (changes) => argNum(applyChanges(BASE, changes).stages[0], "g");

const RES = /** @type {RefinedSearch} */ (searchJob(jobOf(), CTX));
const WINNER = RES.top[0];
const NOIMP = /** @type {RefinedSearch} */ (searchJob(jobOf({ objective: "minimize spot" }), CTX));
// No refine key at all — the unrefined reference run.
const PLAIN = /** @type {PlainSearch} */ (
  searchJob({ space: SPACE, constraints: [], objective: "minimize spot", top: 5 }, CTX)
);
const CONNED = /** @type {RefinedSearch} */ (
  searchJob(
    jobOf({
      constraints: [{ metric: "spot", min: 0.1 }],
      refine: { survivors: 3, max_evals: 600, tol: 1e-6 },
    }),
    CTX,
  )
);

test("test_refinement_beats_a_grid_that_straddles_the_continuous_optimum", () => {
  assert.ok(...below(WINNER.refined.score, WINNER.refined.from_score));
});

test("test_the_refined_winner_lands_off_the_grid", () => {
  const g = gOf(WINNER.changes);
  assert.ok(
    GRID.every((v) => Math.abs(g - v) > 1e-6),
    `expected an off-grid g, got ${g}`,
  );
});

test("test_the_refined_winner_stays_inside_the_declared_bounds", () => {
  const g = gOf(WINNER.changes);
  assert.ok(g >= -1 && g <= 1, `expected g in [-1, 1], got ${g}`);
});

test("test_a_refined_entry_carries_the_refinement_record_keys", () => {
  const missing = ["converged", "evals", "from_score", "improved", "score"].filter((k) => !(k in WINNER.refined));
  assert.deepEqual(missing, []);
});

test("test_entries_beyond_the_default_survivor_count_carry_no_refined_block", () => {
  assert.ok(!("refined" in RES.top[3]), `expected no refined key, got ${Object.keys(RES.top[3])}`);
});

test("test_a_fruitless_refinement_reports_improved_false", () => {
  assert.equal(NOIMP.top[0].refined.improved, false);
});

test("test_a_fruitless_refinement_keeps_the_grid_score", () => {
  assert.equal(NOIMP.top[0].refined.score, NOIMP.top[0].refined.from_score);
});

test("test_a_fruitless_refinement_keeps_the_exact_grid_changes", () => {
  assert.deepEqual(NOIMP.top[0].changes, PLAIN.top[0].changes);
});

test("test_a_refined_winner_still_satisfies_its_constraints", () => {
  const spot = CONNED.top[0].metrics.spot;
  assert.ok(spot >= 0.1, `expected spot >= 0.1, got ${spot}`);
});

// Re-ranking, with the swap forced: `type` is a string list, a grid-only
// dimension refinement cannot cross, so the two survivor families refine
// independently. The base band leaves ~+1 dB at 4 kHz; curve()-verified grid
// scores are peak(g=-2.4) sq=0.50 (grid winner), hshelf(g=-0.1) sq=0.81
// (runner-up), peak(g=-0.1) sq=0.98, hshelf(g=-2.4) sq=1.93. The peak family
// bottoms out at its g bound (sq=0.50), while the hshelf family nulls 4 kHz
// near g=-1 (sq≈0.000) — after refinement the hshelf runner-up must lead.
const RANK = /** @type {RefinedSearch} */ (
  searchJob(
    {
      space: { append: [{ type: ["peak", "hshelf"], f: 1000, q: 0.7, g: [-2.4, -0.1] }] },
      constraints: [],
      objective: "minimize sq4k",
      top: 4,
      refine: { survivors: 2 },
    },
    { stages: [band(4000, 1, 1)], fs: FS, metrics: { sq4k: { kind: "expr", expr: "at(4000) * at(4000)" } } },
  )
);

test("test_a_refined_runner_up_that_beats_the_grid_winner_moves_to_the_top", () => {
  assert.ok(
    /hshelf/.test(JSON.stringify(RANK.top[0].changes)),
    `expected the refined hshelf runner-up at top[0], got ${JSON.stringify(RANK.top[0].changes)}`,
  );
});

test("test_refine_true_means_refine_with_defaults", () => {
  assert.ok("refined" in RES.top[0], `expected a refined key, got ${Object.keys(RES.top[0])}`);
});

test("test_a_space_with_nothing_to_refine_throws", () => {
  const fixed = { amend: [{ select: 1000, g: 0.5, q: 1 }] };
  assert.throws(() => searchJob(jobOf({ space: fixed }), CTX), /nothing/i);
});

test("test_a_refined_search_is_deterministic_end_to_end", () => {
  assert.deepEqual(searchJob(jobOf(), CTX), searchJob(jobOf(), CTX));
});

// --- pareto search with refine -----------------------------------------------
//
// Two genuinely independent objectives: the appended band's f is searched
// between two well-separated frequencies and each objective reads the curve
// at one of them (minimize the 150 Hz level, maximize the 4 kHz level). A
// q=1 peak leaks almost nothing 4.7 octaves away, so a 4 kHz cut candidate
// is strictly worse on BOTH axes than a 150 Hz cut — dominated grid
// candidates exist, the front is a real pruning, and the survivors (cut at
// 150, boost at 4 kHz) genuinely trade off.

const PCTX = {
  stages: [],
  fs: FS,
  metrics: { a: { kind: "at", f: 150 }, b: { kind: "expr", expr: "0 - at(4000)" } },
};
const PRES = /** @type {{ front: RefinedOut[], pareto: { objectives: Objective[] } }} */ (
  searchJob(
    {
      space: { append: [{ type: "peak", f: [150, 4000], q: 1, g: [-2, 2, 2] }] },
      constraints: [],
      pareto: ["minimize a", "minimize b"],
      top: 6,
      refine: true,
    },
    PCTX,
  )
);

test("test_every_refined_front_entry_carries_a_refined_block", () => {
  assert.ok(
    PRES.front.every((entry) => "refined" in entry),
    `expected refined on every front entry, got ${JSON.stringify(PRES.front.map((e) => Object.keys(e)))}`,
  );
});

test("test_pareto_refinement_never_worsens_the_first_objective", () => {
  assert.ok(
    PRES.front.every((entry) => entry.refined.score <= entry.refined.from_score),
    `expected score <= from_score on every entry, got ${JSON.stringify(PRES.front.map((e) => e.refined))}`,
  );
});

test("test_refined_front_entries_remain_mutually_non_dominated", () => {
  /**
   * @param {RefinedOut} p
   * @param {RefinedOut} q
   * @returns {boolean}
   */
  const dominates = (p, q) =>
    PRES.pareto.objectives.every((o) => p.scores[o.expr.trim()] <= q.scores[o.expr.trim()]) &&
    PRES.pareto.objectives.some((o) => p.scores[o.expr.trim()] < q.scores[o.expr.trim()]);
  assert.ok(
    PRES.front.every((p) => PRES.front.every((q) => p === q || !dominates(p, q))),
    `found a dominated front entry among ${JSON.stringify(PRES.front.map((e) => e.scores))}`,
  );
});

// --- standalone refineJob ----------------------------------------------------

const RJOB = {
  seed: { amend: [{ select: 1000, g: 0.6, q: 1 }] },
  space: SPACE,
  constraints: [],
  objective: "minimize sq",
};
const RJ = /** @type {{ seed: RefinedOut, best: RefinedOut }} */ (refineJob(RJOB, CTX));

test("test_refine_job_echoes_the_seeds_score", () => {
  assert.ok(...near(RJ.seed.score, 0.36, 0.02));
});

test("test_refine_job_echoes_the_seeds_changes", () => {
  assert.ok(...near(gOf(RJ.seed.changes), 0.6, 1e-9));
});

test("test_refine_job_best_carries_the_full_entry_shape", () => {
  const missing = ["changes", "metrics", "process", "refined"].filter((k) => !(k in RJ.best));
  assert.deepEqual(missing, []);
});

test("test_refine_job_best_never_scores_worse_than_the_seed", () => {
  assert.ok(RJ.best.score <= RJ.seed.score, `expected ${RJ.best.score} <= ${RJ.seed.score}`);
});

test("test_refine_job_best_stays_inside_the_declared_bounds", () => {
  const g = gOf(RJ.best.changes);
  assert.ok(g >= -1 && g <= 1, `expected g in [-1, 1], got ${g}`);
});

test("test_refine_job_rejects_pareto_objectives", () => {
  assert.throws(
    () =>
      refineJob(
        {
          seed: { append: [{ type: "peak", f: 1000, q: 1, g: 2 }] },
          space: { append: [{ type: "peak", f: 1000, q: 1, g: [1, 3, 1] }] },
          constraints: [],
          pareto: ["minimize a", "minimize b"],
        },
        PCTX,
      ),
    /pareto|scalar/i,
  );
});

test("test_refine_job_names_a_searchable_parameter_the_seed_is_missing", () => {
  const bare = { seed: { amend: [{ select: 1000, q: 1 }] }, space: SPACE, constraints: [], objective: "minimize sq" };
  assert.throws(() => refineJob(bare, CTX), /(^|[^a-z])g([^a-z]|$)/i);
});

const HOPELESS = /** @type {{ best: RefinedOut }} */ (
  refineJob({ ...RJOB, constraints: [{ metric: "spot", min: 5 }] }, CTX)
);

test("test_unsatisfiable_constraints_yield_violations_naming_the_metric", () => {
  assert.equal(HOPELESS.best.violations[0].metric, "spot");
});

test("test_unsatisfiable_constraints_yield_violations_naming_the_bound", () => {
  assert.equal(HOPELESS.best.violations[0].bound, "min");
});
