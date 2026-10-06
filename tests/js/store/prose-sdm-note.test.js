// Behavioral suite for the SDM two-stage sentence — the filters overlay's
// shared `sdm_two_stage_note`, shown for a filter entry flagged
// `sdm_two_stage: true` and ONLY when the control being described belongs to
// the SDM filter chain.
//
// The chain axis rides on the schema entry's `desc` field: `pcm_filter_1x` /
// `pcm_filter_nx` carry `desc: "filter"`, `sdm_filter_1x` / `sdm_filter_nx`
// carry `desc: "sdm_filter"`. Entries come from the real schema; the overlay is
// the field-harness META payload the reset() seeds into the /api/metadata
// signal, extended here with two flagged filter records and the shared
// sentence.
//
// `sdm_two_stage_note` and the older `two_stage_note` are different mechanisms
// — the first keyed by the entry flag and the control's chain, the second by a
// `-2s` suffix on the filter's own name — so both can land on one string, and
// the ordering case below pins which comes first.
//
// Coverage gap, deliberate: a `desc: "config"` control is not covered here. Its
// prose comes from settings.json's per-value options map, never from the
// filters overlay, so neither new key has anything to reach it through and no
// case could constrain them; prose-options.test.js already pins that path. The
// "other desc sources" section below therefore covers the dither and modulator
// chains only.

import test from "node:test";
import assert from "node:assert/strict";

import { optionDescription, selectionDescription } from "../../../hqptuner/static/store/prose.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { reset, META } from "../support/field-harness.js";

const FILTER_META = META.settings.dsp.filter_1x;
const SHAPER_META = META.settings.dsp.shaper;

// Two degenerate overlays, each the worked payload with only the shared
// sentence disturbed: one published before the key existed, one where the key
// is present and empty. The filters overlay is rebuilt by destructuring rather
// than by listing its other keys, so a key added to META.filters later stays in
// the fixture instead of being silently dropped from it.
const { sdm_two_stage_note: _dropped, ...NO_SDM_NOTE_FILTERS } = META.filters;

const NO_SDM_NOTE_META = { settings: META.settings, filters: NO_SDM_NOTE_FILTERS, shapers: META.shapers };

const EMPTY_SDM_NOTE_META = {
  settings: META.settings,
  filters: { ...NO_SDM_NOTE_FILTERS, sdm_two_stage_note: "" },
  shapers: META.shapers,
};

/** @param {string} label */
const one = (label) => [{ value: "0", label }];

// ============================================================================
// the note rides the SDM chain only
// ============================================================================

test("test_a_flagged_filter_selected_on_the_sdm_chain_appends_the_sdm_two_stage_note", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.sdm_filter_1x, "0", one("sdm-A"), FILTER_META),
    "A flagged sinc. Two stage for SDM.",
  );
});

test("test_a_flagged_filter_selected_on_the_sdm_nx_chain_appends_the_sdm_two_stage_note", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.sdm_filter_nx, "0", one("sdm-A"), FILTER_META),
    "A flagged sinc. Two stage for SDM.",
  );
});

test("test_a_flagged_filter_selected_on_the_pcm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.pcm_filter_1x, "0", one("sdm-A"), FILTER_META), "A flagged sinc.");
});

test("test_a_flagged_filter_selected_on_the_pcm_nx_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.pcm_filter_nx, "0", one("sdm-A"), FILTER_META), "A flagged sinc.");
});

test("test_an_unflagged_filter_selected_on_the_pcm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.pcm_filter_1x, "0", one("sinc-M"), FILTER_META), "A very long sinc.");
});

test("test_an_unflagged_filter_selected_on_the_sdm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.sdm_filter_1x, "0", one("sinc-M"), FILTER_META), "A very long sinc.");
});

// ============================================================================
// an explicit `sdm_two_stage: false` reads as unflagged
// ============================================================================

test("test_a_filter_flagged_false_selected_on_the_sdm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.sdm_filter_1x, "0", one("sdm-C"), FILTER_META),
    "An explicitly single stage sinc.",
  );
});

test("test_a_filter_flagged_false_option_on_the_sdm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_filter_1x, { value: "0", label: "sdm-C" }, FILTER_META),
    "An explicitly single stage sinc.",
  );
});

// ============================================================================
// neither join contributes a separator to a string it is alone in
// ============================================================================

test("test_a_flagged_filter_with_an_empty_description_selected_on_the_sdm_chain_describes_the_sentence_alone", async () => {
  await reset();
  assert.equal(selectionDescription(schema.sdm_filter_1x, "0", one("sdm-D"), FILTER_META), "Two stage for SDM.");
});

test("test_a_flagged_filter_option_with_an_empty_description_on_the_sdm_chain_describes_the_sentence_alone", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_filter_1x, { value: "0", label: "sdm-D" }, FILTER_META),
    "Two stage for SDM.",
  );
});

// ============================================================================
// ordering: description, sdm note, notes, then the -2s variant note
// ============================================================================

test("test_a_flagged_two_stage_filter_selected_orders_the_sdm_note_before_notes_and_the_variant_note", async () => {
  await reset();
  assert.equal(
    selectionDescription(schema.sdm_filter_1x, "0", one("sdm-B-2s"), FILTER_META),
    "A flagged short sinc. Two stage for SDM. Flagged caveat. Two stage oversampling.",
  );
});

// ============================================================================
// an overlay with no shared sentence contributes no separator
// ============================================================================

test("test_a_flagged_filter_selected_with_no_shared_sentence_describes_the_description_alone", async () => {
  await reset({ meta: NO_SDM_NOTE_META });
  assert.equal(selectionDescription(schema.sdm_filter_1x, "0", one("sdm-A"), FILTER_META), "A flagged sinc.");
});

test("test_a_flagged_filter_selected_with_an_empty_shared_sentence_describes_the_description_alone", async () => {
  await reset({ meta: EMPTY_SDM_NOTE_META });
  assert.equal(selectionDescription(schema.sdm_filter_1x, "0", one("sdm-A"), FILTER_META), "A flagged sinc.");
});

// ============================================================================
// optionDescription obeys the same rules
// ============================================================================

test("test_a_flagged_filter_option_on_the_sdm_chain_appends_the_sdm_two_stage_note", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_filter_1x, { value: "0", label: "sdm-A" }, FILTER_META),
    "A flagged sinc. Two stage for SDM.",
  );
});

test("test_a_flagged_filter_option_on_the_sdm_nx_chain_appends_the_sdm_two_stage_note", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_filter_nx, { value: "0", label: "sdm-A" }, FILTER_META),
    "A flagged sinc. Two stage for SDM.",
  );
});

test("test_a_flagged_filter_option_on_the_pcm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_filter_1x, { value: "0", label: "sdm-A" }, FILTER_META), "A flagged sinc.");
});

test("test_an_unflagged_filter_option_on_the_pcm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-M" }, FILTER_META),
    "A very long sinc.",
  );
});

test("test_an_unflagged_filter_option_on_the_sdm_chain_describes_the_description_alone", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_filter_1x, { value: "0", label: "sinc-M" }, FILTER_META),
    "A very long sinc.",
  );
});

test("test_a_flagged_two_stage_filter_option_orders_the_sdm_note_before_notes_and_the_variant_note", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_filter_1x, { value: "0", label: "sdm-B-2s" }, FILTER_META),
    "A flagged short sinc. Two stage for SDM. Flagged caveat. Two stage oversampling.",
  );
});

test("test_a_flagged_filter_option_with_no_shared_sentence_describes_the_description_alone", async () => {
  await reset({ meta: NO_SDM_NOTE_META });
  assert.equal(optionDescription(schema.sdm_filter_1x, { value: "0", label: "sdm-A" }, FILTER_META), "A flagged sinc.");
});

test("test_a_flagged_filter_option_with_an_empty_shared_sentence_describes_the_description_alone", async () => {
  await reset({ meta: EMPTY_SDM_NOTE_META });
  assert.equal(optionDescription(schema.sdm_filter_1x, { value: "0", label: "sdm-A" }, FILTER_META), "A flagged sinc.");
});

// ============================================================================
// the other desc sources are untouched by either new key
// ============================================================================

test("test_a_flagged_dither_option_describes_the_description_alone", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_dither, { value: "0", label: "TPDFX" }, SHAPER_META), "Flagged dither.");
});

test("test_a_flagged_modulator_option_describes_the_description_alone", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_modulator, { value: "0", label: "ASDM9X" }, SHAPER_META),
    "Flagged modulator.",
  );
});
