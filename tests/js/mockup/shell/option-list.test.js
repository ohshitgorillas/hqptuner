// Behavioral suite for mockup/scripts/model/option-list.js: what an option list decides, free of the DOM. Which rows and
// chips a hover tip carries and where it lands beside its row, where a panel parks at its picker, how the narrowed list
// groups into families and variants, which placement columns survive narrowing, and how the Standard style fills its
// columns in engine order.
//
// The plate, the facet labels, the options, the placement table and the engine order are all ones this file writes.
//
// Run: node --test tests/js/mockup/option-list.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  tipRows,
  tipChips,
  tipContent,
  tipAt,
  parkAt,
  groupTree,
  columns,
  flatColumns,
} from "../../../../mockup/scripts/model/shell/option-list.js";

/** @typedef {import("../../../../mockup/scripts/model/shell/option-list.js").Opt} Opt */
/** @typedef {import("../../../../mockup/scripts/model/shell/option-list.js").Facets} Facets */
/** @typedef {import("../../../../mockup/scripts/model/shell/option-list.js").Column} Column */
/** @typedef {import("../../../../mockup/scripts/model/shell/option-list.js").Placement} Placement */

const PLATE = { w: 1000, h: 800 };

//: Facet labels by facet key, the table every tip row below reads.
const LABELS = {
  genre: { g1: "G-one", g2: "G-two" },
  focus: { f1: "F-one" },
  phase: { p1: "P-one" },
  length: { l1: "L-one", adaptive: "L-adapt" },
};

/**
 * An option's facets: every facet empty, then `over`.
 *
 * @param {Partial<Facets>} [over]
 * @returns {Facets}
 */
const facets = (over = {}) => ({
  genre: [],
  focus: [],
  phase: "",
  len: "",
  adaptive: false,
  apod: "",
  up: false,
  ...over,
});

/**
 * An option named `v` in family `fam`, then `over`.
 *
 * @param {string} v
 * @param {Partial<Opt>} [over]
 * @returns {Opt}
 */
const opt = (v, over = {}) => ({ v, fam: "A", var: null, leaf: v, d: `d-${v}`, ...over });

// ── tipRows ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One option and the number of tip rows it owes.
 *
 * @typedef {object} CountRow
 * @property {string} name
 * @property {Opt} o
 * @property {number} want
 */

/** @type {CountRow[]} */
const ROW_COUNTS = [
  { name: "an_option_without_facets_or_generation_has_no_rows", o: opt("x"), want: 0 },
  { name: "an_option_without_facets_has_its_generation_row", o: opt("x", { gen: 2 }), want: 1 },
  { name: "a_generation_past_the_ordinals_has_no_row", o: opt("x", { gen: 9 }), want: 0 },
  { name: "empty_facets_have_no_rows", o: opt("x", { f: facets() }), want: 0 },
  { name: "a_quality_makes_one_row", o: opt("x", { f: facets({ q: 3 }) }), want: 1 },
  { name: "a_null_quality_makes_no_row", o: opt("x", { f: facets({ q: null }) }), want: 0 },
  { name: "facets_ignore_the_generation", o: opt("x", { gen: 2, f: facets() }), want: 0 },
  {
    name: "every_facet_makes_one_row_each",
    o: opt("x", { f: facets({ q: 3, genre: ["g1"], focus: ["f1"], phase: "p1", len: "l1", ratio: "integer" }) }),
    want: 6,
  },
  { name: "an_adaptive_length_alone_makes_a_row", o: opt("x", { f: facets({ adaptive: true }) }), want: 1 },
  { name: "split_ratios_make_one_row", o: opt("x", { f: facets({ ratioPcm: "integer", ratioSdm: "any" }) }), want: 1 },
];

for (const row of ROW_COUNTS) {
  test(`test_${row.name}`, () => {
    assert.equal(tipRows(row.o, LABELS).length, row.want);
  });
}

/**
 * One option holding a single facet, and text its one row's value owes: the whole value in ROW_VALUES, a part of it in
 * ROW_PARTS.
 *
 * @typedef {object} ValueRow
 * @property {string} name
 * @property {Facets} f
 * @property {string} text
 */

/**
 * The value of an option's first tip row.
 *
 * @param {Facets} f
 */
const firstValue = (f) => tipRows(opt("x", { f }), LABELS)[0][1];

/** @type {ValueRow[]} */
const ROW_VALUES = [
  { name: "a_phase_reads_its_facet_label", f: facets({ phase: "p1" }), text: "P-one" },
  { name: "an_unlabeled_phase_reads_its_raw_key", f: facets({ phase: "raw" }), text: "raw" },
  { name: "a_length_reads_its_facet_label", f: facets({ len: "l1" }), text: "L-one" },
  { name: "an_adaptive_length_alone_reads_the_adaptive_label", f: facets({ adaptive: true }), text: "L-adapt" },
  { name: "an_unknown_ratio_reads_its_raw_key", f: facets({ ratio: "odd" }), text: "odd" },
];

for (const row of ROW_VALUES) {
  test(`test_${row.name}`, () => {
    assert.equal(firstValue(row.f), row.text);
  });
}

/** @type {ValueRow[]} */
const ROW_PARTS = [
  { name: "a_genre_list_names_its_last_genre", f: facets({ genre: ["g1", "g2"] }), text: "G-two" },
  { name: "an_unlabeled_genre_reads_its_raw_key", f: facets({ genre: ["raw"] }), text: "raw" },
  { name: "a_focus_list_names_its_focus", f: facets({ focus: ["f1"] }), text: "F-one" },
  { name: "an_adaptive_length_names_its_length", f: facets({ len: "l1", adaptive: true }), text: "L-one" },
  { name: "split_ratios_name_the_pcm_ratio", f: facets({ ratioPcm: "pcm-odd", ratioSdm: "sdm-odd" }), text: "pcm-odd" },
  { name: "split_ratios_name_the_sdm_ratio", f: facets({ ratioPcm: "pcm-odd", ratioSdm: "sdm-odd" }), text: "sdm-odd" },
  { name: "a_lone_sdm_ratio_names_it", f: facets({ ratioSdm: "sdm-odd" }), text: "sdm-odd" },
];

for (const row of ROW_PARTS) {
  test(`test_${row.name}`, () => {
    assert.equal(firstValue(row.f).includes(row.text), true);
  });
}

// ── tipChips ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** @type {CountRow[]} */
const CHIP_COUNTS = [
  { name: "an_option_without_facets_has_no_chips", o: opt("x"), want: 0 },
  { name: "plain_facets_have_no_chips", o: opt("x", { f: facets() }), want: 0 },
  { name: "full_apodizing_makes_a_chip", o: opt("x", { f: facets({ apod: "full" }) }), want: 1 },
  { name: "half_apodizing_makes_a_chip", o: opt("x", { f: facets({ apod: "half" }) }), want: 1 },
  { name: "upsample_only_makes_a_chip", o: opt("x", { f: facets({ up: true }) }), want: 1 },
  {
    name: "apodizing_and_upsample_only_make_two_chips",
    o: opt("x", { f: facets({ apod: "full", up: true }) }),
    want: 2,
  },
];

for (const row of CHIP_COUNTS) {
  test(`test_${row.name}`, () => {
    assert.equal(tipChips(row.o).length, row.want);
  });
}

// ── tipContent ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One option, the option style, and the field of the tip it owes.
 *
 * @typedef {object} ContentRow
 * @property {string} name
 * @property {Opt} o
 * @property {boolean} std
 * @property {'name' | 'text'} field
 * @property {string | null} want
 */

/** @type {ContentRow[]} */
const CONTENT = [
  { name: "simplified_names_the_engine_value", o: opt("eng"), std: false, field: "name", want: "eng" },
  { name: "standard_names_nothing", o: opt("eng"), std: true, field: "name", want: null },
  {
    name: "simplified_text_is_the_simplified_prose",
    o: opt("x", { d: "d-s", d2: "d-std" }),
    std: false,
    field: "text",
    want: "d-s",
  },
  {
    name: "standard_text_is_the_standard_prose",
    o: opt("x", { d: "d-s", d2: "d-std" }),
    std: true,
    field: "text",
    want: "d-std",
  },
  {
    name: "standard_text_without_standard_prose_is_the_simplified_prose",
    o: opt("x", { d: "d-s" }),
    std: true,
    field: "text",
    want: "d-s",
  },
];

for (const row of CONTENT) {
  test(`test_${row.name}`, () => {
    assert.equal(tipContent(row.o, row.std, LABELS)[row.field], row.want);
  });
}

test("test_tip_content_carries_the_option_chips", () => {
  assert.equal(tipContent(opt("x", { f: facets({ apod: "half", up: true }) }), false, LABELS).chips.length, 2);
});

test("test_tip_content_carries_the_option_rows", () => {
  assert.equal(tipContent(opt("x", { f: facets({ q: 2, phase: "p1" }) }), false, LABELS).rows.length, 2);
});

// ── tipAt ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A hovered row's column and top, the tip's size, and the coordinate the tip owes.
 *
 * @typedef {object} TipRow
 * @property {string} name
 * @property {{x: number, w: number}} col
 * @property {number} rowY
 * @property {{w: number, h: number}} tip
 * @property {'left' | 'top'} at
 * @property {number} want
 */

/** @type {TipRow[]} */
const TIPS = [
  {
    name: "a_tip_with_room_sits_right_of_its_column",
    col: { x: 100, w: 200 },
    rowY: 200,
    tip: { w: 300, h: 100 },
    at: "left",
    want: 310,
  },
  {
    name: "a_tip_that_just_meets_the_right_margin_stays_right",
    col: { x: 478, w: 200 },
    rowY: 200,
    tip: { w: 300, h: 100 },
    at: "left",
    want: 688,
  },
  {
    name: "a_tip_without_room_right_sits_left_of_its_column",
    col: { x: 600, w: 200 },
    rowY: 200,
    tip: { w: 300, h: 100 },
    at: "left",
    want: 290,
  },
  {
    name: "a_tip_left_of_the_left_margin_comes_back_inside",
    col: { x: 200, w: 700 },
    rowY: 200,
    tip: { w: 300, h: 100 },
    at: "left",
    want: 12,
  },
  {
    name: "a_tip_left_edge_is_rounded",
    col: { x: 100.4, w: 200 },
    rowY: 200,
    tip: { w: 300, h: 100 },
    at: "left",
    want: 310,
  },
  {
    name: "a_tip_top_sits_just_above_its_row",
    col: { x: 100, w: 200 },
    rowY: 200,
    tip: { w: 300, h: 100 },
    at: "top",
    want: 196,
  },
  {
    name: "a_tip_past_the_foot_comes_back_inside",
    col: { x: 100, w: 200 },
    rowY: 780,
    tip: { w: 300, h: 100 },
    at: "top",
    want: 688,
  },
  {
    name: "a_tip_above_the_top_margin_comes_back_inside",
    col: { x: 100, w: 200 },
    rowY: 10,
    tip: { w: 300, h: 100 },
    at: "top",
    want: 12,
  },
  { name: "a_tip_top_is_rounded", col: { x: 100, w: 200 }, rowY: 200.7, tip: { w: 300, h: 100 }, at: "top", want: 197 },
];

for (const row of TIPS) {
  test(`test_${row.name}`, () => {
    assert.equal(tipAt({ col: row.col, rowY: row.rowY, tip: row.tip, plate: PLATE })[row.at], row.want);
  });
}

// ── parkAt ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A panel's size, its picker on the plate (or none), and the coordinate the panel owes.
 *
 * @typedef {object} ParkRow
 * @property {string} name
 * @property {{w: number, h: number}} panel
 * @property {{x: number, y: number, h: number} | null} trigger
 * @property {'left' | 'top'} at
 * @property {number} want
 */

/** @type {ParkRow[]} */
const PARKS = [
  { name: "a_panel_without_a_picker_centers_across", panel: { w: 400, h: 200 }, trigger: null, at: "left", want: 300 },
  { name: "a_panel_without_a_picker_centers_down", panel: { w: 400, h: 200 }, trigger: null, at: "top", want: 300 },
  {
    name: "a_panel_shares_its_picker_left_edge",
    panel: { w: 400, h: 200 },
    trigger: { x: 100, y: 100, h: 30 },
    at: "left",
    want: 100,
  },
  {
    name: "a_panel_past_the_right_margin_comes_back_inside",
    panel: { w: 400, h: 200 },
    trigger: { x: 900, y: 100, h: 30 },
    at: "left",
    want: 588,
  },
  {
    name: "a_panel_left_of_the_left_margin_comes_back_inside",
    panel: { w: 400, h: 200 },
    trigger: { x: 2, y: 100, h: 30 },
    at: "left",
    want: 12,
  },
  {
    name: "a_panel_with_room_drops_under_its_picker",
    panel: { w: 400, h: 200 },
    trigger: { x: 100, y: 100, h: 30 },
    at: "top",
    want: 136,
  },
  {
    name: "a_panel_that_just_meets_the_foot_stays_below",
    panel: { w: 400, h: 200 },
    trigger: { x: 100, y: 552, h: 30 },
    at: "top",
    want: 588,
  },
  {
    name: "a_panel_without_room_below_opens_above_its_picker",
    panel: { w: 400, h: 200 },
    trigger: { x: 100, y: 650, h: 30 },
    at: "top",
    want: 444,
  },
  {
    name: "a_panel_with_room_neither_way_sits_on_the_foot",
    panel: { w: 400, h: 700 },
    trigger: { x: 100, y: 300, h: 30 },
    at: "top",
    want: 88,
  },
  {
    name: "a_panel_taller_than_the_plate_keeps_the_top_margin",
    panel: { w: 400, h: 790 },
    trigger: null,
    at: "top",
    want: 12,
  },
  { name: "a_centered_panel_left_edge_is_rounded", panel: { w: 401, h: 200 }, trigger: null, at: "left", want: 300 },
];

for (const row of PARKS) {
  test(`test_${row.name}`, () => {
    assert.equal(parkAt({ panel: row.panel, trigger: row.trigger, plate: PLATE })[row.at], row.want);
  });
}

// ── groupTree ───────────────────────────────────────────────────────────────────────────────────────────────────────

//: A narrowed list in overlay order: family B first, family A's variants out of name order, one bare family.
/** @type {Opt[]} */
const TREE_OPTS = [
  opt("b1", { fam: "B", var: "w" }),
  opt("a1", { fam: "A", var: "y" }),
  opt("a2", { fam: "A", var: "x" }),
  opt("a3", { fam: "A", var: "y" }),
  opt("c1", { fam: "C", var: null }),
];

test("test_families_keep_their_first_appearance_order", () => {
  assert.deepEqual([...groupTree(TREE_OPTS).keys()], ["B", "A", "C"]);
});

test("test_variants_keep_their_first_appearance_order", () => {
  assert.deepEqual([...(groupTree(TREE_OPTS).get("A")?.keys() ?? [])], ["y", "x"]);
});

test("test_a_variant_keeps_its_options_in_list_order", () => {
  assert.deepEqual(
    groupTree(TREE_OPTS)
      .get("A")
      ?.get("y")
      ?.map((o) => o.v),
    ["a1", "a3"],
  );
});

test("test_an_option_without_a_variant_groups_under_the_empty_key", () => {
  assert.deepEqual([...(groupTree(TREE_OPTS).get("C")?.keys() ?? [])], [""]);
});

test("test_an_empty_list_has_no_families", () => {
  assert.equal(groupTree([]).size, 0);
});

// ── columns ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Families by their variant names, as groupTree hands them over.
 *
 * @param {Record<string, string[]>} spec
 * @returns {Map<string, Map<string, Opt[]>>}
 */
const famsOf = (spec) =>
  new Map(
    Object.entries(spec).map(([f, vs]) => [
      f,
      new Map(vs.map((v) => [v, [opt(`${f}-${v}`, { fam: f, var: v || null })]])),
    ]),
  );

/** @type {Placement[]} */
const SPLIT = [{ fams: ["S"], split: [["v2", "v1", "gone"], ["v3"]] }];
/** @type {Placement[]} */
const STACKS = [
  { fams: ["A", "Gone"], then: { title: "T", fams: ["B"] } },
  { title: "Other", fams: ["C"] },
];

/**
 * One placement table and family set, and what the columns owe.
 *
 * @typedef {object} ColRow
 * @property {string} name
 * @property {Placement[]} place
 * @property {Record<string, string[]>} fams
 * @property {(cols: Column[]) => unknown} pick
 * @property {unknown} want
 */

/** @type {ColRow[]} */
const COLS = [
  {
    name: "every_column_with_a_family_present_stays",
    place: STACKS,
    fams: { A: [""], B: [""], C: [""] },
    pick: (c) => c.length,
    want: 2,
  },
  { name: "a_column_with_no_family_present_drops", place: STACKS, fams: { A: [""] }, pick: (c) => c.length, want: 1 },
  {
    name: "a_column_with_only_its_then_block_present_stays",
    place: STACKS,
    fams: { B: [""] },
    pick: (c) => c.length,
    want: 1,
  },
  {
    name: "a_family_the_list_lacks_drops_from_its_column",
    place: STACKS,
    fams: { A: [""] },
    pick: (c) => c[0].kind === "stack" && c[0].fams,
    want: ["A"],
  },
  {
    name: "a_then_block_lists_its_present_families",
    place: STACKS,
    fams: { A: [""], B: [""] },
    pick: (c) => c[0].kind === "stack" && c[0].then?.fams,
    want: ["B"],
  },
  {
    name: "a_then_block_keeps_its_title",
    place: STACKS,
    fams: { B: [""] },
    pick: (c) => c[0].kind === "stack" && c[0].then?.title,
    want: "T",
  },
  {
    name: "a_then_block_with_no_family_present_is_none",
    place: STACKS,
    fams: { A: [""] },
    pick: (c) => c[0].kind === "stack" && c[0].then,
    want: null,
  },
  {
    name: "a_titled_column_keeps_its_title",
    place: STACKS,
    fams: { C: [""] },
    pick: (c) => c[0].kind === "stack" && c[0].title,
    want: "Other",
  },
  {
    name: "an_untitled_column_has_no_title",
    place: STACKS,
    fams: { A: [""] },
    pick: (c) => c[0].kind === "stack" && c[0].title,
    want: undefined,
  },
  {
    name: "a_split_column_is_a_split",
    place: SPLIT,
    fams: { S: ["v1", "v2", "v3"] },
    pick: (c) => c[0].kind,
    want: "split",
  },
  {
    name: "a_split_column_names_its_family",
    place: SPLIT,
    fams: { S: ["v1", "v2", "v3"] },
    pick: (c) => c[0].kind === "split" && c[0].fam,
    want: "S",
  },
  {
    name: "a_split_keeps_the_given_variant_order_and_drops_absent_ones",
    place: SPLIT,
    fams: { S: ["v1", "v2", "v3"] },
    pick: (c) => c[0].kind === "split" && c[0].halves,
    want: [["v2", "v1"], ["v3"]],
  },
  {
    name: "a_split_with_both_halves_present_is_a_band",
    place: SPLIT,
    fams: { S: ["v1", "v3"] },
    pick: (c) => c[0].kind === "split" && c[0].band,
    want: true,
  },
  {
    name: "a_split_with_one_half_empty_is_not_a_band",
    place: SPLIT,
    fams: { S: ["v1", "v2"] },
    pick: (c) => c[0].kind === "split" && c[0].band,
    want: false,
  },
  { name: "a_split_whose_family_is_absent_drops", place: SPLIT, fams: { A: [""] }, pick: (c) => c.length, want: 0 },
];

for (const row of COLS) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(row.pick(columns(row.place, famsOf(row.fams))), row.want);
  });
}

// ── flatColumns ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ORDER = ["a", "b", "c", "d", "e", "f", "g"];

/**
 * A narrowed list, the full list's length and the column count, and what the columns owe.
 *
 * @typedef {object} FlatRow
 * @property {string} name
 * @property {string[]} vs
 * @property {number} total
 * @property {number} cols
 * @property {(cols: Opt[][]) => unknown} pick
 * @property {unknown} want
 */

/** @type {FlatRow[]} */
const FLATS = [
  {
    name: "the_full_list_fills_its_columns_evenly_from_the_first",
    vs: ORDER,
    total: 7,
    cols: 3,
    pick: (c) => c.map((col) => col.length),
    want: [3, 3, 1],
  },
  {
    name: "a_narrowed_list_reflows_into_fewer_columns",
    vs: ["a", "c", "e", "g"],
    total: 7,
    cols: 3,
    pick: (c) => c.map((col) => col.length),
    want: [3, 1],
  },
  {
    name: "rows_run_in_engine_order",
    vs: ["c", "a", "b"],
    total: 7,
    cols: 1,
    pick: (c) => c[0].map((o) => o.v),
    want: ["a", "b", "c"],
  },
  {
    name: "a_value_the_engine_order_lacks_runs_last",
    vs: ["zz", "b", "a"],
    total: 7,
    cols: 1,
    pick: (c) => c[0].map((o) => o.v),
    want: ["a", "b", "zz"],
  },
  { name: "an_empty_list_has_no_columns", vs: [], total: 7, cols: 3, pick: (c) => c.length, want: 0 },
];

for (const row of FLATS) {
  test(`test_${row.name}`, () => {
    const got = flatColumns(
      row.vs.map((v) => opt(v)),
      { total: row.total, cols: row.cols, order: ORDER },
    );
    assert.deepEqual(row.pick(got), row.want);
  });
}

test("test_flat_columns_leave_the_narrowed_list_in_its_order", () => {
  const vs = [opt("c"), opt("a")];
  flatColumns(vs, { total: 7, cols: 1, order: ORDER });
  assert.deepEqual(
    vs.map((o) => o.v),
    ["c", "a"],
  );
});
