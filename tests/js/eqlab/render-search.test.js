// Characterization suite for scripts/eqlab/render.js: the sweep jobs — the
// scalar search, the pareto search and the refine that follows one. The header
// block, probe and evaluate live in render.test.js and the read/write jobs in
// render-io.test.js; fixtures and readers are shared from
// tests/js/support/render-fixtures.js.
//
// Written blind from a spec block; render.js itself was not read. Headings and
// labels are copy this suite does not know, so it asserts values, row counts
// and line costs rather than phrases — with one exception: the empty-sweep
// message "no candidate satisfied the constraints" is dev-tool stderr copy
// supplied with the spec, so it is asserted literally.
//
// A fragment that lives INLINE on a line the report prints either way (the
// runner-up margin, the rejection summary, a sensitivity entry's gain) is
// pinned with onlyWhenPresent: named when its data is there, not named when it
// is not. A line or token count would assert nothing about those.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/render-search.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  OBJECTIVE,
  PROCESS_A,
  count,
  differ,
  includesAll,
  isShorter,
  lineWith,
  mentionsAll,
  onlyWhenPresent,
  rep,
  searchBody,
  show,
  survivor,
} from "../support/render-fixtures.js";

const NO_CANDIDATE = "no candidate satisfied the constraints";

// --- a scalar search ----------------------------------------------------------

test("test_a_scalar_search_reports_the_objective_direction_and_expression", () => {
  assert.ok(...includesAll(show(rep("search", searchBody())), ["maximize", "zzobja - zzobjb"]));
});

test("test_a_scalar_search_reports_how_many_candidates_were_considered_survived_and_returned", () => {
  const top = [survivor(), survivor({ score: 6.5 }), survivor({ score: 4.5 })];
  assert.ok(...mentionsAll(show(rep("search", searchBody({ top }))), [210, 55, 3]));
});

test("test_a_scalar_search_states_the_margin_to_the_runner_up", () => {
  assert.ok(...mentionsAll(show(rep("search", searchBody({ margin: 0.75 }))), [0.75]));
});

test("test_a_scalar_search_names_the_margin_only_when_it_has_one", () => {
  const withMargin = show(rep("search", searchBody({ margin: 0.5 })));
  assert.ok(...onlyWhenPresent(withMargin, show(rep("search", searchBody({ margin: null }))), "0.5"));
});

test("test_a_scalar_search_summarises_each_rejection_reason_with_its_count", () => {
  const rejected_by = { zzhot: 12, zzmud: 34 };
  assert.ok(...includesAll(show(rep("search", searchBody({ rejected_by }))), ["zzhot", "12", "zzmud", "34"]));
});

test("test_a_scalar_search_that_rejected_nothing_names_no_rejection_reason", () => {
  const busy = show(rep("search", searchBody({ rejected_by: { zzhot: 12 } })));
  assert.ok(...onlyWhenPresent(busy, show(rep("search", searchBody({ rejected_by: {} }))), "zzhot"));
});

test("test_a_scalar_search_prints_one_table_row_per_survivor", () => {
  const top = [survivor(), survivor({ score: 6.5 }), survivor({ score: 4.5 })];
  assert.ok(...mentionsAll(show(rep("search", searchBody({ top }))), [8.5, 6.5, 4.5]));
});

test("test_a_survivor_row_carries_its_metrics_preamp_and_changes", () => {
  assert.ok(...mentionsAll(lineWith(show(rep("search", searchBody())), "8.5"), [2.5, -3.5, 1234]));
});

test("test_a_scalar_search_with_no_survivors_says_no_candidate_satisfied_the_constraints", () => {
  assert.ok(...includesAll(show(rep("search", searchBody({ top: [], returned: 0 }))), [NO_CANDIDATE]));
});

test("test_a_search_whose_best_names_a_binding_constraint_states_the_metric_bound_and_slack", () => {
  const binding = { metric: "zzbind", bound: "zzmax", slack: 0.75 };
  const out = show(rep("search", searchBody({ top: [survivor({ binding })] })));
  assert.ok(...includesAll(out, ["zzbind", "zzmax", "0.75"]));
});

test("test_a_search_whose_best_names_no_binding_constraint_omits_the_binding_line", () => {
  const binding = { metric: "zzbind", bound: "zzmax", slack: 0.75 };
  const bound = show(rep("search", searchBody({ top: [survivor({ binding })] })));
  assert.equal(count(show(rep("search", searchBody()))), count(bound) - 1);
});

test("test_a_refined_survivor_is_listed_with_the_score_it_moved_from_the_score_it_reached_and_its_evals", () => {
  const refined = { from_score: 4.5, score: 8.5, evals: 96, converged: true, improved: true };
  assert.ok(...mentionsAll(show(rep("search", searchBody({ top: [survivor({ refined })] }))), [4.5, 8.5, 96]));
});

test("test_a_refined_survivor_that_did_not_converge_reads_differently_from_one_that_did", () => {
  const base = { from_score: 4.5, score: 8.5, evals: 96, improved: true };
  const yes = show(rep("search", searchBody({ top: [survivor({ refined: { ...base, converged: true } })] })));
  const no = show(rep("search", searchBody({ top: [survivor({ refined: { ...base, converged: false } })] })));
  assert.ok(...differ(yes, no));
});

test("test_a_refined_survivor_whose_grid_point_was_kept_reads_differently_from_one_that_improved", () => {
  const base = { from_score: 4.5, score: 8.5, evals: 96, converged: true };
  const yes = show(rep("search", searchBody({ top: [survivor({ refined: { ...base, improved: true } })] })));
  const no = show(rep("search", searchBody({ top: [survivor({ refined: { ...base, improved: false } })] })));
  assert.ok(...differ(yes, no));
});

test("test_a_search_whose_survivors_were_not_refined_omits_the_refined_section", () => {
  const refined = { from_score: 4.5, score: 8.5, evals: 96, converged: true, improved: true };
  const withRefined = show(rep("search", searchBody({ top: [survivor({ refined })] })));
  assert.ok(...isShorter(show(rep("search", searchBody())), withRefined));
});

// The gain of the first entry is a value no other number on either sensitivity
// row can spell: neither 1.5, 3.5, 0.25, 8.5 nor 6.5 contains "0.5".
const SENSITIVITY = [
  { metric: "zzsensa", bound: "zzmax", limit: 1.5, relax_by: 0.25, score: 8.5, gain: 0.5 },
  { metric: "zzsensb", bound: "zzmin", limit: 3.5, relax_by: 0.25, score: 6.5 },
];

test("test_a_sensitivity_entry_carries_the_metric_bound_amount_relaxed_by_and_the_resulting_score", () => {
  const out = show(rep("search", searchBody({ sensitivity: SENSITIVITY })));
  assert.ok(...includesAll(lineWith(out, "zzsensa"), ["zzsensa", "zzmax", "0.25", "8.5"]));
});

test("test_a_sensitivity_entry_names_its_gain_only_when_it_has_one", () => {
  const out = show(rep("search", searchBody({ sensitivity: SENSITIVITY })));
  assert.ok(...onlyWhenPresent(lineWith(out, "zzsensa"), lineWith(out, "zzsensb"), "0.5"));
});

test("test_a_search_with_no_sensitivity_analysis_omits_that_section", () => {
  const withSens = show(rep("search", searchBody({ sensitivity: SENSITIVITY })));
  assert.ok(...isShorter(show(rep("search", searchBody())), withSens));
});

const REJECTED_TOP = [
  {
    score: 4.5,
    changes: { amend: [{ select: 4321, g: 2.5 }] },
    reasons: [{ metric: "zzrej", bound: "zzbound", limit: 1.5, by: 0.75 }],
  },
];

test("test_a_rejected_candidate_row_carries_its_score_the_bounds_it_failed_and_its_changes", () => {
  const out = show(rep("search", searchBody({ rejected_top: REJECTED_TOP })));
  assert.ok(...includesAll(out, ["4.5", "zzrej", "zzbound", "0.75", "4321"]));
});

test("test_a_search_with_no_rejected_candidates_omits_that_table", () => {
  const withRejects = show(rep("search", searchBody({ rejected_top: REJECTED_TOP })));
  assert.ok(...isShorter(show(rep("search", searchBody())), withRejects));
});

// --- a pareto search ----------------------------------------------------------

const PARETO_OBJECTIVES = [OBJECTIVE, { direction: "minimize", expr: "zzobjc" }];

/** @param {number} n @returns {Record<string, unknown>} */
const frontMember = (n) => survivor({ score: undefined, scores: { "zzobja - zzobjb": 8.5 - n, zzobjc: 6.5 - n } });

/** @param {Record<string, unknown>} [over] */
const paretoBody = (over = {}) => ({
  considered: 210,
  survived: 55,
  returned: 7,
  rejected_by: {},
  pareto: { objectives: PARETO_OBJECTIVES },
  front: Array.from({ length: 7 }, (_, i) => frontMember(i)),
  front_size: 7,
  ...over,
});

test("test_a_pareto_search_reports_each_objectives_direction_and_expression", () => {
  const out = show(rep("search", paretoBody()));
  assert.ok(...includesAll(out, ["maximize", "zzobja - zzobjb", "minimize", "zzobjc"]));
});

test("test_a_pareto_search_reports_the_counts_considered_survived_and_the_front_size", () => {
  assert.ok(...mentionsAll(show(rep("search", paretoBody())), [210, 55, 7]));
});

test("test_a_pareto_front_row_carries_each_objective_score_the_metrics_the_preamp_and_the_changes", () => {
  const out = show(rep("search", paretoBody({ front: [frontMember(0)], front_size: 1, returned: 1 })));
  assert.ok(...mentionsAll(lineWith(out, "8.5"), [6.5, 2.5, -3.5, 1234]));
});

test("test_a_pareto_search_with_an_empty_front_says_no_candidate_satisfied_the_constraints", () => {
  const empty = paretoBody({ front: [], front_size: 0, returned: 0 });
  assert.ok(...includesAll(show(rep("search", empty)), [NO_CANDIDATE]));
});

// --- a refine job -------------------------------------------------------------

const REFINED = { from_score: 4.5, score: 8.5, evals: 96, converged: true, improved: true };

/** @param {Record<string, unknown>} [over] */
const refineBody = (over = {}) => ({ best: survivor({ refined: REFINED, ...over }), objective: OBJECTIVE });

test("test_a_refine_reports_the_objective_direction_and_expression", () => {
  assert.ok(...includesAll(show(rep("refine", refineBody())), ["maximize", "zzobja - zzobjb"]));
});

test("test_a_refine_reports_the_score_it_moved_from_the_score_it_reached_and_the_evaluation_count", () => {
  assert.ok(...mentionsAll(show(rep("refine", refineBody())), [4.5, 8.5, 96]));
});

test("test_a_refine_reports_the_preamp_of_the_best_candidate", () => {
  assert.ok(...mentionsAll(show(rep("refine", refineBody())), [-3.5]));
});

test("test_a_refine_prints_a_metric_row_for_the_best_candidate", () => {
  assert.ok(...includesAll(lineWith(show(rep("refine", refineBody())), "zzalpha"), ["zzalpha", "2.5"]));
});

test("test_a_refine_lists_each_violation_with_its_metric_bound_and_by_how_much_it_was_missed", () => {
  const violations = [{ metric: "zzviol", bound: "zzbound", limit: 1.5, by: 0.75 }];
  assert.ok(...includesAll(show(rep("refine", refineBody({ violations }))), ["zzviol", "zzbound", "0.75"]));
});

test("test_a_refine_whose_best_carries_no_violations_key_omits_the_violations_section", () => {
  const violations = [{ metric: "zzviol", bound: "zzbound", limit: 1.5, by: 0.75 }];
  assert.ok(...isShorter(show(rep("refine", refineBody())), show(rep("refine", refineBody({ violations })))));
});

test("test_a_refine_prints_the_best_candidates_changes", () => {
  assert.ok(...mentionsAll(show(rep("refine", refineBody())), [1234]));
});

test("test_a_refine_prints_the_best_candidates_process_string", () => {
  assert.ok(...includesAll(show(rep("refine", refineBody())), [PROCESS_A]));
});
