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
  lineWith,
  mentionsAll,
  onlyWhenPresent,
  rep,
  rowsWith,
  searchBody,
  sectionOmitted,
  show,
  survivor,
} from "../support/render-fixtures.js";

const NO_CANDIDATE = "no candidate satisfied the constraints";

// --- a scalar search ----------------------------------------------------------

test("test_a_scalar_search_reports_the_objective_direction_and_expression", () => {
  assert.ok(...includesAll(show(rep("search", searchBody())), ["maximize", "zzobja - zzobjb"]));
});

// Returned is 42, not 3: every survivor row prints the preamp -3.5, which
// spells 3. Nothing this report prints spells 42, 210 or 55 — not 48000, not
// the changes' 1234 or 9.5, not the process string's 777/1/6, not 17, and not
// any survivor score, which run 90 down to 69.5 in half-dB steps.
test("test_a_scalar_search_reports_how_many_candidates_were_considered_survived_and_returned", () => {
  const top = Array.from({ length: 42 }, (_, i) => survivor({ score: 90 - i * 0.5 }));
  assert.ok(...mentionsAll(show(rep("search", searchBody({ top, returned: 42 }))), [210, 55, 42]));
});

test("test_a_scalar_search_states_the_margin_to_the_runner_up", () => {
  assert.ok(...mentionsAll(show(rep("search", searchBody({ margin: 0.75 }))), [0.75]));
});

test("test_a_scalar_search_names_the_margin_only_when_it_has_one", () => {
  const withMargin = show(rep("search", searchBody({ margin: 0.5 })));
  assert.ok(...onlyWhenPresent(withMargin, show(rep("search", searchBody({ margin: null }))), "0.5"));
});

// Counts 47 and 58, not 12 and 34: the survivor's changes print select 1234,
// which spells both of those. Nothing in this report spells 47 or 58 — not
// 1234, 9.5, 210, 55, 8.5, 2.5, -3.5, 17, 48000 or the process string.
test("test_a_scalar_search_summarises_each_rejection_reason_with_its_count", () => {
  const rejected_by = { zzhot: 47, zzmud: 58 };
  assert.ok(...includesAll(show(rep("search", searchBody({ rejected_by }))), ["zzhot", "47", "zzmud", "58"]));
});

test("test_a_scalar_search_that_rejected_nothing_names_no_rejection_reason", () => {
  const busy = show(rep("search", searchBody({ rejected_by: { zzhot: 12 } })));
  assert.ok(...onlyWhenPresent(busy, show(rep("search", searchBody({ rejected_by: {} }))), "zzhot"));
});

test("test_a_scalar_search_prints_one_table_row_per_survivor", () => {
  const top = [survivor(), survivor({ score: 6.5 }), survivor({ score: 4.5 })];
  assert.equal(rowsWith(show(rep("search", searchBody({ top }))), "1234"), 3);
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

const REFINEMENT = { from_score: 4.5, score: 8.5, evals: 96, converged: true, improved: true };

/**
 * A top of three survivors of which the first `n` were refined, so the refined
 * section is the only thing that varies between renderings.
 *
 * @param {number} n
 * @returns {string}
 */
const refinedTop = (n) => {
  const top = [8.5, 6.5, 4.5].map((score, i) => survivor({ score, ...(i < n ? { refined: REFINEMENT } : {}) }));
  return show(rep("search", searchBody({ top })));
};

test("test_a_search_whose_survivors_were_not_refined_omits_the_refined_section", () => {
  assert.ok(...sectionOmitted(refinedTop(0), refinedTop(1), refinedTop(2)));
});

// Which survivor was refined is reported: the two renderings differ only in
// WHICH of three otherwise identical-shaped rows carries the same refinement,
// so a report that named no position would render the two the same. The
// numbering itself (0- or 1-based) is copy this suite does not know.
test("test_the_refined_section_identifies_which_survivor_was_refined", () => {
  const refinedAt = (/** @type {number} */ i) => {
    const top = [8.5, 8.5, 8.5].map((score, j) => survivor({ score, ...(i === j ? { refined: REFINEMENT } : {}) }));
    return show(rep("search", searchBody({ top })));
  };
  assert.ok(...differ(refinedAt(0), refinedAt(1)));
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
  const one = show(rep("search", searchBody({ sensitivity: [SENSITIVITY[0]] })));
  const two = show(rep("search", searchBody({ sensitivity: SENSITIVITY })));
  assert.ok(...sectionOmitted(show(rep("search", searchBody())), one, two));
});

const REJECTED_TOP = [
  {
    score: 4.5,
    changes: { amend: [{ select: 4321, g: 2.5 }] },
    reasons: [{ metric: "zzrej", bound: "zzbound", limit: 1.5, by: 0.75 }],
  },
  {
    score: 3.5,
    changes: { amend: [{ select: 5678, g: 2.5 }] },
    reasons: [{ metric: "zzrej", bound: "zzbound", limit: 1.5, by: 1.75 }],
  },
];

test("test_a_rejected_candidate_row_carries_its_score_the_bounds_it_failed_and_its_changes", () => {
  const out = show(rep("search", searchBody({ rejected_top: [REJECTED_TOP[0]] })));
  assert.ok(...includesAll(out, ["4.5", "zzrej", "zzbound", "0.75", "4321"]));
});

test("test_a_search_with_no_rejected_candidates_omits_that_table", () => {
  const one = show(rep("search", searchBody({ rejected_top: [REJECTED_TOP[0]] })));
  const two = show(rep("search", searchBody({ rejected_top: REJECTED_TOP })));
  assert.ok(...sectionOmitted(show(rep("search", searchBody())), one, two));
});

// --- a pareto search ----------------------------------------------------------

const PARETO_OBJECTIVES = [OBJECTIVE, { direction: "minimize", expr: "zzobjc" }];

/** @param {number} n @returns {Record<string, unknown>} */
const frontMember = (n) => survivor({ score: undefined, scores: { "zzobja - zzobjb": 8.5 - n, zzobjc: 6.5 - n } });

// A front of 26, not 7: the rows print 7.5 as an objective score and the
// process string carries f=777, both of which spell 7. Nothing this report
// prints spells 26, 210 or 55 — not the changes' 1234 or 9.5, not 2.5 or -3.5,
// not 17 or 48000, and not any objective score, which run 8.5 down to -18.5 in
// whole steps.
/** @param {Record<string, unknown>} [over] */
const paretoBody = (over = {}) => ({
  considered: 210,
  survived: 55,
  returned: 26,
  rejected_by: {},
  pareto: { objectives: PARETO_OBJECTIVES },
  front: Array.from({ length: 26 }, (_, i) => frontMember(i)),
  front_size: 26,
  ...over,
});

test("test_a_pareto_search_reports_each_objectives_direction_and_expression", () => {
  const out = show(rep("search", paretoBody()));
  assert.ok(...includesAll(out, ["maximize", "zzobja - zzobjb", "minimize", "zzobjc"]));
});

test("test_a_pareto_search_reports_the_counts_considered_survived_and_the_front_size", () => {
  assert.ok(...mentionsAll(show(rep("search", paretoBody())), [210, 55, 26]));
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
  const first = { metric: "zzviol", bound: "zzbound", limit: 1.5, by: 0.75 };
  const one = show(rep("refine", refineBody({ violations: [first] })));
  const two = show(rep("refine", refineBody({ violations: [first, { ...first, metric: "zzviol2" }] })));
  assert.ok(...sectionOmitted(show(rep("refine", refineBody())), one, two));
});

test("test_a_refine_prints_the_best_candidates_changes", () => {
  assert.ok(...mentionsAll(show(rep("refine", refineBody())), [1234]));
});

test("test_a_refine_prints_the_best_candidates_process_string", () => {
  assert.ok(...includesAll(show(rep("refine", refineBody())), [PROCESS_A]));
});
