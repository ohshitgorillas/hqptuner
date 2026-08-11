// Behavioural suite for the rescan caption on the output-device fields
// (components/Field.js, schema flag `rescan`): the "Refresh devices" button
// stops the engine, and with auto-save on HQPTuner puts the engine's live
// settings back afterwards — every one of them except a matrix profile, which
// cannot be loaded without live playback. So the field says what the button
// costs, and says it only when auto-save is on to pay for it. With auto-save
// off nothing is replayed, so the sentence would be a lie and is not rendered.
//
// The flag is driven where it comes from: `autosave` on the /api/config payload
// the `config` signal carries (GET /api/config `data.autosave`, the flag
// POST /api/autosave toggles). Nothing of the store is stubbed, and the signal
// is reassigned as a fresh object because writing the same reference does not
// notify.
//
// What is NOT asserted here: that the caption sits BELOW the manual note. SSR
// order is checkable, but the spec states the caption's presence and its gate,
// and ordering is the design system's business at hand-back.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/field-rescan-caption.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field } from "../support/field-harness.js";
import { config } from "../../../hqptuner/static/store/signals.js";

const CAPTION = "Stops the engine. All live settings except matrix profiles survive.";

/** @param {boolean} autosave */
async function withAutosave(autosave) {
  await reset();
  config.value = { ...config.value, autosave };
}

test("test_a_rescan_field_carries_the_engine_stop_caption_when_autosave_is_on", async () => {
  await withAutosave(true);
  assert.ok(field("alsa_device").includes(CAPTION));
});

test("test_a_rescan_field_carries_no_engine_stop_caption_when_autosave_is_off", async () => {
  await withAutosave(false);
  assert.equal(field("alsa_device").includes(CAPTION), false);
});
