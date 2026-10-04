// Behavioral suite for mockup/scripts/model/builder.js: the decisions the three builders' shared shell makes, each a
// value in and a value out. Which station is home, how a record keys its staged edit, which step Next and Back land
// on, whether a record reads dirty, what the state line and its buttons say, how the stations menu ticks, whether Save
// refuses, asks or writes, and the record book after a save, a rename, a move and a remove.
//
// Every record book is a table this file writes. The transitions return new values, so a test may also hold the input
// and check it is left as it was.
//
// Run: node --test tests/js/mockup/builder.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  NEW,
  OVERVIEW,
  homeOf,
  keyOf,
  shownName,
  nextStep,
  prevStep,
  dirtyAt,
  stashed,
  stateOf,
  toggleStation,
  heldAt,
  savePlan,
  savedTo,
  namesAfterSave,
  removedFrom,
} from "../../../../mockup/scripts/model/builder.js";

/** @typedef {import("../../../../mockup/scripts/model/builder.js").Ref} Ref */
/** @typedef {{ v: number }} Rec */
/** @typedef {import("../../../../mockup/scripts/model/builder.js").Book<Rec>} Book */

//: The stations a tree lists, in tree order.
const TREE = ["Den", "Loft", "Shed"];
//: The walk's step ids, in order.
const STEPS = ["alpha", "bravo", "charlie", "delta"];

/** A record book: Den holds three, Loft one, Shed none. */
const book = () =>
  /** @type {Book} */ ({
    Den: { Warm: { v: 1 }, Flat: { v: 2 }, Bright: { v: 3 } },
    Loft: { Warm: { v: 4 } },
    Shed: {},
  });

/**
 * A skip predicate over a fixed set of step ids.
 *
 * @param {string[]} ids
 */
const skipping = (ids) => (/** @type {string} */ id) => ids.includes(id);

/**
 * The state the shell paints for one set of facts, every fact clean unless the case says otherwise.
 *
 * @param {Partial<{ dirty: boolean, isNew: boolean, ticked: boolean, restarts: boolean, live: boolean }>} facts
 */
const state = (facts) => stateOf({ dirty: false, isNew: false, ticked: true, restarts: false, live: false, ...facts });

/** @param {string} name */
const den = (name) => /** @type {Ref} */ ({ st: "Den", name });

// ── Home and keys ──────────────────────────────────────────────────────────

test("test_the_active_station_is_home", () => {
  assert.equal(homeOf([{ name: "Den" }, { name: "Loft", active: true }, { name: "Shed" }]), "Loft");
});

test("test_with_no_active_station_the_first_is_home", () => {
  assert.equal(homeOf([{ name: "Shed" }, { name: "Den" }]), "Shed");
});

test("test_one_name_in_two_stations_keys_apart", () => {
  assert.notEqual(keyOf({ st: "Den", name: "Warm" }), keyOf({ st: "Loft", name: "Warm" }));
});

test("test_new_keys_alike_whichever_station_it_lands_in", () => {
  assert.equal(keyOf({ st: "Den", name: NEW }), keyOf({ st: "Loft", name: NEW }));
});

test("test_a_new_key_differs_from_a_named_records", () => {
  assert.notEqual(keyOf({ st: "Den", name: NEW }), keyOf(den("Warm")));
});

test("test_a_typed_name_is_the_name_shown", () => {
  assert.equal(shownName("Cosy", den("Warm")), "Cosy");
});

test("test_an_untyped_name_shows_the_records_own", () => {
  assert.equal(shownName("", den("Warm")), "Warm");
});

test("test_an_untyped_new_record_shows_no_sentinel", () => {
  assert.notEqual(shownName("", den(NEW)), NEW);
});

// ── Next and Back ──────────────────────────────────────────────────────────

test("test_next_passes_a_skipped_step", () => {
  assert.equal(nextStep(STEPS, 0, skipping(["bravo"])), "charlie");
});

test("test_next_lands_on_the_following_step_when_none_is_skipped", () => {
  assert.equal(nextStep(STEPS, 1, skipping([])), "charlie");
});

test("test_next_from_the_last_step_returns_to_the_overview", () => {
  assert.equal(nextStep(STEPS, 3, skipping([])), OVERVIEW);
});

test("test_next_with_every_later_step_skipped_returns_to_the_overview", () => {
  assert.equal(nextStep(STEPS, 1, skipping(["charlie", "delta"])), OVERVIEW);
});

test("test_back_passes_a_skipped_step", () => {
  assert.equal(prevStep(STEPS, 3, skipping(["charlie"])), "bravo");
});

test("test_back_from_the_first_step_returns_to_the_overview", () => {
  assert.equal(prevStep(STEPS, 0, skipping([])), OVERVIEW);
});

// ── Dirty and staged ───────────────────────────────────────────────────────

test("test_the_record_being_edited_reads_its_live_dirt", () => {
  assert.equal(dirtyAt("k1", "k1", new Map(), true), true);
});

test("test_the_record_being_edited_ignores_a_stale_staged_edit", () => {
  assert.equal(dirtyAt("k1", "k1", new Map([["k1", 0]]), false), false);
});

test("test_another_record_is_dirty_while_its_edit_is_staged", () => {
  assert.equal(dirtyAt("k2", "k1", new Map([["k2", 0]]), false), true);
});

test("test_another_record_with_nothing_staged_is_clean", () => {
  assert.equal(dirtyAt("k2", "k1", new Map(), true), false);
});

test("test_a_dirty_edit_is_staged_under_its_key", () => {
  const buf = { v: 9 };
  assert.equal(stashed(new Map(), "k1", buf).get("k1"), buf);
});

test("test_a_clean_edit_drops_its_staged_key", () => {
  assert.equal(stashed(new Map([["k1", { v: 9 }]]), "k1", null).has("k1"), false);
});

test("test_staging_leaves_other_keys_staged", () => {
  assert.equal(stashed(new Map([["k2", { v: 8 }]]), "k1", null).has("k2"), true);
});

test("test_staging_leaves_the_map_it_was_given_as_it_was", () => {
  const before = new Map();
  stashed(before, "k1", { v: 9 });
  assert.equal(before.has("k1"), false);
});

// ── State line and buttons ─────────────────────────────────────────────────

test("test_discard_is_off_while_the_edit_is_clean", () => {
  assert.equal(state({}).discardOff, true);
});

test("test_discard_is_on_once_the_edit_is_dirty", () => {
  assert.equal(state({ dirty: true }).discardOff, false);
});

test("test_save_is_off_for_a_clean_saved_record", () => {
  assert.equal(state({}).saveOff, true);
});

test("test_save_is_on_for_a_clean_new_record", () => {
  assert.equal(state({ isNew: true }).saveOff, false);
});

test("test_save_is_off_with_no_station_ticked", () => {
  assert.equal(state({ dirty: true, ticked: false }).saveOff, true);
});

test("test_a_dirty_edit_that_restarts_reads_as_restarting", () => {
  assert.equal(state({ dirty: true, restarts: true }).line, "restarts");
});

test("test_a_dirty_edit_that_does_not_restart_reads_as_dirty", () => {
  assert.equal(state({ dirty: true, live: true }).line, "dirty");
});

test("test_a_clean_new_record_reads_as_unsaved", () => {
  assert.equal(state({ isNew: true, restarts: true }).line, "restarts");
});

test("test_a_clean_record_the_engine_runs_reads_as_live", () => {
  assert.equal(state({ live: true }).line, "live");
});

test("test_a_clean_record_the_engine_does_not_run_reads_as_saved", () => {
  assert.equal(state({ restarts: true }).line, "saved");
});

test("test_a_new_record_marks_the_state_line_pending", () => {
  assert.equal(state({ isNew: true }).pending, true);
});

test("test_a_clean_saved_record_leaves_the_state_line_plain", () => {
  assert.equal(state({ live: true }).pending, false);
});

// ── Stations menu ──────────────────────────────────────────────────────────

test("test_ticking_a_station_keeps_the_tree_order", () => {
  assert.deepEqual(toggleStation(TREE, ["Shed"], "Den"), ["Den", "Shed"]);
});

test("test_unticking_a_station_drops_it", () => {
  assert.deepEqual(toggleStation(TREE, ["Den", "Shed"], "Den"), ["Shed"]);
});

test("test_another_station_holding_the_name_is_marked", () => {
  assert.equal(heldAt(book(), den("Flat"), "Warm", "Loft"), true);
});

test("test_the_records_own_slot_is_not_marked", () => {
  assert.equal(heldAt(book(), den("Warm"), "Warm", "Den"), false);
});

test("test_a_station_without_the_name_is_not_marked", () => {
  assert.equal(heldAt(book(), den("Warm"), "Bright", "Loft"), false);
});

test("test_a_name_every_object_answers_to_is_not_held", () => {
  assert.equal(heldAt(book(), den("Warm"), "toString", "Shed"), false);
});

test("test_no_name_marks_no_station", () => {
  assert.equal(heldAt(book(), den(NEW), "", "Den"), false);
});

// ── Save plan ──────────────────────────────────────────────────────────────

test("test_save_with_no_name_refuses", () => {
  assert.equal(savePlan(book(), den("Warm"), "", ["Den"]), "refuse");
});

test("test_save_with_no_station_ticked_does_nothing", () => {
  assert.equal(savePlan(book(), den("Warm"), "Warm", []), "idle");
});

test("test_save_onto_a_name_another_station_holds_asks", () => {
  assert.equal(savePlan(book(), den("Flat"), "Warm", ["Loft"]), "ask");
});

test("test_save_onto_a_sibling_in_its_own_station_asks", () => {
  assert.equal(savePlan(book(), den("Flat"), "Bright", ["Den"]), "ask");
});

test("test_save_under_its_own_name_writes", () => {
  assert.equal(savePlan(book(), den("Warm"), "Warm", ["Den"]), "write");
});

test("test_save_under_a_free_name_writes", () => {
  assert.equal(savePlan(book(), den(NEW), "Cosy", ["Den", "Loft"]), "write");
});

// ── Save, rename and move ──────────────────────────────────────────────────

test("test_a_new_record_lands_in_every_ticked_station", () => {
  const out = savedTo(book(), den(NEW), "Cosy", ["Den", "Shed"], { v: 7 }, false);
  assert.deepEqual(out.book.Shed.Cosy, { v: 7 });
});

test("test_a_new_record_goes_to_the_end_of_its_station", () => {
  const out = savedTo(book(), den(NEW), "Cosy", ["Den"], { v: 7 }, false);
  assert.deepEqual(Object.keys(out.book.Den), ["Warm", "Flat", "Bright", "Cosy"]);
});

test("test_a_new_record_is_then_edited_in_its_first_ticked_station", () => {
  const out = savedTo(book(), { st: "Den", name: NEW }, "Cosy", ["Loft", "Shed"], { v: 7 }, false);
  assert.deepEqual(out.cur, { st: "Loft", name: "Cosy" });
});

test("test_a_rename_in_place_keeps_its_place_in_the_list", () => {
  const out = savedTo(book(), den("Flat"), "Neutral", ["Den"], { v: 7 }, false);
  assert.deepEqual(Object.keys(out.book.Den), ["Warm", "Neutral", "Bright"]);
});

test("test_a_rename_in_place_writes_the_edit_under_the_new_name", () => {
  const out = savedTo(book(), den("Flat"), "Neutral", ["Den"], { v: 7 }, false);
  assert.deepEqual(out.book.Den.Neutral, { v: 7 });
});

test("test_a_rename_onto_a_sibling_replaces_the_sibling", () => {
  const out = savedTo(book(), den("Flat"), "Bright", ["Den"], { v: 7 }, false);
  assert.deepEqual(Object.keys(out.book.Den), ["Warm", "Bright"]);
});

test("test_an_edit_saved_under_its_own_name_keeps_its_place", () => {
  const out = savedTo(book(), den("Warm"), "Warm", ["Den"], { v: 7 }, false);
  assert.deepEqual(Object.keys(out.book.Den), ["Warm", "Flat", "Bright"]);
});

test("test_unticking_its_own_station_moves_the_record_out", () => {
  const out = savedTo(book(), den("Flat"), "Flat", ["Shed"], { v: 7 }, false);
  assert.deepEqual(Object.keys(out.book.Den), ["Warm", "Bright"]);
});

test("test_a_record_that_stays_is_copied_not_moved", () => {
  const out = savedTo(book(), den("Flat"), "Flat", ["Shed"], { v: 7 }, true);
  assert.deepEqual(Object.keys(out.book.Den), ["Warm", "Flat", "Bright"]);
});

test("test_a_moved_record_is_then_edited_where_it_went", () => {
  const out = savedTo(book(), den("Flat"), "Flat", ["Loft", "Shed"], { v: 7 }, false);
  assert.deepEqual(out.cur, { st: "Loft", name: "Flat" });
});

test("test_a_record_kept_in_its_station_is_still_edited_there", () => {
  const out = savedTo(book(), den("Flat"), "Flat", ["Loft", "Den"], { v: 7 }, false);
  assert.deepEqual(out.cur, { st: "Den", name: "Flat" });
});

test("test_saving_leaves_the_book_it_was_given_as_it_was", () => {
  const before = book();
  savedTo(before, den("Flat"), "Neutral", ["Den", "Shed"], { v: 7 }, false);
  assert.deepEqual(before, book());
});

test("test_a_saved_record_is_a_copy_of_the_edit", () => {
  const rec = { v: 7 };
  const out = savedTo(book(), den(NEW), "Cosy", ["Shed"], rec, false);
  assert.notEqual(out.book.Shed.Cosy, rec);
});

test("test_a_new_name_joins_the_end_of_the_list", () => {
  assert.deepEqual(namesAfterSave(TREE, NEW, "Attic"), ["Den", "Loft", "Shed", "Attic"]);
});

test("test_a_new_record_over_a_listed_name_keeps_the_list", () => {
  assert.deepEqual(namesAfterSave(TREE, NEW, "Loft"), TREE);
});

test("test_a_listed_rename_keeps_its_place", () => {
  assert.deepEqual(namesAfterSave(TREE, "Loft", "Attic"), ["Den", "Attic", "Shed"]);
});

test("test_a_listed_rename_onto_another_drops_the_other", () => {
  assert.deepEqual(namesAfterSave(TREE, "Loft", "Shed"), ["Den", "Shed"]);
});

test("test_saving_a_listed_name_as_itself_keeps_the_list", () => {
  assert.deepEqual(namesAfterSave(TREE, "Loft", "Loft"), TREE);
});

// ── Remove ─────────────────────────────────────────────────────────────────

test("test_a_removed_record_leaves_its_station", () => {
  assert.deepEqual(Object.keys(removedFrom(book(), den("Warm")).book.Den), ["Flat", "Bright"]);
});

test("test_after_a_remove_the_first_left_in_its_station_is_edited", () => {
  assert.deepEqual(removedFrom(book(), den("Flat")).cur, den("Warm"));
});

test("test_after_removing_a_stations_last_record_a_new_one_is_edited", () => {
  assert.deepEqual(removedFrom(book(), { st: "Loft", name: "Warm" }).cur, { st: "Loft", name: NEW });
});

test("test_a_landing_given_with_the_remove_is_the_one_edited", () => {
  assert.deepEqual(removedFrom(book(), den("Flat"), { st: "Loft", name: "Warm" }).cur, { st: "Loft", name: "Warm" });
});

test("test_removing_leaves_the_book_it_was_given_as_it_was", () => {
  const before = book();
  removedFrom(before, den("Warm"));
  assert.deepEqual(before, book());
});
