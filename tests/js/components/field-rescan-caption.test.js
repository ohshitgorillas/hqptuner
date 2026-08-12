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
// Where it sits is asserted too: the caption is an addition to the field's
// prose, so it follows the manual note the field already carries rather than
// pushing it down the page. Asserting presence alone would be satisfied by a
// field that renders the caption and no manual note at all.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/field-rescan-caption.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field } from "../support/field-harness.js";
import { config } from "../../../hqptuner/static/store/signals.js";

const CAPTION = "Stops the engine. All live settings except matrix profiles survive.";

// The output-device field's manual prose, as the harness' /api/metadata fixture
// carries it (settings.output.output_device.tooltip).
const NOTE = "Device prose.";

/** @param {boolean} autosave */
async function withAutosave(autosave) {
  await reset();
  config.value = { ...config.value, autosave };
}

test("test_a_rescan_field_carries_the_engine_stop_caption_when_autosave_is_on", async () => {
  await withAutosave(true);
  assert.ok(field("alsa_device").includes(CAPTION));
});

test("test_a_rescan_fields_engine_stop_caption_follows_its_manual_note", async () => {
  await withAutosave(true);
  const out = field("alsa_device");
  const noteAt = out.indexOf(NOTE);
  const captionAt = out.indexOf(CAPTION);
  assert.ok(noteAt >= 0 && captionAt > noteAt, `manual note at ${noteAt}, caption at ${captionAt}`);
});

test("test_a_rescan_field_carries_no_engine_stop_caption_when_autosave_is_off", async () => {
  await withAutosave(false);
  assert.equal(field("alsa_device").includes(CAPTION), false);
});
