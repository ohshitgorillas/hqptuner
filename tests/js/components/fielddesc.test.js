// Behavioral suite for the prose a Field renders: the hover title, the inline
// note, and the per-selection description.
//
// `selectionDescription` is private and stays that way: it is a pure function of
// the schema entry, the effective value, the option list and the settings.json
// entry — all four of which the rendered `.field-desc` line exposes. Every
// assertion below is on rendered output (attributes and the three prose lines),
// never on a helper.
//
// Split out of field.test.js (file-length gate); the shared fixture, wire fake
// and HTML-extraction helpers live in field-harness.js.

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, titleOf, line } from "../support/field-harness.js";

// ============================================================================
// hover title precedence
// ============================================================================

test("test_a_hover_note_field_hovers_its_tooltip", async () => {
  await reset();
  assert.equal(titleOf(field("output_mode")), "Mode prose.");
});

test("test_a_hover_note_fields_tooltip_outranks_its_gray_reason", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(titleOf(field("pcm_rate")), "Rate prose.");
});

test("test_a_hover_note_field_with_no_tooltip_hovers_its_gray_reason", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }], meta: {} });
  assert.equal(titleOf(field("pcm_rate")), "Only relevant to PCM output mode.");
});

test("test_a_visible_gray_caption_is_not_repeated_on_hover", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: true }] });
  assert.notEqual(titleOf(field("volume_max")), "Direct SDM bypasses the volume control.");
});

test("test_a_hidden_inline_note_moves_the_tooltip_to_the_hover", async () => {
  await reset({ desc: false, keep: false });
  assert.equal(titleOf(field("volume_max")), "Max prose.");
});

test("test_a_suppressed_gray_caption_moves_the_reason_to_the_hover", async () => {
  await reset();
  assert.equal(titleOf(field("loudness_low_freq")), "Enable loudness to adjust.");
});

test("test_a_desc_carrying_field_hovers_its_overall_tooltip", async () => {
  await reset({ fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "sinc-M" }] }] });
  assert.equal(titleOf(field("pcm_filter_1x")), "Filter prose.");
});

// ============================================================================
// inline notes
// ============================================================================

test("test_a_plain_field_renders_its_tooltip_as_an_inline_note", async () => {
  await reset();
  assert.equal(line(field("volume_max"), "field-note"), "Max prose.");
});

test("test_hiding_descriptions_removes_the_inline_note", async () => {
  await reset({ desc: false, keep: false });
  assert.equal(line(field("volume_max"), "field-note"), null);
});

test("test_a_hover_note_field_renders_no_inline_note", async () => {
  await reset();
  assert.equal(line(field("output_mode"), "field-note"), null);
});

test("test_a_desc_carrying_field_renders_no_inline_note", async () => {
  await reset({ fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "sinc-M" }] }] });
  assert.equal(line(field("pcm_filter_1x"), "field-note"), null);
});

test("test_a_shared_settings_entry_is_reached_by_the_schemas_note_key", async () => {
  await reset();
  assert.equal(line(field("alsa_period"), "field-note"), "Buffer prose.");
});

// ============================================================================
// per-selection description (selectionDescription, via .field-desc)
// ============================================================================

test("test_a_config_desc_field_describes_the_selected_value", async () => {
  await reset({ fields: [{ name: "integrator", value: "1", options: [{ value: "1", label: "Slow" }] }] });
  assert.equal(line(field("sdm_integrator"), "field-desc"), "Slow integrator.");
});

test("test_a_config_desc_field_with_an_unmapped_value_describes_nothing", async () => {
  await reset({ fields: [{ name: "integrator", value: "7", options: [{ value: "7", label: "Odd" }] }] });
  assert.equal(line(field("sdm_integrator"), "field-desc"), "");
});

test("test_a_filter_desc_field_describes_the_selected_filter_by_name", async () => {
  await reset({ fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "sinc-M" }] }] });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), "A very long sinc.");
});

test("test_a_filter_description_resolves_through_an_alias", async () => {
  await reset({ fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "poly-sinc-xtr-mp" }] }] });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), "Extra transient.");
});

test("test_a_two_stage_filter_appends_the_two_stage_note", async () => {
  await reset({ fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "sinc-M-2s" }] }] });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), "A very long sinc. Two stage oversampling.");
});

test("test_an_unknown_filter_name_describes_nothing", async () => {
  await reset({ fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "made-up" }] }] });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), "");
});

test("test_a_filter_desc_field_with_no_metadata_describes_nothing", async () => {
  await reset({ fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "sinc-M" }] }], meta: {} });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), "");
});

test("test_a_value_matching_no_option_describes_nothing", async () => {
  await reset({ fields: [{ name: "filter1x", value: "9", options: [{ value: "0", label: "sinc-M" }] }] });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), "");
});

test("test_a_modulator_desc_field_describes_the_selected_modulator", async () => {
  await reset({ fields: [{ name: "modulator", value: "0", options: [{ value: "0", label: "ASDM7" }] }] });
  assert.equal(line(field("sdm_modulator"), "field-desc"), "Seventh order modulator.");
});

test("test_a_dither_desc_field_describes_the_selected_dither", async () => {
  await reset({ fields: [{ name: "dither", value: "0", options: [{ value: "0", label: "TPDF" }] }] });
  assert.equal(line(field("pcm_dither"), "field-desc"), "Triangular dither.");
});

test("test_hiding_every_description_removes_the_desc_line", async () => {
  await reset({
    fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "sinc-M" }] }],
    desc: false,
    keep: false,
  });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), null);
});

test("test_kept_option_descriptions_survive_the_master_toggle_being_off", async () => {
  await reset({
    fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label: "sinc-M" }] }],
    desc: false,
    keep: true,
  });
  assert.equal(line(field("pcm_filter_1x"), "field-desc"), "A very long sinc.");
});
