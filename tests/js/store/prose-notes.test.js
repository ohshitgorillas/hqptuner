// Behavioral suite for the manual's caveat sentences reaching the user.
//
// filters.json and shapers.json give some overlay records a `notes` string
// beside `description` — HQPlayer's own caveats ("Not recommended.", the NS1
// ultrasonic-noise warning, the AHM5EC5L limited-SNR note). Both prose entry
// points render them: the description, then the notes, single-spaced.
//
// Overlays are driven the way the neighbouring prose suite drives them: the
// field-harness reset() seeds the /api/metadata signal with its worked META
// payload, which carries the three shapes of notes-bearing record (description
// + notes, empty description + notes, notes with no description key).
//
// Entries come from the real schema; `meta` is the control's settings.json
// prose entry out of the same META payload.

import test from "node:test";
import assert from "node:assert/strict";

import { optionDescription, selectionDescription } from "../../../hqptuner/static/store/prose.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { reset, META } from "../support/field-harness.js";

const FILTER_META = META.settings.dsp.filter_1x;
const SHAPER_META = META.settings.dsp.shaper;

/** @param {string} label */
const one = (label) => [{ value: "0", label }];

// ============================================================================
// description + notes, single-spaced
// ============================================================================

test("test_a_selected_filter_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.pcm_filter_1x, "0", one("sinc-S"), FILTER_META),
    "A short sinc. Not recommended.",
  );
});

test("test_a_filter_option_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-S" }, FILTER_META),
    "A short sinc. Not recommended.",
  );
});

test("test_a_selected_dither_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.pcm_dither, "0", one("NS1"), SHAPER_META),
    "First noise shaper. Produces ultrasonic noise.",
  );
});

test("test_a_dither_option_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_dither, { value: "0", label: "NS1" }, SHAPER_META),
    "First noise shaper. Produces ultrasonic noise.",
  );
});

test("test_a_selected_modulator_appends_its_manual_notes_to_the_description", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.sdm_modulator, "0", one("AHM5EC5L"), SHAPER_META),
    "Fifth order AHM. Limited SNR.",
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

test("test_a_selected_filter_without_notes_describes_the_description_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.pcm_filter_1x, "0", one("sinc-M"), FILTER_META), "A very long sinc.");
});

// The optionDescription half of the no-notes case is prose-options.test.js's
// "test_a_filter_desc_option_joins_the_manual_description_by_label" — same
// entry, same option, same expectation — so it is not repeated here.

test("test_a_selected_filter_with_an_empty_description_describes_the_notes_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.pcm_filter_1x, "0", one("sinc-V"), FILTER_META), "Only note.");
});

test("test_a_filter_option_with_an_empty_description_describes_the_notes_alone", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-V" }, FILTER_META), "Only note.");
});

test("test_a_selected_filter_with_no_description_key_describes_the_notes_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.pcm_filter_1x, "0", one("sinc-W"), FILTER_META), "Bare note.");
});

test("test_a_filter_option_with_no_description_key_describes_the_notes_alone", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-W" }, FILTER_META), "Bare note.");
});

// ============================================================================
// two-stage ordering: description, notes, then the shared two-stage note
// ============================================================================

test("test_a_selected_two_stage_filter_orders_notes_before_the_two_stage_note", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.pcm_filter_1x, "0", one("sinc-S-2s"), FILTER_META),
    "A short sinc. Not recommended. Two stage oversampling.",
  );
});

// The one combination where the notes join and the two-stage join could each
// contribute a separator to a description that is not there.
test("test_a_selected_two_stage_filter_with_an_empty_description_joins_notes_to_the_two_stage_note", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.pcm_filter_1x, "0", one("sinc-V-2s"), FILTER_META),
    "Only note. Two stage oversampling.",
  );
});

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

// The meta carries an options map keyed by the option's value, so the "" here
// pins the missing `desc` on the entry alone, not a missing meta. The
// optionDescription twin of this case is in prose-options.test.js.
test("test_an_entry_without_desc_describes_no_selection", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.idle_time, "0", one("Never"), {
      label: "Idle",
      tooltip: "Idle prose.",
      options: { 0: "Never idles." },
    }),
    "",
  );
});
