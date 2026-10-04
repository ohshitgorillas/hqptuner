// Behavioral suite for mockup/scripts/model/presets.js: what a subset preset nested under a flagship shows, free of the
// DOM. The filter it names, the resource cost it carries, its correction coverage and whether it offers a Correction
// toggle, each by its version under that flagship and the Correction it is set to.
//
// Every lineage table is one this file writes.
//
// Run: node --test tests/js/mockup/presets.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { subsetVersion } from "../../../../mockup/scripts/model/shell/presets.js";

//: Two subsets under two flagship lanes: a switchable version priced in pips, one at a single pip, one priced in a word,
//: and a fixed version with no non-correcting twin.
const ROWS = {
  hall: {
    gold: { on: "f-on", off: "f-off", cost: { pips: 5 } },
    silk: { on: "g-on", off: "g-off", cost: { pips: 1 } },
  },
  pit: {
    gold: { on: "h-on", off: "h-off", cost: { word: "Adaptive" } },
    silk: { fixed: "h-fixed", cost: { pips: 4 } },
  },
};

/**
 * @param {string} id
 * @param {string} lane
 * @param {boolean} on
 */
const version = (id, lane, on) => subsetVersion(ROWS, id, lane, on);

test("test_correction_on_names_the_correcting_filter", () => {
  assert.equal(version("hall", "gold", true).filter, "f-on");
});

test("test_correction_off_names_the_non_correcting_filter", () => {
  assert.equal(version("hall", "gold", false).filter, "f-off");
});

test("test_a_fixed_version_names_its_filter_with_correction_off", () => {
  assert.equal(version("pit", "silk", false).filter, "h-fixed");
});

test("test_correction_on_keeps_the_versions_cost", () => {
  assert.deepEqual(version("hall", "gold", true).cost, { pips: 5 });
});

test("test_correction_off_costs_one_pip_less", () => {
  assert.deepEqual(version("hall", "gold", false).cost, { pips: 4 });
});

test("test_correction_off_never_costs_less_than_one_pip", () => {
  assert.deepEqual(version("hall", "silk", false).cost, { pips: 1 });
});

test("test_a_worded_cost_holds_with_correction_off", () => {
  assert.deepEqual(version("pit", "gold", false).cost, { word: "Adaptive" });
});

test("test_a_fixed_version_keeps_its_cost_with_correction_off", () => {
  assert.deepEqual(version("pit", "silk", false).cost, { pips: 4 });
});

test("test_correction_on_shows_full_coverage", () => {
  assert.equal(version("hall", "gold", true).correction, "full");
});

test("test_correction_off_shows_no_coverage", () => {
  assert.equal(version("hall", "gold", false).correction, "none");
});

test("test_a_fixed_version_shows_full_coverage_with_correction_off", () => {
  assert.equal(version("pit", "silk", false).correction, "full");
});

test("test_a_switchable_version_offers_the_correction_toggle", () => {
  assert.equal(version("hall", "gold", true).toggle, true);
});

test("test_a_fixed_version_offers_no_correction_toggle", () => {
  assert.equal(version("pit", "silk", true).toggle, false);
});
