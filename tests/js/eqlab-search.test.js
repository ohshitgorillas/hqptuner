// Behavioral suite for scripts/eqlab/search.js — value/change expansion and
// whole search jobs. Written blind from a spec block: no eqlab source was read.
//
// Search spaces are kept to single digits of candidates so that an ordering
// assertion is readable, and score comes from an `at` metric on the band the
// space moves — which depends on centre-frequency gain only, never on
// HQPlayer's unverified peaking-Q convention (FILTER-MATH §7).
//
// One test re-reads a candidate's process string through the faked
// GET /api/matrix wire (docs/testing.md rule 4), restored after every test.
//
// Split out of the former eqlab.test.js; every test here is unchanged.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-search.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { valueAt } from "../../scripts/eqlab/metrics.js";
import { resolveChain, applyChanges, serialize } from "../../scripts/eqlab/chain.js";
import { searchJob } from "../../scripts/eqlab/search.js";
import { expandValue, expandChange } from "../../scripts/eqlab/space.js";
import { FS, near, band, curve, serveRows, REAL_FETCH } from "./eqlab-helpers.js";

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// --- search value expansion --------------------------------------------------

test("test_a_three_number_array_expands_as_a_from_to_step_range", () => {
  assert.deepEqual(expandValue([1, 2, 0.5]), [1, 1.5, 2]);
});

test("test_a_two_number_array_is_a_literal_list", () => {
  assert.deepEqual(expandValue([1, 2]), [1, 2]);
});

test("test_a_four_number_array_is_a_literal_list", () => {
  assert.deepEqual(expandValue([1, 2, 3, 4]), [1, 2, 3, 4]);
});

test("test_an_explicit_values_object_is_a_literal_list", () => {
  assert.deepEqual(expandValue({ values: [3, 9] }), [3, 9]);
});

test("test_an_explicit_from_to_step_object_is_a_range", () => {
  assert.deepEqual(expandValue({ from: 1, to: 2, step: 0.5 }), [1, 1.5, 2]);
});

test("test_a_scalar_expands_to_a_single_element_list", () => {
  assert.deepEqual(expandValue(3), [3]);
});

test("test_a_non_positive_step_is_rejected", () => {
  assert.throws(() => expandValue({ from: 1, to: 2, step: 0 }));
});

test("test_a_backwards_range_is_rejected", () => {
  assert.throws(() => expandValue({ from: 2, to: 1, step: 0.5 }));
});

const CROSS = expandChange({ select: 2090, g: [1, 2, 1], q: [3, 4, 1] });

test("test_a_change_over_two_swept_parameters_expands_to_their_cross_product", () => {
  assert.deepEqual(CROSS.map((c) => `${c.g}/${c.q}`).sort(), ["1/3", "1/4", "2/3", "2/4"]);
});

test("test_every_expanded_change_carries_the_fixed_selector", () => {
  assert.equal(
    CROSS.every((c) => c.select === 2090),
    true,
  );
});

test("test_an_absent_change_expands_to_a_single_null_candidate", () => {
  assert.deepEqual(expandChange(undefined), [null]);
});

// --- search jobs -------------------------------------------------------------
//
// One band at 1 kHz, one metric reading the curve right there: a candidate that
// amends that band to g dB scores g, so ordering and constraint arithmetic are
// readable off the space itself.

const BASE = [band(1000, 0, 1)];
const CTX = { stages: BASE, fs: FS, metrics: { spot: { kind: "at", f: 1000 } } };
const SPACE = { amend: { select: 1000, g: [1, 3, 1], q: 1 } };
const jobOf = (over) => ({ space: SPACE, constraints: [], objective: "maximize spot", top: 5, ...over });

const OPEN = searchJob(jobOf(), CTX);
const CAPPED = searchJob(jobOf({ constraints: [{ metric: "spot", max: 2.5 }] }), CTX);

test("test_a_search_considers_every_candidate_the_space_generates", () => {
  const wide = {
    amend: { select: 1000, g: [1, 3, 1], q: 1 },
    append: { type: "peak", f: [4000, 8000, 4000], q: 1, g: 1 },
  };
  assert.equal(searchJob(jobOf({ space: wide }), CTX).considered, 6);
});

test("test_with_no_constraints_every_candidate_survives", () => {
  assert.equal(OPEN.survived, OPEN.considered);
});

test("test_with_no_constraints_nothing_is_recorded_as_rejected", () => {
  assert.deepEqual(OPEN.rejected_by, {});
});

test("test_a_max_constraint_drops_the_candidates_that_exceed_it", () => {
  assert.equal(CAPPED.survived, 2);
});

test("test_a_rejection_is_counted_under_the_constraints_metric_name", () => {
  assert.deepEqual(CAPPED.rejected_by, { spot: 1 });
});

test("test_constraints_do_not_change_how_many_candidates_were_considered", () => {
  assert.equal(CAPPED.considered, 3);
});

test("test_a_maximize_objective_orders_the_results_by_descending_score", () => {
  const scores = OPEN.top.map((entry) => entry.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );
});

test("test_a_minimize_objective_orders_the_results_by_ascending_score", () => {
  const scores = searchJob(jobOf({ objective: "minimize spot" }), CTX).top.map((entry) => entry.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => a - b),
  );
});

test("test_the_best_scoring_candidate_comes_first_under_maximize", () => {
  assert.ok(...near(OPEN.top[0].score, 3, 0.1));
});

test("test_the_result_echoes_the_direction_of_its_objective", () => {
  assert.equal(OPEN.objective.direction, "maximize");
});

test("test_the_result_echoes_the_expression_of_its_objective", () => {
  assert.equal(OPEN.objective.expr.trim(), "spot");
});

test("test_the_result_echoes_the_constraints_it_was_given", () => {
  assert.deepEqual(CAPPED.constraints, [{ metric: "spot", max: 2.5 }]);
});

test("test_the_results_are_capped_at_the_requested_count", () => {
  assert.equal(searchJob(jobOf({ top: 2 }), CTX).top.length, 2);
});

test("test_the_returned_count_reports_how_many_came_back", () => {
  assert.equal(searchJob(jobOf({ top: 2 }), CTX).returned, 2);
});

test("test_a_result_entry_carries_the_process_string_of_its_own_chain", async () => {
  serveRows([{ index: 0, process: OPEN.top[0].process }]);
  const reread = await resolveChain({ from: "daemon" });
  assert.ok(...near(valueAt(curve(reread.stages), 1000), 3, 0.1));
});

test("test_a_result_entry_carries_the_preamp_of_its_own_chain", () => {
  assert.ok(...near(OPEN.top[0].preamp_db, -3, 0.1));
});

test("test_a_result_entry_carries_the_panels_metrics_by_name", () => {
  assert.deepEqual(Object.keys(OPEN.top[0].metrics), ["spot"]);
});

test("test_a_result_entrys_metric_value_is_the_measured_number", () => {
  assert.ok(...near(OPEN.top[0].metrics.spot, 3, 0.1));
});

// Key presence only: the spec fixes the shape but no behaviour for these two.
test("test_a_result_entry_reports_whether_its_chain_was_only_partly_plottable", () => {
  assert.ok("partial" in OPEN.top[0], `expected a partial key, got ${Object.keys(OPEN.top[0])}`);
});

test("test_a_result_entry_carries_its_guidance_flags", () => {
  assert.ok("flags" in OPEN.top[0], `expected a flags key, got ${Object.keys(OPEN.top[0])}`);
});

test("test_an_objective_that_is_neither_maximize_nor_minimize_is_rejected", () => {
  assert.throws(() => searchJob(jobOf({ objective: "optimize spot" }), CTX));
});

test("test_a_constraint_naming_a_metric_outside_the_panel_is_rejected", () => {
  assert.throws(() => searchJob(jobOf({ constraints: [{ metric: "warmth", max: 1 }] }), CTX));
});

test("test_a_result_entrys_changes_reproduce_its_process_string", () => {
  const rebuilt = applyChanges(BASE, OPEN.top[0].changes);
  assert.equal(serialize(rebuilt.stages), OPEN.top[0].process);
});
