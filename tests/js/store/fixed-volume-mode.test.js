// Behavioral suite for the Fixed volume mode rule over any view of the config: Auto headroom (`optimal_iso`, 0 off,
// 1 = -3 dB, 2 = -6 dB, or a bare bool from the /config form) wins over Manual (`fixed_volume_enabled`), else Off.
// The rule takes a getter (key to value), so each case hands it a plain table of settings.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/fixed-volume-mode.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fixedVolumeMode } from "../../../hqptuner/static/store/schema/gray.js";

/**
 * A getter over a table of settings.
 *
 * @param {Record<string, string | boolean>} table
 * @returns {(key: string) => string | boolean | undefined}
 */
const view = (table) => (key) => table[key];

test("test_auto_headroom_at_minus_six_over_a_manual_level_reads_auto", () => {
  assert.equal(fixedVolumeMode(view({ optimal_iso: "2", fixed_volume_enabled: "1" })), "auto");
});

test("test_a_manual_level_under_an_unchecked_auto_headroom_box_reads_manual", () => {
  assert.equal(fixedVolumeMode(view({ optimal_iso: false, fixed_volume_enabled: true })), "manual");
});

test("test_auto_headroom_off_and_the_manual_level_off_reads_off", () => {
  assert.equal(fixedVolumeMode(view({ optimal_iso: "0", fixed_volume_enabled: "0" })), "off");
});
