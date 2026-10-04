// Behavioral suite for mockup/scripts/model/snapshot.js: the decisions the Snapshot builder's rail and page make, each a
// value in and a value out. How many lines a rail page holds from the heights measured at each size, which page turns
// up after a save, which station folds are open and what each lists, which rail entries light with the edit, and each
// row's value, live value and whether the two differ.
//
// Record books, edits, engine states and measured heights are tables this file writes; no shipped data supplies an
// input or an expected value.
//
// Run: node --test tests/js/mockup/snapshot.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { NEW, keyOf } from "../../../../mockup/scripts/model/builders/builder.js";
import {
  isChain,
  valOf,
  railPer,
  revealPage,
  railFolds,
  litEntry,
  snapRow,
} from "../../../../mockup/scripts/model/builders/snapshot.js";

/** @typedef {import("../../../../mockup/scripts/model/builders/snapshot.js").Edit} Edit */
/** @typedef {import("../../../../mockup/scripts/model/builders/builder.js").Ref} Ref */

//: The stations a tree lists, in tree order.
const TREE = ["Den", "Loft", "Shed"];

/** A record book: Den holds six, Loft two, Shed none. */
const BOOK = {
  Den: { Alpha: {}, Bravo: {}, Charlie: {}, Delta: {}, Echo: {}, Foxtrot: {} },
  Loft: { Alpha: {}, Golf: {} },
  Shed: {},
};

/** @param {string} st @param {string} name @returns {Ref} */
const ref = (st, name) => ({ st, name });

// ── Lines per rail page ────────────────────────────────────────────────────

/**
 * A rail whose content grows by `line` per listed snapshot over a fixed `base`, inside `client`.
 *
 * @param {{ client: number, base: number, line: number }} rail
 * @param {number[]} [seen]  each size measured, in order
 */
const rail =
  ({ client, base, line }, seen = []) =>
  (/** @type {number} */ per) => {
    seen.push(per);
    return { client, scroll: base + per * line };
  };

/** @typedef {{ name: string, client: number, want: number }} PerRow */

/** @type {PerRow[]} */
const PER = [
  { name: "an_unmeasured_rail_holds_the_most_lines", client: 0, want: 40 },
  { name: "a_rail_taller_than_the_most_lines_holds_the_most", client: 2000, want: 40 },
  { name: "a_rail_exactly_twelve_lines_tall_holds_twelve", client: 340, want: 12 },
  { name: "a_rail_one_pixel_short_of_twelve_lines_holds_eleven", client: 339, want: 11 },
  { name: "a_rail_too_short_for_four_lines_still_holds_three", client: 150, want: 3 },
];

for (const row of PER) {
  test(`test_${row.name}`, () => {
    assert.equal(railPer(rail({ client: row.client, base: 100, line: 20 })), row.want);
  });
}

test("test_the_three_line_floor_is_never_measured", () => {
  /** @type {number[]} */
  const seen = [];
  railPer(rail({ client: 150, base: 100, line: 20 }, seen));
  assert.equal(seen.at(-1), 4);
});

test("test_measuring_stops_at_the_first_size_that_fits", () => {
  /** @type {number[]} */
  const seen = [];
  railPer(rail({ client: 900, base: 100, line: 20 }, seen));
  assert.deepEqual(seen, [40]);
});

// ── Page revealed after a save ─────────────────────────────────────────────

/** @typedef {{ name: string, cur: Ref, per: number, want: number | null }} RevealRow */

/** @type {RevealRow[]} */
const REVEAL = [
  { name: "a_snapshot_on_the_first_page_reveals_the_first", cur: ref("Den", "Charlie"), per: 4, want: 0 },
  { name: "a_snapshot_past_the_first_page_reveals_its_own", cur: ref("Den", "Foxtrot"), per: 4, want: 1 },
  { name: "the_first_snapshot_of_a_page_reveals_that_page", cur: ref("Den", "Echo"), per: 2, want: 2 },
  { name: "a_name_the_station_does_not_hold_reveals_nothing", cur: ref("Den", "Golf"), per: 4, want: null },
  { name: "the_new_entry_reveals_nothing", cur: ref("Den", NEW), per: 4, want: null },
];

for (const row of REVEAL) {
  test(`test_${row.name}`, () => {
    assert.equal(revealPage(BOOK, row.cur, row.per), row.want);
  });
}

// ── Station folds ──────────────────────────────────────────────────────────

/**
 * The folds for one rail state, every fact at its plain default unless the case says otherwise.
 *
 * @param {Partial<{ open: string | null, home: string, staged: string[], per: number, pages: Map<string, number>, first: boolean }>} over
 */
const folds = (over) =>
  railFolds({
    stations: TREE,
    book: BOOK,
    open: "Den",
    home: "Den",
    staged: [],
    per: 4,
    pages: new Map(),
    first: false,
    ...over,
  });

test("test_only_the_open_station_has_its_fold_open", () => {
  assert.deepEqual(
    folds({ open: "Loft" }).map((f) => f.open),
    [false, true, false],
  );
});

test("test_with_no_station_open_every_fold_is_shut", () => {
  assert.deepEqual(
    folds({ open: null }).map((f) => f.open),
    [false, false, false],
  );
});

test("test_a_shut_fold_lists_no_snapshots", () => {
  assert.deepEqual(folds({ open: "Den" })[1].items, []);
});

test("test_each_fold_counts_every_snapshot_its_station_holds", () => {
  assert.deepEqual(
    folds({}).map((f) => f.count),
    [6, 2, 0],
  );
});

test("test_the_open_fold_lists_the_page_asked_for", () => {
  assert.deepEqual(folds({ pages: new Map([["Den", 1]]) })[0].items, ["Echo", "Foxtrot"]);
});

test("test_a_page_past_the_last_lists_the_last", () => {
  assert.deepEqual(folds({ per: 2, pages: new Map([["Den", 7]]) })[0].items, ["Echo", "Foxtrot"]);
});

test("test_a_measuring_pass_lists_the_first_page_whatever_was_asked", () => {
  assert.deepEqual(folds({ first: true, pages: new Map([["Den", 1]]) })[0].items, [
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
  ]);
});

test("test_a_short_last_page_is_filled_to_a_full_page", () => {
  assert.equal(folds({ pages: new Map([["Den", 1]]) })[0].fill, 2);
});

test("test_a_full_first_page_takes_no_fill", () => {
  assert.equal(folds({})[0].fill, 0);
});

test("test_a_list_that_fits_one_page_takes_no_fill", () => {
  assert.equal(folds({ open: "Loft" })[1].fill, 0);
});

test("test_a_shut_fold_takes_no_fill", () => {
  assert.equal(folds({ open: "Loft", pages: new Map([["Den", 1]]) })[0].fill, 0);
});

test("test_only_the_home_station_reads_loaded", () => {
  assert.deepEqual(
    folds({ home: "Shed" }).map((f) => f.loaded),
    [false, false, true],
  );
});

test("test_a_station_holding_a_staged_edit_reads_dirty", () => {
  assert.deepEqual(
    folds({ staged: [keyOf(ref("Loft", "Golf"))] }).map((f) => f.dirty),
    [false, true, false],
  );
});

test("test_a_staged_new_snapshot_marks_no_station_dirty", () => {
  assert.deepEqual(
    folds({ staged: [keyOf(ref("Den", NEW))] }).map((f) => f.dirty),
    [false, false, false],
  );
});

// ── Lit rail entries ───────────────────────────────────────────────────────

/**
 * An edit of `name` ticked for `stations`, holding nothing.
 *
 * @param {string} name
 * @param {string[]} stations
 * @returns {Edit}
 */
const edit = (name, stations) => ({ name, stations, inc: new Set(), vals: { mode: "pcm", pcm: {}, sdm: {} } });

/** @typedef {{ name: string, entry: Ref, cur: Ref, e: Edit, want: boolean }} LitRow */

/** @type {LitRow[]} */
const LIT = [
  {
    name: "the_snapshot_edited_is_lit",
    entry: ref("Den", "Alpha"),
    cur: ref("Den", "Alpha"),
    e: edit("Alpha", ["Den"]),
    want: true,
  },
  {
    name: "the_same_name_in_another_ticked_station_is_lit",
    entry: ref("Loft", "Alpha"),
    cur: ref("Den", "Alpha"),
    e: edit("Alpha", ["Den", "Loft"]),
    want: true,
  },
  {
    name: "the_same_name_in_an_unticked_station_is_dark",
    entry: ref("Loft", "Alpha"),
    cur: ref("Den", "Alpha"),
    e: edit("Alpha", ["Den"]),
    want: false,
  },
  {
    name: "a_rename_lights_the_typed_name_in_ticked_stations",
    entry: ref("Loft", "Golf"),
    cur: ref("Den", "Alpha"),
    e: edit("Golf", ["Den", "Loft"]),
    want: true,
  },
  {
    name: "an_unnamed_edit_lights_its_saved_name",
    entry: ref("Loft", "Alpha"),
    cur: ref("Den", "Alpha"),
    e: edit("", ["Den", "Loft"]),
    want: true,
  },
  {
    name: "another_snapshot_of_the_same_station_is_dark",
    entry: ref("Den", "Bravo"),
    cur: ref("Den", "Alpha"),
    e: edit("Alpha", ["Den"]),
    want: false,
  },
  {
    name: "a_new_snapshot_never_lights_a_saved_one_of_its_name",
    entry: ref("Den", "Alpha"),
    cur: ref("Den", NEW),
    e: edit("Alpha", ["Den"]),
    want: false,
  },
  {
    name: "the_new_entry_is_lit_while_new_is_edited",
    entry: ref("Shed", NEW),
    cur: ref("Den", NEW),
    e: edit("", ["Den"]),
    want: true,
  },
  {
    name: "the_new_entry_is_dark_while_a_saved_one_is_edited",
    entry: ref("Den", NEW),
    cur: ref("Den", "Alpha"),
    e: edit("Alpha", ["Den"]),
    want: false,
  },
];

for (const row of LIT) {
  test(`test_${row.name}`, () => {
    assert.equal(litEntry(row.entry, row.cur, row.e), row.want);
  });
}

// ── Rows ───────────────────────────────────────────────────────────────────

/**
 * An edit in `mode`, holding the ids in `inc`, its PCM and SDM chains set apart.
 *
 * @param {string[]} inc
 * @param {string} [mode]
 * @returns {Edit}
 */
const held = (inc, mode = "pcm") => ({
  name: "Alpha",
  stations: ["Den"],
  inc: new Set(inc),
  vals: { autopilot: "1", mode, pcm: { nx: "kept-pcm" }, sdm: { nx: "kept-sdm" } },
});

/** The engine: running PCM, every value its own. */
const ENGINE = { autopilot: "0", mode: "pcm", run: "pcm", pcm: { nx: "live-pcm" }, sdm: { nx: "live-sdm" } };

test("test_nx_is_a_chain_row", () => {
  assert.equal(isChain("nx"), true);
});

test("test_mode_is_not_a_chain_row", () => {
  assert.equal(isChain("mode"), false);
});

test("test_a_chain_value_comes_from_the_edits_mode", () => {
  assert.equal(valOf(held([], "sdm"), "nx"), "kept-sdm");
});

test("test_a_plain_row_shows_the_edits_value", () => {
  assert.equal(snapRow({ id: "autopilot" }, held(["autopilot"]), ENGINE).value, "1");
});

test("test_a_chain_row_shows_its_value_in_the_edits_chain", () => {
  assert.equal(snapRow({ id: "nx" }, held(["mode", "nx"], "sdm"), ENGINE).value, "kept-sdm");
});

test("test_a_held_plain_row_is_on", () => {
  assert.equal(snapRow({ id: "autopilot" }, held(["autopilot"]), ENGINE).on, true);
});

test("test_an_excluded_row_is_off", () => {
  assert.equal(snapRow({ id: "autopilot" }, held([]), ENGINE).on, false);
});

test("test_a_chain_row_without_mode_is_gated", () => {
  assert.equal(snapRow({ id: "nx" }, held(["nx"]), ENGINE).gated, true);
});

test("test_a_gated_chain_row_is_off_though_held", () => {
  assert.equal(snapRow({ id: "nx" }, held(["nx"]), ENGINE).on, false);
});

test("test_a_chain_row_with_mode_is_not_gated", () => {
  assert.equal(snapRow({ id: "nx" }, held(["mode", "nx"]), ENGINE).gated, false);
});

test("test_a_chain_rows_live_value_is_the_engines_in_the_edits_chain", () => {
  assert.equal(snapRow({ id: "nx" }, held(["mode", "nx"], "sdm"), ENGINE).live, "live-sdm");
});

test("test_a_chain_row_off_the_running_chain_reads_idle", () => {
  assert.equal(snapRow({ id: "nx" }, held(["mode", "nx"], "sdm"), ENGINE).idle, true);
});

test("test_a_chain_row_on_the_running_chain_is_not_idle", () => {
  assert.equal(snapRow({ id: "nx" }, held(["mode", "nx"]), ENGINE).idle, false);
});

test("test_the_mode_rows_live_value_is_the_engines_mode_not_its_run", () => {
  assert.equal(snapRow({ id: "mode" }, held(["mode"]), { ...ENGINE, mode: "auto" }).live, "auto");
});

test("test_a_row_unlike_the_engine_differs", () => {
  assert.equal(snapRow({ id: "autopilot" }, held(["autopilot"]), ENGINE).differs, true);
});

test("test_a_row_like_the_engine_does_not_differ", () => {
  assert.equal(snapRow({ id: "autopilot" }, held(["autopilot"]), { ...ENGINE, autopilot: "1" }).differs, false);
});

test("test_a_number_and_its_string_do_not_differ", () => {
  assert.equal(snapRow({ id: "autopilot" }, held(["autopilot"]), { ...ENGINE, autopilot: 1 }).differs, false);
});

test("test_mode_against_an_engine_on_auto_does_not_differ", () => {
  assert.equal(snapRow({ id: "mode" }, held(["mode"], "sdm"), { ...ENGINE, mode: "auto" }).differs, false);
});

test("test_a_held_row_that_differs_can_take_the_live_value", () => {
  assert.equal(snapRow({ id: "autopilot" }, held(["autopilot"]), ENGINE).take, true);
});

test("test_an_excluded_row_that_differs_cannot_take_the_live_value", () => {
  assert.equal(snapRow({ id: "autopilot" }, held([]), ENGINE).take, false);
});

test("test_a_row_like_the_engine_cannot_take_the_live_value", () => {
  assert.equal(snapRow({ id: "autopilot" }, held(["autopilot"]), { ...ENGINE, autopilot: "1" }).take, false);
});

test("test_mode_cannot_take_an_engine_on_auto", () => {
  assert.equal(snapRow({ id: "mode" }, held(["mode"], "sdm"), { ...ENGINE, mode: "auto" }).take, false);
});
