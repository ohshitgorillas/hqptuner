// Behavioral suite for hqptuner/static/store/faceplate/builders/shell.js: the record builders' shared shell. The record
// being edited, its staged edits, switching, discarding, the confirm line's ask, and Save and Remove over the
// live-snapshot book.
//
// Driven by assigning the exported signals and calling the exported verbs. Save and Remove reach the wire through a
// fetch fake answering /api/livepresets on its real paths and shapes, holding the list the way the backend does, so a
// re-read after a write is observable as the book having moved. Station, record and question text are the fixture's
// own.
//
// Not pinned, since the null stub already satisfies each: Save with no name and Save with no station ticked write
// nothing, an overwrite writes nothing until confirmed, and cancelling a question does not run it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-builders/shell.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { NEW, keyOf, stateOf } from "../../../../hqptuner/static/model/builders/builder.js";
import { liveMode } from "../../../../hqptuner/static/store/ui/prefs.js";
import { liveBook, bookWanted } from "../../../../hqptuner/static/store/live/presets.js";
import {
  cur,
  staged,
  ask,
  refused,
  openOn,
  go,
  stage,
  discard,
  confirm,
  cancelAsk,
  answerAsk,
  isDirty,
  save,
  remove,
  stateNow,
} from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { rec, presetWire, settle } from "../../support/wire/livepresetwire.js";

/** @typedef {import("../../../../hqptuner/static/model/builders/builder.js").Ref} Ref */
/** @typedef {import("../../support/wire/livepresetwire.js").PresetWire} PresetWire */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** A live snapshot record as the book holds it. */
const snap = () => ({ chain: "pcm", fields: { mode: "pcm", filter1x: "40" }, names: {} });

const BOOK = () => ({ Day: { Warm: snap(), Bright: snap() }, Night: { Quiet: snap() }, Spare: {} });
const FIELDS = ["mode", "filter1x"];
const VALUES = { mode: "pcm", filter1x: "40" };
const COPY = { overwrite: (/** @type {string} */ name) => name.toUpperCase() };

const WARM = { st: "Day", name: "Warm" };
const BRIGHT = { st: "Day", name: "Bright" };
const QUIET = { st: "Night", name: "Quiet" };

/** @type {PresetWire} */
let w;

beforeEach(() => {
  liveMode.value = false;
  bookWanted.value = false;
  liveBook.value = null;
  cur.value = { ...WARM };
  staged.value = new Map();
  ask.value = null;
  refused.value = false;
  w = presetWire({
    station: "Day",
    presets: [rec("Warm", "pcm"), rec("Bright", "pcm")],
    others: { Night: [rec("Quiet", "pcm")] },
  });
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * A Save's argument, writing `name` to the stations `to`.
 *
 * @param {string} name
 * @param {string[]} to
 */
const saving = (name, to) => ({ book: BOOK(), name, to, fields: FIELDS, values: VALUES, copy: COPY });

/** A question on the confirm line whose answer counts in `ran.n`. */
const counted = () => {
  const ran = { n: 0 };
  return { ran, q: { text: "sure?", onConfirm: () => void ran.n++ } };
};

/**
 * How many calls the wire took with this method on this path.
 *
 * @param {string} method
 * @param {string} path
 */
const callCount = (method, path) => w.calls.filter((c) => c.method === method && c.path === path).length;

/** The methods of every live-snapshot call, in arrival order. */
const presetMethods = () => w.calls.filter((c) => c.path.startsWith("/api/livepresets")).map((c) => c.method);

/** The parsed body of the first PUT, or undefined. */
const putBody = () => {
  const body = w.calls.find((c) => c.method === "PUT")?.body;
  return body === undefined ? undefined : JSON.parse(body);
};

/** The staged keys, sorted. */
const stagedKeys = () => [...staged.value.keys()].sort();

/** The names the book holds under a station, in list order. */
const bookNames = (/** @type {string} */ st) => Object.keys(liveBook.value?.[st] ?? {});

test("test_opening_lands_on_the_loaded_stations_first_record", () => {
  openOn(BOOK(), "Night");
  assert.deepEqual(cur.value, QUIET);
});

test("test_opening_a_station_with_no_records_lands_on_its_new_entry", () => {
  openOn(BOOK(), "Spare");
  assert.deepEqual(cur.value, { st: "Spare", name: NEW });
});

test("test_opening_a_station_the_book_has_no_entry_for_lands_on_its_new_entry", () => {
  openOn(BOOK(), "Attic");
  assert.deepEqual(cur.value, { st: "Attic", name: NEW });
});

test("test_going_to_a_record_makes_it_current", () => {
  go(QUIET);
  assert.deepEqual(cur.value, QUIET);
});

test("test_going_clears_the_question", () => {
  ask.value = counted().q;
  go(QUIET);
  assert.equal(ask.value, null);
});

test("test_going_clears_the_refusal", () => {
  refused.value = true;
  go(QUIET);
  assert.equal(refused.value, false);
});

test("test_a_record_left_with_an_edit_still_reads_dirty_after_switching", () => {
  staged.value = new Map([[keyOf(WARM), { mode: "sdm" }]]);
  go(QUIET);
  assert.equal(isDirty(WARM, false), true);
});

test("test_staging_holds_the_edit_under_the_current_records_key", () => {
  const buf = { mode: "sdm" };
  stage(buf);
  assert.equal(staged.value.get(keyOf(WARM)), buf);
});

test("test_staging_null_drops_the_current_records_edit", () => {
  staged.value = new Map([[keyOf(WARM), { mode: "sdm" }]]);
  stage(null);
  assert.equal(staged.value.has(keyOf(WARM)), false);
});

test("test_staging_keeps_other_records_edits", () => {
  staged.value = new Map([[keyOf(QUIET), { mode: "sdm" }]]);
  stage({ mode: "pcm" });
  assert.deepEqual(stagedKeys(), [keyOf(WARM), keyOf(QUIET)].sort());
});

test("test_discarding_keeps_only_other_records_edits", () => {
  staged.value = new Map([
    [keyOf(WARM), { mode: "sdm" }],
    [keyOf(QUIET), { mode: "sdm" }],
  ]);
  discard();
  assert.deepEqual(stagedKeys(), [keyOf(QUIET)]);
});

test("test_discarding_clears_the_question", () => {
  ask.value = counted().q;
  discard();
  assert.equal(ask.value, null);
});

test("test_discarding_clears_the_refusal", () => {
  refused.value = true;
  discard();
  assert.equal(refused.value, false);
});

test("test_confirming_puts_the_question_on_the_line", () => {
  confirm("sure?", () => {});
  assert.equal(ask.value?.text, "sure?");
});

test("test_cancelling_the_question_clears_it", () => {
  ask.value = counted().q;
  cancelAsk();
  assert.equal(ask.value, null);
});

test("test_answering_the_question_runs_it_once", () => {
  const { ran, q } = counted();
  ask.value = q;
  answerAsk();
  assert.equal(ran.n, 1);
});

test("test_answering_the_question_clears_it", () => {
  ask.value = counted().q;
  answerAsk();
  assert.equal(ask.value, null);
});

test("test_the_current_record_reads_dirty_by_its_live_comparison", () => {
  assert.equal(isDirty(WARM, true), true);
});

test("test_the_current_record_reads_clean_by_its_live_comparison_whatever_is_staged", () => {
  staged.value = new Map([[keyOf(WARM), { mode: "sdm" }]]);
  assert.equal(isDirty(WARM, false), false);
});

test("test_another_record_reads_dirty_by_its_staged_edit", () => {
  staged.value = new Map([[keyOf(QUIET), { mode: "sdm" }]]);
  assert.equal(isDirty(QUIET, false), true);
});

test("test_saving_with_no_name_refuses", async () => {
  await save(saving("", ["Day"]));
  assert.equal(refused.value, true);
});

test("test_saving_over_a_held_name_asks_with_the_overwrite_question", async () => {
  await save(saving("Bright", ["Day"]));
  assert.equal(ask.value?.text, "BRIGHT");
});

test("test_confirming_an_overwrite_writes_it", async () => {
  await save(saving("Bright", ["Day"]));
  answerAsk();
  await settle();
  assert.equal(callCount("PUT", "/api/livepresets/Bright"), 1);
});

test("test_saving_to_several_stations_puts_once", async () => {
  await save(saving("Cosy", ["Day", "Night"]));
  await settle();
  assert.equal(callCount("PUT", "/api/livepresets/Cosy"), 1);
});

test("test_the_put_names_every_ticked_station", async () => {
  await save(saving("Cosy", ["Day", "Night"]));
  await settle();
  assert.deepEqual(putBody()?.stations, ["Day", "Night"]);
});

test("test_the_put_names_the_fields_kept", async () => {
  await save(saving("Cosy", ["Day"]));
  await settle();
  assert.deepEqual(putBody()?.fields, FIELDS);
});

test("test_renaming_a_saved_record_deletes_the_old_name_in_its_station", async () => {
  await save(saving("Cosy", ["Day"]));
  await settle();
  assert.equal(callCount("DELETE", "/api/livepresets/Warm?station=Day"), 1);
});

test("test_moving_a_saved_record_out_of_its_station_deletes_it_there", async () => {
  await save(saving("Warm", ["Night"]));
  await settle();
  assert.equal(callCount("DELETE", "/api/livepresets/Warm?station=Day"), 1);
});

test("test_resaving_a_record_in_place_puts_and_rereads_without_deleting", async () => {
  await save(saving("Warm", ["Day", "Night"]));
  await settle();
  assert.deepEqual(presetMethods(), ["PUT", "GET"]);
});

test("test_saving_the_new_entry_elsewhere_puts_and_rereads_without_deleting", async () => {
  cur.value = { st: "Day", name: NEW };
  await save(saving("Cosy", ["Night"]));
  await settle();
  assert.deepEqual(presetMethods(), ["PUT", "GET"]);
});

test("test_a_save_rereads_the_book", async () => {
  cur.value = { st: "Day", name: NEW };
  await save(saving("Cosy", ["Day"]));
  await settle();
  assert.deepEqual(bookNames("Day"), ["Warm", "Bright", "Cosy"]);
});

test("test_a_save_drops_the_old_records_staged_edit", async () => {
  staged.value = new Map([[keyOf(WARM), { mode: "sdm" }]]);
  await save(saving("Cosy", ["Day"]));
  await settle();
  assert.equal(staged.value.has(keyOf(WARM)), false);
});

test("test_a_save_drops_the_new_records_staged_edit", async () => {
  staged.value = new Map([[keyOf({ st: "Day", name: "Cosy" }), { mode: "sdm" }]]);
  await save(saving("Cosy", ["Day"]));
  await settle();
  assert.equal(staged.value.has(keyOf({ st: "Day", name: "Cosy" })), false);
});

test("test_a_save_keeps_the_record_in_its_station_while_ticked", async () => {
  await save(saving("Cosy", ["Night", "Day"]));
  await settle();
  assert.deepEqual(cur.value, { st: "Day", name: "Cosy" });
});

test("test_a_save_moves_the_record_to_the_first_ticked_station_when_its_own_is_not", async () => {
  await save(saving("Cosy", ["Night", "Spare"]));
  await settle();
  assert.deepEqual(cur.value, { st: "Night", name: "Cosy" });
});

test("test_removing_deletes_the_current_record_in_its_station", async () => {
  await remove({ book: BOOK() });
  await settle();
  assert.equal(callCount("DELETE", "/api/livepresets/Warm?station=Day"), 1);
});

test("test_a_remove_rereads_the_book", async () => {
  await remove({ book: BOOK() });
  await settle();
  assert.deepEqual(bookNames("Day"), ["Bright"]);
});

test("test_removing_lands_where_asked", async () => {
  await remove({ book: BOOK(), land: QUIET });
  await settle();
  assert.deepEqual(cur.value, QUIET);
});

test("test_removing_without_a_landing_lands_on_the_first_record_left", async () => {
  await remove({ book: BOOK() });
  await settle();
  assert.deepEqual(cur.value, BRIGHT);
});

test("test_removing_a_stations_last_record_lands_on_its_new_entry", async () => {
  cur.value = { ...QUIET };
  await remove({ book: BOOK() });
  await settle();
  assert.deepEqual(cur.value, { st: "Night", name: NEW });
});

test("test_removing_drops_the_records_staged_edit", async () => {
  staged.value = new Map([[keyOf(WARM), { mode: "sdm" }]]);
  await remove({ book: BOOK() });
  await settle();
  assert.equal(staged.value.has(keyOf(WARM)), false);
});

test("test_the_new_entry_reads_pending_without_edits", () => {
  cur.value = { st: "Day", name: NEW };
  assert.equal(stateNow({ dirty: false, ticked: true })?.pending, true);
});

test("test_a_saved_record_without_edits_reads_settled", () => {
  assert.equal(stateNow({ dirty: false, ticked: true })?.pending, false);
});

test("test_a_dirty_record_reads_the_line_of_a_save_that_does_not_restart", () => {
  const line = stateOf({ dirty: true, isNew: false, ticked: true, restarts: false, live: false }).line;
  assert.equal(stateNow({ dirty: true, ticked: true })?.line, line);
});

test("test_a_clean_record_reads_the_line_of_a_record_the_engine_is_not_running", () => {
  const line = stateOf({ dirty: false, isNew: false, ticked: true, restarts: false, live: false }).line;
  assert.equal(stateNow({ dirty: false, ticked: true })?.line, line);
});

test("test_save_is_off_with_no_station_ticked", () => {
  assert.equal(stateNow({ dirty: true, ticked: false })?.saveOff, true);
});

test("test_save_is_on_for_an_edit_with_a_station_ticked", () => {
  assert.equal(stateNow({ dirty: true, ticked: true })?.saveOff, false);
});
