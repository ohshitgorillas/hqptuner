// Behavioral suite for mockup/scripts/model/drawer.js: what a stage drawer decides, free of the DOM. Which rows are
// staged against the applied values, which controls gray and which reason lines print and link, when the apply group
// shows and is live, what Apply commits across a drawer family, and what Discard puts back.
//
// Every schema, value store and gray table is one this file writes.
//
// Run: node --test tests/js/mockup/drawer.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  startValues,
  editOf,
  dirtyIds,
  regray,
  restarts,
  applyPaint,
  isStaged,
  applyTargets,
  commit,
  restoreOf,
  blockRestore,
} from "../../../../mockup/scripts/model/shell/drawer.js";

/** @typedef {import("../../../../mockup/scripts/model/shell/drawer.js").Values} Values */

//: Gray reasons by the value of `mode`, the table every grayable control below reads.
/** @type {Record<string, string>} */
const BY_MODE = { a: "", b: "rb", c: " " };
//: Reasons that carry a cross-reference link.
const XREF = new Set(["rx"]);
const hasXref = (/** @type {string} */ text) => XREF.has(text);

/** A control that grays with `reason` whatever the values. */
const fixed = (/** @type {string} */ reason) => ({ gray: () => reason });
/** A control that grays by the table, reading the drawer's current `mode`. */
const byMode = { gray: (/** @type {Values} */ v) => BY_MODE[String(v.mode)] };

/** A dirty member and a clean one, for the family-wide staged state. */
const DIRTY = { hasDirty: () => true };
const CLEAN = { hasDirty: () => false };

test("test_start_values_adds_a_value_the_applied_store_lacks", () => {
  assert.deepEqual(startValues({ a: "1", b: "2" }, { a: "0" }), { b: "2" });
});

test("test_a_staged_edit_marks_its_row_dirty", () => {
  assert.equal(editOf("a", "1", false).dirty, true);
});

test("test_a_live_edit_marks_nothing_dirty", () => {
  assert.equal(editOf("a", "1", true).dirty, false);
});

test("test_a_live_edit_becomes_the_applied_value", () => {
  assert.deepEqual(editOf("a", "1", true).base, { a: "1" });
});

test("test_a_staged_edit_leaves_the_applied_value_alone", () => {
  assert.deepEqual(editOf("a", "1", false).base, {});
});

test("test_an_edit_records_the_current_value", () => {
  assert.deepEqual(editOf("a", "1", false).vals, { a: "1" });
});

test("test_dirty_ids_lists_values_that_differ_from_the_applied_ones_in_order", () => {
  assert.deepEqual(dirtyIds(["a", "b", "c"], { a: "1", b: "2", c: "3" }, { a: "1", b: "9", c: "8" }), ["b", "c"]);
});

test("test_dirty_ids_counts_a_value_with_no_applied_one_as_dirty", () => {
  assert.deepEqual(dirtyIds(["a"], { a: "1" }, {}), ["a"]);
});

test("test_regray_turns_off_a_control_with_a_reason", () => {
  assert.deepEqual(regray([[fixed("r1"), fixed("")]], {}, true, hasXref)[0].off, [true, false]);
});

test("test_regray_reads_the_drawers_current_values", () => {
  assert.deepEqual(regray([[byMode]], { mode: "b" }, true, hasXref)[0].off, [true]);
});

test("test_regray_turns_off_a_control_with_a_blank_reason", () => {
  assert.deepEqual(regray([[byMode]], { mode: "c" }, true, hasXref)[0].off, [true]);
});

test("test_regray_prints_no_line_for_a_blank_reason", () => {
  assert.deepEqual(regray([[byMode]], { mode: "c" }, true, hasXref)[0].reasons, []);
});

test("test_regray_prints_a_reason_two_controls_share_once_in_control_order", () => {
  const rows = [[fixed("r2"), fixed("r1"), fixed("r2")]];
  assert.deepEqual(
    regray(rows, {}, true, hasXref)[0].reasons.map((r) => r.text),
    ["r2", "r1"],
  );
});

test("test_regray_links_the_first_row_showing_a_cross_referenced_reason", () => {
  assert.equal(regray([[fixed("rx")], [fixed("rx")]], {}, true, hasXref)[0].reasons[0].link, true);
});

test("test_regray_does_not_link_a_cross_referenced_reason_on_a_later_row", () => {
  assert.equal(regray([[fixed("rx")], [fixed("rx")]], {}, true, hasXref)[1].reasons[0].link, false);
});

test("test_regray_never_links_on_a_second_mount", () => {
  assert.equal(regray([[fixed("rx")]], {}, false, hasXref)[0].reasons[0].link, false);
});

test("test_restarts_marks_every_tab_of_a_restart_schema", () => {
  assert.equal(restarts({ restart: true }, { body: [] }), true);
});

test("test_restarts_marks_a_restart_tab", () => {
  assert.equal(restarts({}, { restart: true, body: [] }), true);
});

test("test_restarts_marks_a_tab_holding_a_restart_row", () => {
  assert.equal(restarts({}, { body: [{ row: {} }, { row: { restart: true } }] }), true);
});

test("test_restarts_marks_a_tab_holding_a_restart_row_in_a_group", () => {
  assert.equal(restarts({}, { body: [{ group: "net", rows: [{}, { restart: true }] }] }), true);
});

test("test_restarts_passes_over_a_tab_with_no_restart_setting", () => {
  assert.equal(restarts({}, { body: [{ row: {} }, { block: "meter" }] }), false);
});

test("test_apply_group_shows_with_staged_edits", () => {
  assert.equal(applyPaint(false, true).shown, true);
});

test("test_apply_group_shows_on_a_restart_tab_with_no_edits", () => {
  assert.equal(applyPaint(true, false).shown, true);
});

test("test_apply_group_hides_with_no_edits_and_no_restart", () => {
  assert.equal(applyPaint(false, false).shown, false);
});

test("test_apply_group_buttons_are_dead_with_no_edits", () => {
  assert.equal(applyPaint(true, false).live, false);
});

test("test_apply_group_buttons_are_live_with_staged_edits", () => {
  assert.equal(applyPaint(true, true).live, true);
});

test("test_a_drawer_with_its_own_dirty_row_is_staged", () => {
  assert.equal(isStaged(true, []), true);
});

test("test_an_edit_in_another_family_member_stages_this_drawer", () => {
  assert.equal(isStaged(false, [CLEAN, DIRTY]), true);
});

test("test_a_family_with_no_edits_is_not_staged", () => {
  assert.equal(isStaged(false, [CLEAN, CLEAN]), false);
});

test("test_apply_in_a_family_reaches_every_member", () => {
  assert.deepEqual(applyTargets({ members: [CLEAN, DIRTY] }, CLEAN), [CLEAN, DIRTY]);
});

test("test_apply_outside_a_family_reaches_the_drawer_alone", () => {
  assert.deepEqual(applyTargets(null, DIRTY), [DIRTY]);
});

test("test_commit_makes_every_staged_value_applied", () => {
  assert.deepEqual(commit({ a: "1", b: "2" }, { a: "0", c: "3" }), { a: "1", b: "2", c: "3" });
});

test("test_discard_restores_a_staged_value_to_the_applied_one", () => {
  assert.deepEqual(restoreOf("a", { a: "1" }, { a: "0" }), { a: "0" });
});

test("test_discard_restores_an_applied_value_that_is_null", () => {
  assert.deepEqual(restoreOf("a", { a: "1" }, { a: null }), { a: null });
});

test("test_discard_leaves_a_value_equal_to_the_applied_one", () => {
  assert.deepEqual(restoreOf("a", { a: "0" }, { a: "0" }), {});
});

test("test_discard_leaves_a_value_with_no_applied_one", () => {
  assert.deepEqual(restoreOf("a", { a: "1" }, {}), {});
});

test("test_block_restore_puts_back_the_applied_values_a_block_keeps", () => {
  assert.deepEqual(blockRestore(["a", "b"], { a: "0", c: "3" }), { a: "0" });
});
