// Behavioral suite for the rescan caption on the output-device fields
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

import { reset, field, META } from "../support/field-harness.js";
import { config } from "../../../hqptuner/static/store/signals.js";
import { elements, classes } from "../support/markup.js";

// The caption and the manual note are each identified by the class their own
// element wears. What either SAYS is the owner's wording and is not asserted
// (docs/testing.md rule 9); the note's prose below is invented test data, there
// only so the field has a note for the caption to follow.
const CAPTION_CLASS = "field-rescan-cost";
const NOTE_CLASS = "field-note";

// The shared harness fixture carries no record under `alsa_device`, and the
// field's label comes from the schema rather than from metadata, so without a
// tooltip here the field renders no note at all.
const NOTE = "Device note prose.";

/**
 * Where a fragment's element wearing `cls` starts, or -1 when none does.
 *
 * @param {string} out
 * @param {string} cls
 * @returns {number}
 */
const startOf = (out, cls) => {
  const hit = elements(out).find((el) => classes(el).includes(cls));
  return hit ? hit.start : -1;
};

const META_WITH_DEVICE_PROSE = {
  ...META,
  settings: {
    ...META.settings,
    output: { ...META.settings.output, alsa_device: { label: "Output device", tooltip: NOTE } },
  },
};

/** @param {boolean} autosave */
async function withAutosave(autosave) {
  await reset({ meta: META_WITH_DEVICE_PROSE });
  config.value = { ...config.value, autosave };
}

test("test_a_rescan_field_carries_the_engine_stop_caption_when_autosave_is_on", async () => {
  await withAutosave(true);
  assert.notEqual(startOf(field("alsa_device"), CAPTION_CLASS), -1);
});

test("test_a_rescan_fields_engine_stop_caption_follows_its_manual_note", async () => {
  await withAutosave(true);
  const out = field("alsa_device");
  const noteAt = startOf(out, NOTE_CLASS);
  const captionAt = startOf(out, CAPTION_CLASS);
  assert.ok(noteAt >= 0 && captionAt > noteAt, `manual note at ${noteAt}, caption at ${captionAt}`);
});

test("test_a_rescan_field_carries_no_engine_stop_caption_when_autosave_is_off", async () => {
  await withAutosave(false);
  assert.equal(startOf(field("alsa_device"), CAPTION_CLASS), -1);
});
