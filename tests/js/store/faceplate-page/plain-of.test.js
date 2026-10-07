// Behavioral suite for plainOf(kind, name) in hqptuner/static/store/faceplate/page/conversion.js: the plain breakdown
// a nameplate draws, and the rate-floor tier it carries. A modulator's tier is the one its overlay's `min_rate_hz`
// names; every other overlay's is empty. While the Simplified option style is on, a modulator's leaf drops a trailing
// `, DSD<rate>+` clause that names its own tier, and keeps one that names another; Standard style names the option by
// its raw engine name.
//
// The wire is the seam: the overlay bundle into `metadata`, the option style into `plainNames`. Every name, leaf and
// rate floor here is the fixture's own. A `min_rate_hz` of 20480000 names the "512+" tier, the pairing
// tests/js/store/faceplate-lists/options.test.js already pins for the option lists.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-page/plain-of.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { metadata } from "../../../../hqptuner/static/store/signals.js";
import { plainNames } from "../../../../hqptuner/static/store/ui/prefs.js";
import { plainOf } from "../../../../hqptuner/static/store/faceplate/page/conversion.js";

/** A rate floor that names the 512+ tier. */
const FLOOR_512 = 20480000;

/** The tier FLOOR_512 names. */
const TIER_512 = "512+";

/** A modulator whose plain leaf ends in the clause its own tier names. */
const MOD_MATCH = "fx-mod-match";
const LEAF_MATCH_BARE = "fx-leaf-match";
const LEAF_MATCH = `${LEAF_MATCH_BARE}, DSD512+`;

/** A modulator whose plain leaf ends in a clause naming a tier other than its own. */
const MOD_MISMATCH = "fx-mod-mismatch";
const LEAF_MISMATCH = "fx-leaf-mismatch, DSD256+";

/** A modulator whose raw engine name itself ends in its tier's clause. */
const MOD_STD = "fx-mod-std, DSD512+";

/** A name both the filter overlay and the modulator rate floors carry. */
const SHARED = "fx-shared";
const LEAF_FILTER = "fx-leaf-filter, DSD512+";

/**
 * One plain-names entry.
 *
 * @param {string} leaf
 */
const entry = (leaf) => ({ family: "fx-family", variant: "fx-variant", leaf, short: "fx-short" });

/** A fresh /api/metadata payload: writing the same object to a signal does not notify. */
const overlays = () => ({
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: {
    pcm_dithers: {},
    sdm_modulators: {
      [MOD_MATCH]: { min_rate_hz: FLOOR_512 },
      [MOD_MISMATCH]: { min_rate_hz: FLOOR_512 },
      [MOD_STD]: { min_rate_hz: FLOOR_512 },
      [SHARED]: { min_rate_hz: FLOOR_512 },
    },
  },
  plain_names: {
    filters: { entries: { [SHARED]: entry(LEAF_FILTER) }, families: {}, variants: {} },
    modulators: {
      entries: {
        [MOD_MATCH]: entry(LEAF_MATCH),
        [MOD_MISMATCH]: entry(LEAF_MISMATCH),
        [MOD_STD]: entry(LEAF_MATCH),
      },
      families: {},
      variants: {},
    },
  },
});

beforeEach(() => {
  metadata.value = overlays();
  plainNames.value = true;
});

test("test_a_simplified_modulator_drops_the_leaf_clause_its_own_tier_names", () => {
  assert.equal(plainOf("modulators", MOD_MATCH).leaf, LEAF_MATCH_BARE);
});

test("test_a_modulator_carries_the_tier_its_rate_floor_names", () => {
  assert.equal(plainOf("modulators", MOD_MATCH).tier, TIER_512);
});

test("test_a_simplified_modulator_keeps_a_leaf_clause_naming_another_tier", () => {
  assert.equal(plainOf("modulators", MOD_MISMATCH).leaf, LEAF_MISMATCH);
});

test("test_a_filter_carries_no_tier_even_where_a_modulator_shares_its_name", () => {
  assert.equal(plainOf("filters", SHARED).tier, "");
});

test("test_a_simplified_filter_keeps_a_leaf_clause_naming_a_rate", () => {
  assert.equal(plainOf("filters", SHARED).leaf, LEAF_FILTER);
});

test("test_standard_style_names_a_modulator_by_its_raw_engine_name", () => {
  plainNames.value = false;
  assert.equal(plainOf("modulators", MOD_STD).leaf, MOD_STD);
});
