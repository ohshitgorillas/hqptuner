// Behavioral suite for mockup/scripts/model/schema.js: reading a drawer schema's rows without the DOM. Every row in
// schema order, a group's rows in place, items that hold no row passed over; and the one row a label names, inside a
// backend's group or outside every group.
//
// Every schema is a table this file writes.
//
// Run: node --test tests/js/mockup/schema.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { rowsOf, rowOf } from "../../../../mockup/scripts/model/schema.js";

//: Rows the schemas below hold, each its own object so a lookup is checked by identity.
const RATE = { label: "Rate" };
const MODE = { label: "Mode" };
const NET_BITS = { label: "Bits" };
const NET_DSD = { label: "DSD" };
const ALSA_BITS = { label: "Bits" };
const TOP_BITS = { label: "Bits" };
const BACKEND = { label: "Backend" };
const LATE_RATE = { label: "Rate" };

/** Two tabs: an intro, a lone row and two backend groups, then a block and two lone rows, the last reusing a label. */
const DRAWER = {
  tabs: [
    {
      body: [
        { intro: "about" },
        { row: RATE },
        { group: "network", rows: [NET_BITS, NET_DSD] },
        { group: "alsa", rows: [ALSA_BITS] },
      ],
    },
    { body: [{ block: "range" }, { row: BACKEND }, { row: LATE_RATE }] },
  ],
};

/** One tab whose lone row shares its label with a grouped row after it. */
const SHARED = { tabs: [{ body: [{ group: "network", rows: [NET_BITS] }, { row: TOP_BITS }, { row: MODE }] }] };

test("test_rows_of_lists_every_row_in_schema_order", () => {
  assert.deepEqual(rowsOf(DRAWER), [RATE, NET_BITS, NET_DSD, ALSA_BITS, BACKEND, LATE_RATE]);
});

test("test_rows_of_a_tab_with_no_rows_is_empty", () => {
  assert.deepEqual(rowsOf({ tabs: [{ body: [{ block: "sigpath" }] }] }), []);
});

test("test_row_of_finds_a_lone_row_by_label", () => {
  assert.equal(rowOf(DRAWER, "Backend"), BACKEND);
});

test("test_row_of_takes_the_first_lone_row_of_a_label", () => {
  assert.equal(rowOf(DRAWER, "Rate"), RATE);
});

test("test_row_of_without_a_group_passes_over_grouped_rows", () => {
  assert.equal(rowOf(SHARED, "Bits"), TOP_BITS);
});

test("test_row_of_without_a_group_finds_nothing_only_a_group_holds", () => {
  assert.equal(rowOf(DRAWER, "DSD"), null);
});

test("test_row_of_finds_a_row_inside_its_group", () => {
  assert.equal(rowOf(DRAWER, "DSD", "network"), NET_DSD);
});

test("test_row_of_with_a_group_passes_over_another_groups_row", () => {
  assert.equal(rowOf(DRAWER, "Bits", "alsa"), ALSA_BITS);
});

test("test_row_of_with_a_group_passes_over_lone_rows", () => {
  assert.equal(rowOf(SHARED, "Mode", "network"), null);
});

test("test_row_of_an_unknown_group_finds_nothing", () => {
  assert.equal(rowOf(DRAWER, "Bits", "combo"), null);
});

test("test_row_of_an_unknown_label_finds_nothing", () => {
  assert.equal(rowOf(DRAWER, "Volume"), null);
});
