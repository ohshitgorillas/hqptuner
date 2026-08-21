// Behavioral suite for scripts/eqlab/chain.js — chain resolution, the EQ tail,
// cross-row tail consistency, band selection, change sets and serialization.
// Written blind from a spec block: no eqlab source was read.
//
// The one network read (GET /api/matrix) is faked at globalThis.fetch with the
// real body shape {data: {rows: [...]}} (docs/testing.md rule 4) and restored
// after every test.
//
// Split out of the former eqlab.test.js; every test here is unchanged.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-chain.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { valueAt } from "../../../scripts/eqlab/curve.js";
import { eqTail, tailConsistency, resolveChain, selectBand, applyChanges } from "../../../scripts/eqlab/chain.js";
import { serializeProcess } from "../../../hqptuner/static/lib/matrixspec.js";
import { near, band, curve, argNum, serveRows, REAL_FETCH, XFEED, TAIL } from "../support/eqlab-helpers.js";

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

/** @typedef {import("../../../scripts/eqlab/chain.js").Edit} Edit */
/** @typedef {import("../../../scripts/eqlab/chain.js").AmendEdit} AmendEdit */

/**
 * The amend branch of the edit union, which is the branch an amend records.
 *
 * @param {Edit} edit
 * @returns {AmendEdit}
 */
const amendEdit = (edit) => {
  if (edit.kind !== "amend") throw new Error(`expected an amend edit, got ${edit.kind}`);
  return edit;
};

// --- chain resolution --------------------------------------------------------

test("test_a_chain_given_as_bands_yields_one_stage_per_band", async () => {
  const resolved = await resolveChain({ bands: [{ type: "peak", f: 1000, q: 1, g: 3 }] });
  assert.equal(resolved.stages.length, 1);
});

test("test_a_chain_given_as_bands_reports_bands_as_its_source", async () => {
  const resolved = await resolveChain({ bands: [{ type: "peak", f: 1000, q: 1, g: 3 }] });
  assert.equal(resolved.source.kind, "bands");
});

test("test_a_chain_given_as_bands_has_no_consistency_verdict", async () => {
  const resolved = await resolveChain({ bands: [{ type: "peak", f: 1000, q: 1, g: 3 }] });
  assert.equal(resolved.consistency, null);
});

test("test_reading_the_daemon_issues_exactly_one_request", async () => {
  const seen = serveRows([{ index: 0, process: TAIL }]);
  await resolveChain({ from: "daemon" });
  assert.equal(seen.calls, 1);
});

test("test_reading_the_daemon_uses_the_matrix_endpoint", async () => {
  const seen = serveRows([{ index: 0, process: TAIL }]);
  await resolveChain({ from: "daemon" });
  assert.ok(String(seen.path).includes("/api/matrix"), `expected /api/matrix, got ${seen.path}`);
});

test("test_reading_the_daemon_is_a_get", async () => {
  const seen = serveRows([{ index: 0, process: TAIL }]);
  await resolveChain({ from: "daemon" });
  assert.equal(seen.method, "GET");
});

test("test_reading_the_daemon_defaults_to_row_zero", async () => {
  serveRows([
    { index: 0, process: TAIL },
    { index: 1, process: "iir:type=peak;f=500;q=1;g=9" },
  ]);
  const resolved = await resolveChain({ from: "daemon" });
  assert.equal(resolved.source.row, 0);
});

test("test_the_stages_read_from_the_daemon_are_the_rows_own_bands", async () => {
  serveRows([{ index: 0, process: TAIL }]);
  const resolved = await resolveChain({ from: "daemon" });
  assert.ok(...near(valueAt(curve(resolved.stages), 1000), 3, 0.1));
});

test("test_an_explicit_row_index_reads_that_row", async () => {
  serveRows([
    { index: 0, process: TAIL },
    { index: 1, process: "iir:type=peak;f=500;q=1;g=9" },
  ]);
  const resolved = await resolveChain({ from: "daemon", row: 1 });
  assert.ok(...near(valueAt(curve(resolved.stages), 500), 9, 0.1));
});

test("test_a_row_index_that_is_not_present_is_named_in_the_error", async () => {
  serveRows([{ index: 0, process: TAIL }]);
  await assert.rejects(() => resolveChain({ from: "daemon", row: 7 }), /7/);
});

test("test_eq_only_keeps_just_the_eq_tail_of_the_row", async () => {
  serveRows([{ index: 0, process: `${XFEED},delay:t=0.0003,${TAIL}` }]);
  const resolved = await resolveChain({ from: "daemon", eq_only: true });
  assert.equal(resolved.stages.length, 2);
});

test("test_without_eq_only_every_stage_of_the_row_is_kept", async () => {
  serveRows([{ index: 0, process: `${XFEED},delay:t=0.0003,${TAIL}` }]);
  const resolved = await resolveChain({ from: "daemon" });
  assert.equal(resolved.stages.length, 4);
});

test("test_the_source_echoes_whether_only_the_eq_tail_was_kept", async () => {
  serveRows([{ index: 0, process: `${XFEED},${TAIL}` }]);
  const resolved = await resolveChain({ from: "daemon", eq_only: true });
  assert.equal(resolved.source.eq_only, true);
});

test("test_an_unknown_chain_source_is_rejected", async () => {
  await assert.rejects(() => resolveChain({ from: "clipboard" }));
});

test("test_resolving_no_chain_at_all_is_rejected", async () => {
  await assert.rejects(() => resolveChain(undefined));
});

// --- eq tails and cross-row consistency --------------------------------------

test("test_a_crossfeed_lead_in_is_not_part_of_the_eq_tail", async () => {
  serveRows([{ index: 0, process: `${XFEED},delay:t=0.0003,${TAIL}` }]);
  const resolved = await resolveChain({ from: "daemon" });
  assert.equal(eqTail(resolved.stages).length, 2);
});

test("test_a_high_shelf_counts_as_part_of_the_eq_tail", async () => {
  serveRows([{ index: 0, process: `${XFEED},iir:type=peak;f=1000;q=1;g=3,iir:type=hshelf;f=8000;q=0.7;g=2` }]);
  const resolved = await resolveChain({ from: "daemon" });
  assert.equal(eqTail(resolved.stages).length, 2);
});

test("test_a_low_shelf_counts_as_part_of_the_eq_tail", async () => {
  serveRows([{ index: 0, process: `${XFEED},iir:type=lshelf;f=100;q=0.7;g=2,iir:type=peak;f=1000;q=1;g=3` }]);
  const resolved = await resolveChain({ from: "daemon" });
  assert.equal(eqTail(resolved.stages).length, 2);
});

test("test_the_eq_tail_starts_at_the_first_trailing_eq_stage", async () => {
  serveRows([{ index: 0, process: `${XFEED},delay:t=0.0003,${TAIL}` }]);
  const resolved = await resolveChain({ from: "daemon" });
  assert.equal(argNum(eqTail(resolved.stages)[0], "f"), 1000);
});

const XFEED_ROWS = [
  { index: 0, process: TAIL },
  { index: 1, process: `${XFEED},delay:t=0.0003,${TAIL}` },
];

test("test_rows_differing_only_by_a_crossfeed_lead_in_are_consistent", () => {
  assert.equal(tailConsistency(XFEED_ROWS).tail_consistent, true);
});

test("test_consistent_rows_leave_no_offenders", () => {
  assert.deepEqual(tailConsistency(XFEED_ROWS).offending_rows, []);
});

test("test_consistency_reports_how_many_rows_it_checked", () => {
  assert.equal(tailConsistency(XFEED_ROWS).rows_checked, 2);
});

const SPLIT_ROWS = [
  { index: 0, process: TAIL },
  { index: 7, process: `${XFEED},iir:type=peak;f=1000;q=1;g=5,iir:type=peak;f=3000;q=2;g=-2` },
];

test("test_a_row_whose_eq_tail_really_differs_breaks_consistency", () => {
  assert.equal(tailConsistency(SPLIT_ROWS).tail_consistent, false);
});

test("test_an_offending_row_is_reported_by_its_own_index", () => {
  assert.deepEqual(tailConsistency(SPLIT_ROWS).offending_rows, [7]);
});

// --- band selection ----------------------------------------------------------

const THREE = [band(1000, 2, 1), band(2090, 3, 3.16), band(8000, 2, 1)];

test("test_a_band_is_selected_by_its_exact_center_frequency", () => {
  assert.equal(selectBand(THREE, 2090), 1);
});

test("test_a_frequency_no_band_sits_on_is_never_nearest_matched", () => {
  assert.throws(() => selectBand(THREE, 2091), /2090/);
});

test("test_an_ambiguous_frequency_is_rejected", () => {
  assert.throws(() => selectBand([band(1000, 2, 1), band(1000, 3, 4)], 1000));
});

// --- change sets -------------------------------------------------------------

const AMENDED = applyChanges([band(1000, 2, 1), band(8000, 2, 1)], { amend: [{ select: 1000, g: 5, q: 3 }] });

test("test_an_amend_replaces_the_selected_bands_gain", () => {
  assert.ok(...near(valueAt(curve(AMENDED.stages), 1000), 5, 0.1));
});

test("test_an_amend_leaves_every_other_stage_untouched", () => {
  assert.ok(...near(valueAt(curve(AMENDED.stages), 8000), 2, 0.1));
});

test("test_an_amend_records_an_amend_edit", () => {
  assert.equal(AMENDED.edits[0].kind, "amend");
});

test("test_an_amend_edit_records_the_index_it_touched", () => {
  assert.equal(amendEdit(AMENDED.edits[0]).index, 0);
});

test("test_an_amend_edit_records_the_arguments_it_replaced", () => {
  assert.equal(Number(amendEdit(AMENDED.edits[0]).before.g), 2);
});

test("test_an_amend_edit_records_the_arguments_it_installed", () => {
  assert.equal(Number(amendEdit(AMENDED.edits[0]).after.g), 5);
});

test("test_an_amend_may_move_a_band_to_a_new_center_frequency", () => {
  const moved = applyChanges([band(2090, 4, 3)], { amend: [{ select: 2090, f: 1800 }] });
  assert.ok(...near(valueAt(curve(moved.stages), 1800), 4, 0.1));
});

const APPENDED = applyChanges([band(1000, 2, 1)], { append: [{ type: "peak", f: 6000, q: 2, g: 3 }] });

test("test_an_append_adds_a_band_to_the_end_of_the_chain", () => {
  assert.equal(argNum(APPENDED.stages[APPENDED.stages.length - 1], "f"), 6000);
});

test("test_an_appended_band_contributes_its_gain_to_the_chain", () => {
  assert.ok(...near(valueAt(curve(APPENDED.stages), 6000), 3, 0.1));
});

test("test_an_append_records_an_append_edit", () => {
  assert.equal(APPENDED.edits[0].kind, "append");
});

const COMPOSED = applyChanges([band(1000, 2, 1), band(8000, 2, 1)], {
  amend: [{ select: 1000, g: 4 }],
  append: [{ type: "hshelf", f: 6000, q: 0.7, g: 2 }],
});

test("test_an_amend_and_an_append_compose_in_one_call", () => {
  assert.deepEqual(
    COMPOSED.edits.map((e) => e.kind),
    ["amend", "append"],
  );
});

test("test_a_serialized_chain_round_trips_through_the_process_grammar", async () => {
  const once = serializeProcess(COMPOSED.stages);
  serveRows([{ index: 0, process: once }]);
  const reread = await resolveChain({ from: "daemon" });
  assert.equal(serializeProcess(reread.stages), once);
});

// Anchor for the test above: identity alone also holds for a serializeProcess() that
// returns the empty string, so pin what the rendered chain actually measures.
test("test_a_serialized_chain_carries_the_amended_band_it_was_built_from", async () => {
  serveRows([{ index: 0, process: serializeProcess(COMPOSED.stages) }]);
  const reread = await resolveChain({ from: "daemon" });
  assert.ok(...near(valueAt(curve(reread.stages), 1000), 4, 0.15));
});
