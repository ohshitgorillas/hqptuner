// Store suite for the Filter presets rows (store/faceplate/page/presets.js `presetRows()`) in a browser that still
// holds a value under `hqptuner.easyMaterial`, the key the retired material switch was kept under. The section has no
// such switch, so what it offers does not depend on that key: a stored value grays no row.
//
// The environment is the seam: the fake localStorage is installed and the key written at file scope, and only then is
// any store module pulled in, so every load-time read meets the stored value. The rows are seeded through the shared
// LIVE lane harness (tests/js/support/easy/easytiles.js `resetLive`). Nothing of HQPTuner's is stubbed.
//
// The key name is contract with the browser, and the stored value is a material knob position, a wire identifier.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-page/presets-stored-material.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

const MATERIAL_KEY = "hqptuner.easyMaterial";
const STORED_MATERIAL = "lossy";

useStorage().setItem(MATERIAL_KEY, STORED_MATERIAL);

const { resetLive } = await import("../../support/easy/easytiles.js");
const { presetRows, foldSubsets } = await import("../../../../hqptuner/static/store/faceplate/page/presets.js");

/** @typedef {import("../../../../hqptuner/static/store/faceplate/page/presets.js").PresetRow} PresetRow */

/**
 * The keys of every grayed row, nested rows keyed `under>id`, top-level rows by id alone.
 *
 * @returns {string[]}
 */
function grayedKeys() {
  /** @type {string[]} */
  const out = [];
  for (const row of presetRows()) {
    if (row.grayed) out.push(row.id);
    for (const sub of row.subs || []) if (sub.grayed) out.push(`${sub.under}>${sub.id}`);
  }
  return out;
}

test("test_a_material_stored_by_the_retired_switch_grays_no_preset_row", async () => {
  await resetLive();
  foldSubsets();
  assert.deepEqual(grayedKeys(), []);
});
