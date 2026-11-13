// Behavioral suite for hqptuner/static/store/faceplate/lists/folds.js: which option-list groups are folded. A user's
// fold is the persisted collapsed-group preference (store/ui/prefs.js). The DAC preferences fold the groups the
// manual calls the wrong fit (R-2R: the Additive dither family; ESS Sabre: each modulator family's Seventh order
// variant), a tap still opens one, and the tap is dropped when the preference changes.
//
// The seam is the preference signals: the collapsed-group toggle and the faceplate's DAC type and chip setters.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-lists/folds.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { toggleCollapsedGroup } from "../../../../hqptuner/static/store/ui/prefs.js";
import { isFolded, toggleFold } from "../../../../hqptuner/static/store/faceplate/lists/folds.js";
import { resetLists } from "../../support/listsfixture.js";

beforeEach(() => {
  resetLists();
});

test("test_a_tapped_variant_folds", () => {
  toggleFold("filters", "Fam A", "Var A");
  assert.equal(isFolded("filters", "Fam A", "Var A"), true);
});

test("test_a_group_v1_folded_reads_folded_here", () => {
  toggleCollapsedGroup("filters|Fam A|Var A");
  assert.equal(isFolded("filters", "Fam A", "Var A"), true);
});

test("test_a_second_tap_on_a_folded_variant_opens_it_again", () => {
  toggleFold("filters", "Fam A", "Var A");
  toggleFold("filters", "Fam A", "Var A");
  assert.equal(isFolded("filters", "Fam A", "Var A"), false);
});

test("test_a_fold_in_one_list_kind_does_not_fold_the_same_variant_in_another", () => {
  toggleFold("filters", "Fam A", "Var A");
  assert.equal(isFolded("modulators", "Fam A", "Var A"), false);
});
