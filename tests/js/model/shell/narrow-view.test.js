// Behavioral suite: what the facet bar reads off the narrowing state, free of the DOM (which facets show at a stage,
// which chips read picked, which chips are dead, whether a set of facets is narrowing, the state keys a set of facets
// owns, and each facet's state summary as data).

import test from "node:test";
import assert from "node:assert/strict";

import {
  chipPressed,
  deadChip,
  facetShown,
  narrowing,
  stateKeys,
  summary,
} from "../../../../hqptuner/static/model/shell/narrow-view.js";

// ── Facet tables ──────────────────────────────────────────────────────────

const APOD = {
  kind: "seg",
  apod: true,
  rows: [
    {
      key: "apod1x",
      stage: "1x",
      options: [
        { v: "all", label: "a0" },
        { v: "only", label: "a1" },
        { v: "half", label: "a2" },
      ],
    },
    {
      key: "apodNx",
      stage: "nx",
      options: [
        { v: "all", label: "b0" },
        { v: "only", label: "b1" },
        { v: "half", label: "b2" },
      ],
    },
  ],
};
const LEVEL = {
  kind: "seg",
  rows: [
    {
      key: "level",
      options: [
        { v: 0, label: "l0" },
        { v: 3, label: "l3" },
        { v: 5, label: "l5" },
      ],
    },
  ],
};
const TWO_ROWS = {
  kind: "seg",
  rows: [
    {
      key: "r1",
      options: [
        { v: "x", label: "x0" },
        { v: "y", label: "y1" },
      ],
    },
    {
      key: "r2",
      options: [
        { v: "p", label: "p0" },
        { v: "q", label: "q1" },
      ],
    },
  ],
};
const SOURCES = {
  kind: "seg",
  rows: [
    {
      key: "lossy",
      stage: "1x",
      options: [
        { v: "both", label: "s0" },
        { v: "lossy", label: "s1" },
      ],
    },
  ],
};
const MIXED = {
  kind: "chips",
  key: "mix",
  combine: true,
  options: [
    { v: "m1", label: "M one" },
    { v: "m2", label: "M two" },
    { v: "m3", label: "M three" },
  ],
};
const PLAIN = {
  kind: "chips",
  key: "plain",
  options: [
    { v: "p1", label: "P one" },
    { v: "p2", label: "P two" },
  ],
};
const SWITCH = { kind: "toggle", key: "sw" };
const BOXES = {
  kind: "checks",
  items: [
    { key: "c1", tag: "C one" },
    { key: "c2", tag: "C two" },
    { key: "c3", tag: "C three" },
  ],
};

// ── summary: apodizing ───────────────────────────────────────────────────

test("test_summary_flags_the_full_mark_when_the_stage_row_reads_only", () => {
  assert.deepEqual(summary(APOD, { apod1x: "only", apodNx: "all" }, "1x"), { apod: "only" });
});

test("test_summary_flags_the_half_mark_when_the_stage_row_reads_half", () => {
  assert.deepEqual(summary(APOD, { apod1x: "all", apodNx: "half" }, "nx"), { apod: "half" });
});

test("test_summary_reads_the_nx_row_at_the_nx_stage", () => {
  assert.equal(summary(APOD, { apod1x: "only", apodNx: "all" }, "nx"), null);
});

test("test_summary_is_null_for_apodizing_left_at_all", () => {
  assert.equal(summary(APOD, { apod1x: "all", apodNx: "all" }, "1x"), null);
});

// ── summary: segments ────────────────────────────────────────────────────

test("test_summary_is_null_for_a_segment_at_its_first_option", () => {
  assert.equal(summary(LEVEL, { level: 0 }, "1x"), null);
});

test("test_summary_matches_a_segment_value_on_its_string_form", () => {
  assert.equal(summary(LEVEL, { level: "0" }, "1x"), null);
});

test("test_summary_lists_the_label_of_a_moved_segment", () => {
  assert.deepEqual(summary(LEVEL, { level: "3" }, "1x"), { labels: ["l3"] });
});

test("test_summary_lists_only_the_moved_rows_of_a_segment", () => {
  assert.deepEqual(summary(TWO_ROWS, { r1: "x", r2: "q" }, "1x"), { labels: ["q1"] });
});

test("test_summary_lists_every_moved_row_in_row_order", () => {
  assert.deepEqual(summary(TWO_ROWS, { r1: "y", r2: "q" }, "1x"), { labels: ["y1", "q1"] });
});

// ── summary: chips ───────────────────────────────────────────────────────

test("test_summary_is_null_for_chips_with_no_pick", () => {
  assert.equal(summary(MIXED, { mix: [], mixMode: "and" }, "1x"), null);
});

test("test_summary_lists_the_label_of_a_single_chip_pick", () => {
  assert.deepEqual(summary(MIXED, { mix: ["m2"], mixMode: "and" }, "1x"), { labels: ["M two"] });
});

test("test_summary_counts_several_picks_with_the_facet_combine_mode", () => {
  assert.deepEqual(summary(MIXED, { mix: ["m1", "m3"], mixMode: "and" }, "1x"), { picks: 2, mode: "and" });
});

test("test_summary_counts_several_picks_of_a_facet_without_a_mode_as_a_union", () => {
  assert.deepEqual(summary(PLAIN, { plain: ["p1", "p2"], plainMode: "and" }, "1x"), { picks: 2, mode: "or" });
});

// ── summary: toggle and checks ───────────────────────────────────────────

test("test_summary_flags_a_toggle_that_is_on", () => {
  assert.deepEqual(summary(SWITCH, { sw: true }, "1x"), { on: true });
});

test("test_summary_is_null_for_a_toggle_that_is_off", () => {
  assert.equal(summary(SWITCH, { sw: false }, "1x"), null);
});

test("test_summary_is_null_for_checks_with_none_ticked", () => {
  assert.equal(summary(BOXES, { c1: false, c2: false, c3: false }, "1x"), null);
});

test("test_summary_lists_the_tag_of_a_single_ticked_check", () => {
  assert.deepEqual(summary(BOXES, { c1: false, c2: true, c3: false }, "1x"), { labels: ["C two"] });
});

test("test_summary_counts_several_ticked_checks_as_rules", () => {
  assert.deepEqual(summary(BOXES, { c1: true, c2: false, c3: true }, "1x"), { rules: 2 });
});

test("test_summary_is_null_for_an_unknown_facet_kind", () => {
  assert.equal(summary({ kind: "other", key: "o" }, { o: true }, "1x"), null);
});

// ── facetShown ───────────────────────────────────────────────────────────

test("test_facet_shown_hides_the_sources_facet_at_the_nx_stage", () => {
  assert.equal(facetShown(SOURCES, "nx"), false);
});

test("test_facet_shown_shows_the_sources_facet_at_the_1x_stage", () => {
  assert.equal(facetShown(SOURCES, "1x"), true);
});

test("test_facet_shown_shows_any_other_segment_at_the_nx_stage", () => {
  assert.equal(facetShown(LEVEL, "nx"), true);
});

test("test_facet_shown_shows_chips_at_the_nx_stage", () => {
  assert.equal(facetShown(MIXED, "nx"), true);
});

// ── chipPressed ──────────────────────────────────────────────────────────

test("test_chip_pressed_reads_a_boolean_state_as_is", () => {
  assert.equal(chipPressed({ sw: true }, "sw", "on"), true);
});

test("test_chip_pressed_is_true_for_a_value_in_the_pick_list", () => {
  assert.equal(chipPressed({ mix: ["m1", "m2"] }, "mix", "m2"), true);
});

test("test_chip_pressed_is_false_for_a_value_outside_the_pick_list", () => {
  assert.equal(chipPressed({ mix: ["m1"] }, "mix", "m3"), false);
});

// ── deadChip ─────────────────────────────────────────────────────────────

test("test_dead_chip_is_true_for_an_unpicked_chip_counting_zero", () => {
  assert.equal(deadChip(false, "0"), true);
});

test("test_dead_chip_is_true_for_an_unpicked_chip_emptying_both_lists", () => {
  assert.equal(deadChip(false, "0·0"), true);
});

test("test_dead_chip_is_false_for_a_picked_chip_counting_zero", () => {
  assert.equal(deadChip(true, "0"), false);
});

test("test_dead_chip_is_false_for_a_chip_leaving_one_list_filled", () => {
  assert.equal(deadChip(false, "0·4"), false);
});

// ── narrowing ────────────────────────────────────────────────────────────

test("test_narrowing_is_false_when_every_key_holds_its_default", () => {
  assert.equal(narrowing(["a", "b"], { a: 1, b: "x" }, { a: 1, b: "x" }), false);
});

test("test_narrowing_is_true_when_one_key_moved", () => {
  assert.equal(narrowing(["a", "b"], { a: 1, b: "y" }, { a: 1, b: "x" }), true);
});

test("test_narrowing_compares_pick_lists_by_content", () => {
  assert.equal(narrowing(["a"], { a: ["p"] }, { a: ["p"] }), false);
});

test("test_narrowing_ignores_a_moved_key_outside_the_set", () => {
  assert.equal(narrowing(["a"], { a: 1, z: 2 }, { a: 1, z: 0 }), false);
});

// ── stateKeys ────────────────────────────────────────────────────────────

test("test_state_keys_name_each_segment_row", () => {
  assert.deepEqual(stateKeys([TWO_ROWS]), ["r1", "r2"]);
});

test("test_state_keys_name_each_check_item", () => {
  assert.deepEqual(stateKeys([BOXES]), ["c1", "c2", "c3"]);
});

test("test_state_keys_add_the_mode_key_of_a_combining_facet", () => {
  assert.deepEqual(stateKeys([MIXED]), ["mix", "mixMode"]);
});

test("test_state_keys_name_a_plain_facet_by_its_key", () => {
  assert.deepEqual(stateKeys([PLAIN, SWITCH]), ["plain", "sw"]);
});
