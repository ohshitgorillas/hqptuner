// Behavioral suite for scripts/eqlab/search.js — pareto fronts, binding
// constraints, margin, sensitivity and ranked rejects. Written blind from a
// spec block: no eqlab source was read.
//
// Every space appends one peaking band at 1 kHz onto an EMPTY base chain, and
// the `a` metric reads the curve right at that centre — a single band's summed
// response at its own centre equals its gain, so a candidate with g dB scores
// a ≈ g and constraint arithmetic reads straight off the values list. The
// second axis is always an expr metric derived from `a`: `a + 1` agrees with
// it (dominance collapses the front), `0 - a` opposes it (nothing dominates).
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-search-pareto.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { searchJob, REJECTS_KEPT } from "../../../scripts/eqlab/search.js";
import { FS, near, above } from "../support/eqlab-helpers.js";

/** @typedef {import("../../../scripts/eqlab/metrics.js").MetricSpec} MetricSpec */
/** @typedef {import("../../../scripts/eqlab/jobs.js").JobCtx} JobCtx */
/** @typedef {import("../../../scripts/eqlab/search-space.js").ChangeSet} ChangeSet */
/** @typedef {import("../../../scripts/eqlab/search-space.js").Failure} Failure */
/** @typedef {import("../../../scripts/eqlab/search-space.js").Objective} Objective */
/** @typedef {import("../../../scripts/eqlab/search-space.js").SurvivorOut} SurvivorOut */

/** @typedef {NonNullable<SurvivorOut["binding"]>} Binding */

/**
 * A scalar-mode survivor: `score` and, under constraints, `binding` are written.
 *
 * @typedef {SurvivorOut & { score: number, binding: Binding }} TopOut
 */

/**
 * A pareto-front survivor: per-objective `scores` in place of the scalar score.
 *
 * @typedef {SurvivorOut & { scores: Record<string, number>, binding: Binding }} FrontOut
 */

/** @typedef {{ metric: string, bound: string, limit: number, relax_by: number, score: number, gain: number }} Sensitivity */
/** @typedef {{ signed: number, score: number, changes: ChangeSet, reasons: Failure[] }} Reject */

/**
 * @typedef {{
 *   top: TopOut[],
 *   margin: number | null,
 *   sensitivity: Sensitivity[],
 *   rejected_top: Reject[],
 *   rejected_by: Record<string, number>,
 * }} ScalarResult
 */

/**
 * @typedef {{
 *   front: FrontOut[],
 *   front_size: number,
 *   survived: number,
 *   returned: number,
 *   pareto: { objectives: Objective[] },
 * }} ParetoResult
 */

/** @type {Record<string, MetricSpec>} */
const AT = { a: { kind: "at", f: 1000 } };
/** @type {Record<string, MetricSpec>} */
const AGREE = { a: { kind: "at", f: 1000 }, b: { kind: "expr", expr: "a + 1" } };
/** @type {Record<string, MetricSpec>} */
const TRADE = { a: { kind: "at", f: 1000 }, b: { kind: "expr", expr: "0 - a" } };

/**
 * @param {Record<string, MetricSpec>} metrics
 * @returns {JobCtx}
 */
const ctxOf = (metrics) => ({ stages: [], fs: FS, metrics });

/**
 * @param {number[]} gains
 * @returns {Record<string, unknown>}
 */
const spaceOf = (gains) => ({ append: [{ type: "peak", f: 1000, q: 1, g: { values: gains } }] });
const G123 = spaceOf([1, 2, 3]);

/**
 * @param {Record<string, unknown>} [over]
 * @param {Record<string, MetricSpec>} [metrics]
 * @returns {ScalarResult}
 */
const scalar = (over = {}, metrics = AT) =>
  /** @type {ScalarResult} */ (
    searchJob({ kind: "search", space: G123, objective: "maximize a", top: 5, ...over }, ctxOf(metrics))
  );

/**
 * @param {string[]} objectives
 * @param {Record<string, unknown>} [over]
 * @param {Record<string, MetricSpec>} [metrics]
 * @returns {ParetoResult}
 */
const pareto = (objectives, over = {}, metrics = TRADE) =>
  /** @type {ParetoResult} */ (
    searchJob({ kind: "search", space: G123, pareto: objectives, top: 5, ...over }, ctxOf(metrics))
  );

const OPEN = scalar();
const MIN = scalar({ objective: "minimize a" });
const ONE = scalar({ space: spaceOf([2]) });
const SINGLECON = scalar({ constraints: [{ metric: "a", max: 10 }] });
const TWOCON = scalar({
  constraints: [
    { metric: "a", max: 10 },
    { metric: "a", min: 1 },
  ],
});
const MAXCAP = scalar({ constraints: [{ metric: "a", max: 2.5 }] });
const MINCAP = scalar({ objective: "minimize a", constraints: [{ metric: "a", max: 2.5 }] });
const TIGHT = scalar({ constraints: [{ metric: "a", max: 1.5 }] });
const NOSURV = scalar({ constraints: [{ metric: "a", max: 0.5 }] });
const DUALVIOL = scalar(
  {
    constraints: [
      { metric: "a", max: 2.5 },
      { metric: "b", max: 3.5 },
    ],
  },
  AGREE,
);
const CAPMANY = scalar({
  space: spaceOf(Array.from({ length: REJECTS_KEPT + 3 }, (_, i) => i + 1)),
  constraints: [{ metric: "a", max: 0 }],
});

const PTRADE = pareto(["maximize a", "maximize b"]);
// Under b = 0 - a, minimize/minimize trades off exactly like maximize/maximize.
const PMINTRADE = pareto(["minimize a", "minimize b"]);
const PTRADE2 = pareto(["maximize a", "maximize b"], { top: 2 });
const PAGREE = pareto(["maximize a", "maximize b"], {}, AGREE);
const PMIN = pareto(["minimize a", "minimize b"], {}, AGREE);
const PECHO = pareto(["minimize a", "maximize b"]);
const PBIND = pareto(["maximize a", "maximize b"], { constraints: [{ metric: "a", max: 10 }] });

// --- pareto job shape --------------------------------------------------------

test("test_a_pareto_job_echoes_its_parsed_objectives", () => {
  assert.deepEqual(
    PECHO.pareto.objectives.map((o) => `${o.direction} ${o.expr.trim()}`),
    ["minimize a", "maximize b"],
  );
});

test("test_giving_both_objective_and_pareto_throws", () => {
  assert.throws(
    () =>
      searchJob(
        { kind: "search", space: G123, objective: "maximize a", pareto: ["maximize a", "maximize b"], top: 5 },
        ctxOf(TRADE),
      ),
    /pareto/i,
  );
});

test("test_a_pareto_list_with_a_single_objective_throws", () => {
  assert.throws(() => pareto(["maximize a"]), /pareto/i);
});

test("test_a_pareto_result_carries_a_front", () => {
  assert.ok("front" in PTRADE, `expected a front key, got ${Object.keys(PTRADE)}`);
});

test("test_a_pareto_result_carries_no_top_list", () => {
  assert.ok(!("top" in PTRADE), `expected no top key, got ${Object.keys(PTRADE)}`);
});

// --- dominance ---------------------------------------------------------------

test("test_a_candidate_worse_on_every_objective_stays_out_of_the_front", () => {
  assert.equal(PAGREE.front_size, 1);
});

test("test_the_sole_front_member_of_agreeing_objectives_is_the_best_one", () => {
  assert.ok(...near(PAGREE.front[0].scores["a"], 3, 0.05));
});

test("test_candidates_that_trade_off_are_all_kept_in_the_front", () => {
  assert.equal(PTRADE.front_size, PTRADE.survived);
});

test("test_a_three_way_trade_off_front_holds_all_three_candidates", () => {
  assert.equal(PTRADE.front_size, 3);
});

test("test_returned_matches_the_front_when_top_is_not_the_limit", () => {
  assert.equal(PTRADE.returned, 3);
});

test("test_the_front_is_whole_when_top_is_not_the_limit", () => {
  assert.equal(PTRADE.front.length, 3);
});

test("test_the_front_is_sorted_by_the_first_objective", () => {
  const first = PTRADE.front.map((entry) => entry.scores["a"]);
  assert.deepEqual(
    first,
    [...first].sort((x, y) => y - x),
  );
});

test("test_the_best_candidate_on_the_first_objective_leads_the_front", () => {
  assert.ok(...near(PTRADE.front[0].scores["a"], 3, 0.05));
});

test("test_a_minimizing_first_objective_puts_the_smallest_score_first", () => {
  assert.ok(...near(PMINTRADE.front[0].scores["a"], 1, 0.05));
});

test("test_a_front_entry_keys_scores_by_objective_expression", () => {
  assert.deepEqual(Object.keys(PTRADE.front[0].scores).sort(), ["a", "b"]);
});

test("test_a_front_entry_carries_no_scalar_score", () => {
  assert.ok(!("score" in PTRADE.front[0]), `expected no score key, got ${Object.keys(PTRADE.front[0])}`);
});

test("test_front_size_reports_the_whole_non_dominated_set", () => {
  assert.equal(PTRADE2.front_size, 3);
});

test("test_pareto_returned_is_capped_by_the_requested_count", () => {
  assert.equal(PTRADE2.returned, 2);
});

test("test_the_front_length_matches_the_returned_count", () => {
  assert.equal(PTRADE2.front.length, 2);
});

test("test_dominance_respects_a_minimize_direction", () => {
  assert.equal(PMIN.front_size, 1);
});

test("test_the_minimize_front_keeps_the_smallest_candidate", () => {
  assert.ok(...near(PMIN.front[0].scores["a"], 1, 0.05));
});

// --- binding constraint ------------------------------------------------------

test("test_a_constrained_top_entry_carries_a_binding_record", () => {
  assert.deepEqual(Object.keys(SINGLECON.top[0].binding).sort(), ["bound", "metric", "slack"]);
});

test("test_without_constraints_top_entries_carry_no_binding", () => {
  assert.ok(!("binding" in OPEN.top[0]), `expected no binding key, got ${Object.keys(OPEN.top[0])}`);
});

test("test_max_bound_slack_is_limit_minus_value", () => {
  assert.ok(...near(SINGLECON.top[0].binding.slack, 7, 0.05));
});

test("test_binding_picks_the_bound_with_the_smaller_slack", () => {
  assert.equal(TWOCON.top[0].binding.bound, "min");
});

test("test_min_bound_slack_is_value_minus_limit", () => {
  assert.ok(...near(TWOCON.top[0].binding.slack, 2, 0.05));
});

test("test_binding_names_the_metric_of_its_constraint", () => {
  assert.equal(TWOCON.top[0].binding.metric, "a");
});

test("test_pareto_front_entries_carry_binding_too", () => {
  assert.equal(PBIND.front[0].binding.bound, "max");
});

// --- margin ------------------------------------------------------------------

test("test_margin_is_the_score_gap_between_winner_and_runner_up", () => {
  assert.ok(...near(/** @type {number} */ (OPEN.margin), 1, 0.05));
});

test("test_margin_is_null_with_a_single_survivor", () => {
  assert.equal(ONE.margin, null);
});

test("test_margin_is_positive_under_minimize_too", () => {
  assert.ok(...near(/** @type {number} */ (MIN.margin), 1, 0.05));
});

// --- sensitivity -------------------------------------------------------------

test("test_a_beating_sole_reject_yields_one_sensitivity_entry", () => {
  assert.equal(MAXCAP.sensitivity.length, 1);
});

test("test_a_sensitivity_entry_names_the_violated_metric", () => {
  assert.equal(MAXCAP.sensitivity[0].metric, "a");
});

test("test_a_sensitivity_entry_names_the_violated_bound", () => {
  assert.equal(MAXCAP.sensitivity[0].bound, "max");
});

test("test_a_sensitivity_entry_carries_the_bounds_limit", () => {
  assert.equal(MAXCAP.sensitivity[0].limit, 2.5);
});

test("test_sensitivity_relax_by_is_the_overshoot_past_the_bound", () => {
  assert.ok(...near(MAXCAP.sensitivity[0].relax_by, 0.5, 0.05));
});

test("test_sensitivity_score_is_the_rejects_objective_value", () => {
  assert.ok(...near(MAXCAP.sensitivity[0].score, 3, 0.05));
});

test("test_sensitivity_gain_is_the_improvement_over_the_winner", () => {
  assert.ok(...near(MAXCAP.sensitivity[0].gain, 1, 0.05));
});

test("test_a_reject_that_would_not_beat_the_winner_yields_no_sensitivity", () => {
  assert.equal(MINCAP.sensitivity.length, 0);
});

test("test_a_candidate_violating_two_constraints_yields_no_sensitivity", () => {
  assert.equal(DUALVIOL.sensitivity.length, 0);
});

test("test_with_no_survivors_sensitivity_entries_still_appear", () => {
  assert.ok(...above(NOSURV.sensitivity.length, 0));
});

test("test_no_survivor_sensitivity_entries_carry_no_gain", () => {
  assert.ok(!("gain" in NOSURV.sensitivity[0]), `expected no gain key, got ${Object.keys(NOSURV.sensitivity[0])}`);
});

// --- ranked rejects ----------------------------------------------------------

test("test_rejected_top_ranks_the_best_scoring_reject_first", () => {
  const scores = TIGHT.rejected_top.map((entry) => entry.score);
  assert.deepEqual(
    scores,
    [...scores].sort((x, y) => y - x),
  );
});

test("test_the_leading_reject_carries_the_best_rejected_score", () => {
  assert.ok(...near(TIGHT.rejected_top[0].score, 3, 0.05));
});

test("test_the_leading_rejects_changes_carry_its_swept_gain", () => {
  const serialized = JSON.stringify(TIGHT.rejected_top[0].changes);
  assert.ok(/"g":\s*"?3(\.0*)?"?[,}\]]/.test(serialized), `expected a g of 3 in ${serialized}`);
});

test("test_a_reject_reason_names_the_violated_metric", () => {
  assert.equal(MAXCAP.rejected_top[0].reasons[0].metric, "a");
});

test("test_a_reject_reason_names_the_violated_bound", () => {
  assert.equal(MAXCAP.rejected_top[0].reasons[0].bound, "max");
});

test("test_a_reject_reason_carries_the_bounds_limit", () => {
  assert.equal(MAXCAP.rejected_top[0].reasons[0].limit, 2.5);
});

test("test_a_reject_reasons_by_is_the_amount_past_the_bound", () => {
  assert.ok(...near(MAXCAP.rejected_top[0].reasons[0].by, 0.5, 0.05));
});

test("test_a_candidate_violating_two_bounds_lists_both_reasons", () => {
  assert.equal(DUALVIOL.rejected_top[0].reasons.length, 2);
});

test("test_rejected_top_keeps_exactly_the_cap_when_rejects_oversupply", () => {
  assert.equal(CAPMANY.rejected_top.length, REJECTS_KEPT);
});

test("test_rejected_by_counts_every_violated_constraint_per_candidate", () => {
  assert.deepEqual(DUALVIOL.rejected_by, { a: 1, b: 1 });
});

// --- scalar back-compat ------------------------------------------------------

test("test_scalar_mode_top_entries_still_carry_a_score", () => {
  assert.ok(...near(OPEN.top[0].score, 3, 0.05));
});
