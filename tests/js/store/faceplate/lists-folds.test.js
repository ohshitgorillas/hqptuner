// Behavioral suite for hqptuner/static/store/faceplate/lists/folds.js: which option-list groups are folded. A user's
// fold is v1's own collapsed-group preference, shared with v1's dropdowns. The DAC preferences fold the groups the
// manual calls the wrong fit (R-2R: the Additive dither family; ESS Sabre: each modulator family's Seventh order
// variant), a tap still opens one, and the tap is dropped when the preference changes.
//
// The seam is the preference signals: v1's collapsed-group toggle and the faceplate's DAC type and chip setters.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/lists-folds.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { toggleCollapsedGroup } from "../../../../hqptuner/static/store/ui/prefs.js";
import { setDacChip, setDacType } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { isFolded, toggleFold } from "../../../../hqptuner/static/store/faceplate/lists/folds.js";
import { resetLists } from "../../support/listsfixture.js";

beforeEach(() => {
  resetLists();
});

test("test_a_tapped_variant_folds_and_a_second_tap_opens_it", () => {
  toggleFold("filters", "Fam A", "Var A");
  const once = isFolded("filters", "Fam A", "Var A");
  toggleFold("filters", "Fam A", "Var A");
  assert.deepEqual([once, isFolded("filters", "Fam A", "Var A")], [true, false]);
});

test("test_a_group_v1_folded_reads_folded_here", () => {
  toggleCollapsedGroup("filters|Fam A|Var A");
  assert.equal(isFolded("filters", "Fam A", "Var A"), true);
});

test("test_a_fold_is_kept_per_list_kind", () => {
  toggleFold("filters", "Fam A", "Var A");
  assert.deepEqual([isFolded("filters", "Fam A", "Var A"), isFolded("modulators", "Fam A", "Var A")], [true, false]);
});

test("test_an_r2r_dac_folds_the_additive_dither_family", () => {
  setDacType("r2r");
  assert.deepEqual([isFolded("dithers", "Additive", ""), isFolded("dithers", "Noise shaping", "")], [true, false]);
});

test("test_an_ess_dac_folds_each_modulator_familys_seventh_order_variant", () => {
  setDacChip("ess");
  const folded = [
    ["Fixed", "Seventh order"],
    ["Adaptive", "Seventh order"],
    ["Hybrid", "Seventh order"],
    ["Adaptive", "Fifth order"],
  ].map(([fam, v]) => isFolded("modulators", fam, v));
  assert.deepEqual(folded, [true, true, true, false]);
});

test("test_a_tap_opens_a_dac_folded_group", () => {
  setDacType("r2r");
  const before = isFolded("dithers", "Additive", "");
  toggleFold("dithers", "Additive", "");
  assert.deepEqual([before, isFolded("dithers", "Additive", "")], [true, false]);
});

test("test_a_dac_preference_change_drops_the_tap_that_opened_its_group", () => {
  setDacType("r2r");
  toggleFold("dithers", "Additive", "");
  setDacType("other");
  setDacType("r2r");
  assert.equal(isFolded("dithers", "Additive", ""), true);
});

test("test_a_tap_on_a_dac_folded_group_leaves_no_fold_of_its_own_once_the_preference_is_off", () => {
  setDacType("r2r");
  toggleFold("dithers", "Additive", "");
  setDacType("other");
  const off = isFolded("dithers", "Additive", "");
  toggleFold("dithers", "Additive", "");
  assert.deepEqual([off, isFolded("dithers", "Additive", "")], [false, true]);
});
