// Behavioral suite for hqptuner/static/store/faceplate/settings/rail.js: the Settings rail as data. Each category comes
// back in order with its open flag, the blink the alert plan holds for it, and one row per readout printed through the
// control's readout form, followed by the live row when the category carries one.
//
// The seam is the pure function's arguments: categories, controls, accents and alerts the test writes, and an alert
// plan built from them by the model's own alertPlan. Every expected string is one this file put in.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-settings/rail.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { alertPlan } from "../../../../hqptuner/static/model/shell/alerts.js";
import { readoutOf } from "../../../../hqptuner/static/model/shell/settings.js";
import { settingsRail } from "../../../../hqptuner/static/store/faceplate/settings/rail.js";

//: Accents the test writes: a known pick carries its own swatch color and name.
const ACCENTS = [
  { v: "ember", label: "Ember", hex: "#c04020" },
  { v: "sea", label: "Sea", hex: "#2080c0" },
];

//: Controls the test writes, one per readout form the rail shows.
const SEG = {
  type: "seg",
  options: [
    { v: "a", label: "Alpha" },
    { v: "b", label: "Beta", unit: "kHz" },
  ],
};
const TOGGLES = {
  type: "toggles",
  options: [
    { v: "p", label: "Pea" },
    { v: "q", label: "Queue" },
  ],
};
const ACCENT = { type: "accent", options: ACCENTS };

//: Categories the test writes: one with a live row and a wide readout, one with an accent readout.
const CATEGORIES = [
  {
    id: "dsp",
    name: "Processing",
    readouts: [
      { id: "mode", label: "Mode", control: SEG, value: () => "a" },
      { id: "rate", label: "Rate", control: SEG, value: () => "b" },
      { id: "dither", label: "Dither", wide: true, control: TOGGLES, value: () => "" },
    ],
    live: { label: "Path", value: () => "Upsampling" },
  },
  {
    id: "view",
    name: "Display",
    readouts: [{ id: "vacc", label: "Accent", control: ACCENT, value: () => "sea" }],
  },
];

//: One critical alert the test homes on the Display category.
const PLAN = alertPlan([{ kind: "glare", sev: "crit", text: "t" }], { glare: { set: "view" } });

/**
 * The rail entry for one category.
 *
 * @param {string} id
 * @param {string | null} [open]
 */
const entryOf = (id, open = null) => settingsRail(CATEGORIES, PLAN, open, ACCENTS).find((c) => c.id === id);

/**
 * One row of a category's rail entry, by its label.
 *
 * @param {string} id
 * @param {string} label
 */
const rowOf = (id, label) => entryOf(id)?.rows.find((/** @type {{ label: string }} */ r) => r.label === label);

test("test_categories_come_back_in_the_order_given", () => {
  assert.deepEqual(
    settingsRail(CATEGORIES, PLAN, null, ACCENTS).map((c) => c.id),
    ["dsp", "view"],
  );
});

test("test_a_seg_readout_prints_its_option_label_not_the_value", () => {
  assert.equal(rowOf("dsp", "Mode")?.text, "Alpha");
});

test("test_a_seg_readout_carries_its_option_unit", () => {
  assert.ok(rowOf("dsp", "Rate")?.text.includes("kHz"));
});

test("test_a_toggles_readout_with_nothing_picked_prints_the_readout_forms_empty_text", () => {
  assert.equal(rowOf("dsp", "Dither")?.text, readoutOf(TOGGLES, "", ACCENTS).text);
});

test("test_an_accent_readout_carries_its_swatch_color", () => {
  assert.equal(rowOf("view", "Accent")?.swatch, "#2080c0");
});

test("test_a_non_accent_readout_carries_no_swatch", () => {
  assert.equal(rowOf("dsp", "Mode")?.swatch, null);
});

test("test_a_readout_set_wide_is_wide", () => {
  assert.equal(rowOf("dsp", "Dither")?.wide, true);
});

test("test_a_readout_not_set_wide_is_not_wide", () => {
  assert.equal(rowOf("dsp", "Mode")?.wide, false);
});

test("test_the_live_row_comes_last", () => {
  assert.equal(entryOf("dsp")?.rows.at(-1)?.label, "Path");
});

test("test_the_live_row_prints_the_live_value", () => {
  assert.equal(rowOf("dsp", "Path")?.text, "Upsampling");
});

test("test_the_category_named_open_is_open", () => {
  assert.equal(entryOf("view", "view")?.open, true);
});

test("test_a_category_not_named_open_is_closed", () => {
  assert.equal(entryOf("dsp", "view")?.open, false);
});

test("test_a_category_carries_the_blink_the_plan_holds_for_it", () => {
  assert.equal(entryOf("view")?.alert, "crit");
});

test("test_a_category_the_plan_does_not_blink_carries_no_alert", () => {
  assert.equal(entryOf("dsp")?.alert, undefined);
});
