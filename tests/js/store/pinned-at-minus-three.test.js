// Behavioral suite for "the volume stands pinned at a fixed -3 dB", judged by the Fixed volume mode in force: Auto
// headroom (`optimal_iso`, 0 off, 1 = -3 dB, 2 = -6 dB) supersedes the Manual level (`fixed_volume_enabled` gating
// `fixed_volume`), so a Manual level left on underneath an Auto headroom counts for nothing.
// The predicate takes a getter (key to value), so each case hands it a plain table of settings.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/pinned-at-minus-three.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { atFixedMinusThree } from "../../../hqptuner/static/store/schema/gray.js";

const AUTO_MINUS_SIX = "2";
const MANUAL_ON = "1";
const LEVEL_MINUS_THREE = "-3";

/**
 * A getter over a table of settings.
 *
 * @param {Record<string, string | boolean>} table
 * @returns {(key: string) => string | boolean | undefined}
 */
const view = (table) => (key) => table[key];

test("test_auto_headroom_at_minus_six_over_a_manual_level_on_at_minus_three_is_not_pinned_at_minus_three", () => {
  const settings = view({
    optimal_iso: AUTO_MINUS_SIX,
    fixed_volume_enabled: MANUAL_ON,
    fixed_volume: LEVEL_MINUS_THREE,
  });
  assert.equal(atFixedMinusThree(settings), false);
});
