// Behavioral suite for hqptuner/static/model/store/reading.js: what a field shows, whether its reading is fresh, and the
// one view of a field, composed from the served reading and the page's own held values.
//
// Every reading is one this file writes, in the shape the server serves a field reading, and in every one the Engine
// and the File disagree. Each held value is distinct from every store's, so a shown value names the one it came from.
//
// Not covered, because the design leaves it open: what a view shows beyond `unread` for a field with no reading at all
// (its value, staged, dirty, lane, restart mark and bounds).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/store/reading.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fieldOf, freshAt, shownOf } from "../../../../hqptuner/static/model/store/reading.js";

/** @typedef {import("../../../../hqptuner/static/model/store/reading.js").FieldReading} FieldReading */
/** @typedef {import("../../../../hqptuner/static/model/store/reading.js").LocalValues} LocalValues */
/** @typedef {import("../../../../hqptuner/static/model/store/reading.js").Bounds} Bounds */
/** @typedef {FieldReading["show"]} Show */
/** @typedef {FieldReading["lane"]} Lane */

/** The Engine's value, a list index. */
const ENGINE_VALUE = 3;
/** The File's value, an enum ID. */
const FILE_VALUE = 40;
/** The pending buffer's value, as the server serves it. */
const SERVED_STAGED = 12;
/** A value the page staged that no reading has echoed yet. */
const PAGE_STAGED = 17;
/** The value the page's held drag carries. */
const DRAG = 21;
/** The generation the page is at, and the one its readings were taken in. */
const GEN = 5;

/** @type {Record<Show, unknown>} */
const VALUE_OF = { engine: ENGINE_VALUE, file: FILE_VALUE };
/** @type {Show[]} */
const SHOWS = ["engine", "file"];
/** @type {Lane[]} */
const LANES = ["live", "restore", "form", "matrix", "volume"];

/**
 * A served reading, both stores stamped `stamp`, disagreeing, nothing staged.
 *
 * @param {Partial<FieldReading>} [over]
 * @param {number} [stamp]
 * @returns {FieldReading}
 */
const reading = (over = {}, stamp = GEN) => ({
  engine: { value: ENGINE_VALUE, name: "e", generation: stamp },
  file: { value: FILE_VALUE, generation: stamp },
  staged: null,
  lane: "live",
  show: "engine",
  restarts: false,
  diverges: true,
  bounds: { min: 0, max: 63, step: 1 },
  ...over,
});

/** @type {Record<Show, Show>} */
const OTHER = { engine: "file", file: "engine" };

/**
 * A served reading showing `show`, with the store `old` stamped one generation before GEN and the other store at GEN.
 *
 * @param {Show} show
 * @param {Show} old
 * @returns {FieldReading}
 */
const aged = (show, old) => {
  const stamp = { engine: GEN, file: GEN, [old]: GEN - 1 };
  return reading({
    show,
    engine: { value: ENGINE_VALUE, name: "e", generation: stamp.engine },
    file: { value: FILE_VALUE, generation: stamp.file },
  });
};

/**
 * Locals in which the page holds nothing, one per way of saying so.
 *
 * @type {{ name: string, local: LocalValues }[]}
 */
const HOLDS_NONE = [
  { name: "no_members", local: {} },
  { name: "undefined_members", local: { drag: undefined, staged: undefined } },
  { name: "null_members", local: { drag: null, staged: null } },
];

// ---------------------------------------------------------------------------------------------------------------------
// shownOf: the held drag, else the staged edit, else the named store.

/** @type {{ name: string, local: LocalValues, want: unknown }[]} */
const PRECEDENCE = [
  { name: "a_held_drag_is_shown_over_a_staged_edit", local: { drag: DRAG, staged: PAGE_STAGED }, want: DRAG },
  { name: "a_held_drag_at_zero_is_shown_over_a_staged_edit", local: { drag: 0, staged: PAGE_STAGED }, want: 0 },
  { name: "a_held_drag_is_shown_over_the_store", local: { drag: DRAG }, want: DRAG },
  { name: "a_staged_edit_is_shown_when_no_drag_is_held", local: { staged: PAGE_STAGED }, want: PAGE_STAGED },
  {
    name: "a_staged_edit_is_shown_when_the_drag_is_undefined",
    local: { drag: undefined, staged: PAGE_STAGED },
    want: PAGE_STAGED,
  },
  {
    name: "a_staged_edit_is_shown_when_the_drag_is_null",
    local: { drag: null, staged: PAGE_STAGED },
    want: PAGE_STAGED,
  },
  { name: "a_staged_edit_at_zero_is_shown_over_the_store", local: { staged: 0 }, want: 0 },
];

for (const row of PRECEDENCE) {
  test(`test_${row.name}`, () => {
    assert.equal(shownOf(reading(), row.local), row.want);
  });
}

for (const show of SHOWS) {
  for (const none of HOLDS_NONE) {
    test(`test_with_${none.name}_held_the_${show}_the_reading_names_is_shown`, () => {
      assert.equal(shownOf(reading({ show }), none.local), VALUE_OF[show]);
    });
  }
}

/** A named store with no reading, and the other store's value it must not borrow. */
const EMPTY_NAMED = [
  { show: /** @type {Show} */ ("engine"), empty: reading({ show: "engine", engine: null }), other: FILE_VALUE },
  { show: /** @type {Show} */ ("file"), empty: reading({ show: "file", file: null }), other: ENGINE_VALUE },
];

for (const row of EMPTY_NAMED) {
  test(`test_a_named_${row.show}_with_no_reading_shows_nothing_from_the_other_store`, () => {
    const held = shownOf(reading({ show: row.show }), {});
    const empty = shownOf(row.empty, {});
    assert.deepEqual([held, empty], [VALUE_OF[row.show], null]);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// freshAt: a reading taken before the generation is not fresh (settings-truth rule 5).

for (const stamp of [0, GEN]) {
  test(`test_a_reading_taken_in_generation_${stamp}_is_fresh_there_and_stale_at_the_next`, () => {
    const taken = reading({}, stamp);
    assert.deepEqual([freshAt(taken, stamp), freshAt(taken, stamp + 1)], [true, false]);
  });
}

test("test_a_reading_taken_after_the_generation_is_fresh", () => {
  assert.equal(freshAt(reading({}, GEN + 1), GEN), true);
});

for (const show of SHOWS) {
  test(`test_a_reading_showing_the_${show}_goes_stale_on_its_own_old_stamp_beside_a_current_one`, () => {
    const current = reading({ show });
    assert.deepEqual([freshAt(current, GEN), freshAt(aged(show, show), GEN)], [true, false]);
  });

  test(`test_a_reading_showing_the_${show}_stays_fresh_on_its_own_stamp_beside_an_old_one`, () => {
    assert.equal(freshAt(aged(show, OTHER[show]), GEN), true);
  });

  test(`test_a_reading_showing_the_${show}_with_no_${show}_store_is_not_fresh`, () => {
    const unreadStore = reading({ show, [show]: null });
    assert.deepEqual([freshAt(reading({ show }), GEN), freshAt(unreadStore, GEN)], [true, false]);
  });
}

test("test_a_missing_reading_is_not_fresh", () => {
  assert.deepEqual([freshAt(reading(), GEN), freshAt(undefined, GEN)], [true, false]);
});

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf: unread once the generation passes the reading; never the old value, never the File's.

test("test_a_view_reads_unread_once_the_generation_passes_its_reading", () => {
  const taken = reading({ show: "engine" });
  assert.deepEqual([fieldOf(taken, {}, GEN).unread, fieldOf(taken, {}, GEN + 1).unread], [false, true]);
});

test("test_an_unread_view_shows_neither_the_old_engine_value_nor_the_files", () => {
  const taken = reading({ show: "engine" });
  const stale = fieldOf(taken, {}, GEN + 1).value;
  /** @type {unknown[]} */
  const stores = [ENGINE_VALUE, FILE_VALUE];
  assert.deepEqual([fieldOf(taken, {}, GEN).value, stores.includes(stale)], [ENGINE_VALUE, false]);
});

test("test_an_unread_file_shown_view_with_nothing_held_shows_nothing", () => {
  const taken = reading({ show: "file" });
  assert.deepEqual([fieldOf(taken, {}, GEN).value, fieldOf(taken, {}, GEN + 1).value], [FILE_VALUE, null]);
});

test("test_a_file_shown_view_reads_unread_on_an_old_file_stamp_beside_a_current_engine_stamp", () => {
  const current = fieldOf(reading({ show: "file" }), {}, GEN).unread;
  const fileOld = fieldOf(aged("file", "file"), {}, GEN).unread;
  assert.deepEqual([current, fileOld], [false, true]);
});

test("test_a_field_with_no_reading_reads_unread", () => {
  assert.equal(fieldOf(undefined, {}, GEN).unread, true);
});

for (const show of SHOWS) {
  test(`test_an_unread_view_showing_the_${show}_runs_at_nothing`, () => {
    const taken = reading({ show });
    assert.deepEqual([fieldOf(taken, {}, GEN).running, fieldOf(taken, {}, GEN + 1).running], [VALUE_OF[show], null]);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf while unread: only the store fallback is withheld; the page's drag and every staged value still show.

test("test_an_unread_view_still_shows_the_held_drag", () => {
  const local = { drag: DRAG, staged: PAGE_STAGED };
  assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), local, GEN + 1).value, DRAG);
});

test("test_an_unread_view_still_shows_the_page_staged_value", () => {
  assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), { staged: PAGE_STAGED }, GEN + 1).value, PAGE_STAGED);
});

test("test_an_unread_view_still_shows_the_served_staged_value", () => {
  assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), {}, GEN + 1).value, SERVED_STAGED);
});

test("test_an_unread_view_keeps_the_served_staged_value_as_its_staged", () => {
  assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), {}, GEN + 1).staged, SERVED_STAGED);
});

test("test_an_unread_view_with_a_served_staged_value_is_dirty", () => {
  assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), {}, GEN + 1).dirty, true);
});

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf: the Engine and File stores as served, stamps included, each kept only while its own stamp is current.

for (const store of SHOWS) {
  test(`test_the_view_holds_each_store_as_served_by_its_own_stamp_with_the_${store}_old`, () => {
    const taken = aged("engine", store);
    const view = fieldOf(taken, {}, GEN);
    assert.deepEqual([view[store], view[OTHER[store]]], [null, taken[OTHER[store]]]);
  });

  test(`test_the_${store}_store_served_null_is_null_in_the_view`, () => {
    const taken = reading({ show: OTHER[store], [store]: null });
    const view = fieldOf(taken, {}, GEN);
    assert.deepEqual([view[store], view[OTHER[store]]], [null, taken[OTHER[store]]]);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf: the view's staged is the page's own, else the served one.

/** @type {{ name: string, local: LocalValues, want: unknown }[]} */
const PAGE_STAGES = [
  { name: "a_page_staged_value", local: { staged: PAGE_STAGED }, want: PAGE_STAGED },
  { name: "a_page_staged_zero", local: { staged: 0 }, want: 0 },
];

for (const row of PAGE_STAGES) {
  test(`test_the_view_stages_${row.name}_over_the_served_one`, () => {
    assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), row.local, GEN).staged, row.want);
  });
}

for (const none of HOLDS_NONE) {
  test(`test_with_${none.name}_held_the_view_stages_the_served_value`, () => {
    assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), none.local, GEN).staged, SERVED_STAGED);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf: value is the held drag, else the view's staged, else the named store.

test("test_the_view_value_shows_a_held_drag_over_a_page_and_a_served_staged_value", () => {
  const local = { drag: DRAG, staged: PAGE_STAGED };
  assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), local, GEN).value, DRAG);
});

test("test_the_view_value_shows_the_page_staged_value_over_the_served_one", () => {
  assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), { staged: PAGE_STAGED }, GEN).value, PAGE_STAGED);
});

for (const none of HOLDS_NONE) {
  test(`test_with_${none.name}_held_the_view_value_shows_the_served_staged_value`, () => {
    assert.equal(fieldOf(reading({ staged: SERVED_STAGED }), none.local, GEN).value, SERVED_STAGED);
  });
}

for (const show of SHOWS) {
  test(`test_with_nothing_staged_or_held_the_view_value_is_the_${show}_the_reading_names`, () => {
    assert.equal(fieldOf(reading({ show }), {}, GEN).value, VALUE_OF[show]);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf: running is the named store, whatever the page holds.

for (const show of SHOWS) {
  test(`test_the_view_runs_at_the_${show}_the_reading_names_past_a_drag_and_a_staged_edit`, () => {
    const local = { drag: DRAG, staged: PAGE_STAGED };
    assert.equal(fieldOf(reading({ show, staged: SERVED_STAGED }), local, GEN).running, VALUE_OF[show]);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf: dirty means something is staged.

/** @type {{ name: string, served: unknown, local: LocalValues }[]} */
const STAGED_SOMEWHERE = [
  { name: "a_page_staged_value", served: null, local: { staged: PAGE_STAGED } },
  { name: "a_page_staged_zero", served: null, local: { staged: 0 } },
  { name: "a_served_staged_value", served: SERVED_STAGED, local: {} },
  { name: "a_served_staged_zero", served: 0, local: {} },
];

for (const row of STAGED_SOMEWHERE) {
  test(`test_${row.name}_makes_the_view_dirty`, () => {
    assert.equal(fieldOf(reading({ staged: row.served }), row.local, GEN).dirty, true);
  });
}

test("test_a_held_drag_with_nothing_staged_leaves_the_view_clean", () => {
  const staged = fieldOf(reading(), { drag: DRAG, staged: PAGE_STAGED }, GEN).dirty;
  const dragOnly = fieldOf(reading(), { drag: DRAG }, GEN).dirty;
  assert.deepEqual([staged, dragOnly], [true, false]);
});

// ---------------------------------------------------------------------------------------------------------------------
// fieldOf: divergence, restart mark, bounds and lane as served.

test("test_the_view_carries_the_readings_divergence", () => {
  const apart = fieldOf(reading({ diverges: true }), {}, GEN).diverges;
  const agreed = fieldOf(reading({ diverges: false }), {}, GEN).diverges;
  assert.deepEqual([apart, agreed], [true, false]);
});

test("test_the_view_carries_the_readings_restart_mark", () => {
  const restarts = fieldOf(reading({ restarts: true }), {}, GEN).restart;
  const live = fieldOf(reading({ restarts: false }), {}, GEN).restart;
  assert.deepEqual([restarts, live], [true, false]);
});

/** @type {{ name: string, bounds: Bounds }[]} */
const BOUNDS = [
  { name: "an_index_range", bounds: { min: 0, max: 63, step: 1 } },
  { name: "a_decibel_range", bounds: { min: -60, max: -20, step: 0.5 } },
];

for (const row of BOUNDS) {
  test(`test_the_view_carries_the_readings_bounds_for_${row.name}`, () => {
    assert.deepEqual(fieldOf(reading({ bounds: row.bounds }), {}, GEN).bounds, row.bounds);
  });
}

test("test_a_non_numeric_field_carries_null_bounds_into_the_view", () => {
  const numeric = fieldOf(reading(), {}, GEN).bounds;
  const nonNumeric = fieldOf(reading({ bounds: null }), {}, GEN).bounds;
  assert.deepEqual([numeric, nonNumeric], [reading().bounds, null]);
});

for (const lane of LANES) {
  test(`test_the_view_carries_the_readings_${lane}_lane`, () => {
    assert.equal(fieldOf(reading({ lane }), {}, GEN).lane, lane);
  });
}
