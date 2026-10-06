// Behavioral suite for the manual's caveat sentences reaching the user.
//
// filters.json and shapers.json give some overlay records a `notes` string
// beside `description` — HQPlayer's own caveats ("Not recommended.", the NS1
// ultrasonic-noise warning, the AHM5EC5L limited-SNR note). Both prose entry
// points render them: the description, then the notes, single-spaced.
//
// Overlays are driven the way the neighboring prose suite drives them: the
// field-harness reset() seeds the /api/metadata signal with its worked META
// payload, which carries the three shapes of notes-bearing record (description
// + notes, empty description + notes, notes with no description key).
//
// Entries come from the real schema; `meta` is the control's settings.json
// prose entry out of the same META payload.

import test from "node:test";
import assert from "node:assert/strict";

import { optionDescription } from "../../../hqptuner/static/store/prose.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { reset, META } from "../support/field-harness.js";

const FILTER_META = META.settings.dsp.filter_1x;
const SHAPER_META = META.settings.dsp.shaper;

// ============================================================================
// description + notes, single-spaced
// ============================================================================

test("test_a_filter_option_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-S" }, FILTER_META),
    "A short sinc. Not recommended.",
  );
});

test("test_a_dither_option_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_dither, { value: "0", label: "NS1" }, SHAPER_META),
    "First noise shaper. Produces ultrasonic noise.",
  );
});

test("test_a_modulator_option_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_modulator, { value: "0", label: "AHM5EC5L" }, SHAPER_META),
    "Fifth order AHM. Limited SNR.",
  );
});

// ============================================================================
// one side missing — no stray separator
// ============================================================================

// The optionDescription half of the no-notes case is prose-options.test.js's
// "test_a_filter_desc_option_joins_the_manual_description_by_label" — same
// entry, same option, same expectation — so it is not repeated here.

test("test_a_filter_option_with_an_empty_description_describes_the_notes_alone", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-V" }, FILTER_META), "Only note.");
});

test("test_a_filter_option_with_no_description_key_describes_the_notes_alone", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-W" }, FILTER_META), "Bare note.");
});

// ============================================================================
// two-stage ordering: description, notes, then the shared two-stage note
// ============================================================================

test("test_a_two_stage_filter_option_orders_notes_before_the_two_stage_note", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-S-2s" }, FILTER_META),
    "A short sinc. Not recommended. Two stage oversampling.",
  );
});

// ============================================================================
// an entry with no desc describes nothing, whatever the meta offers
// ============================================================================
