// Behavioral suite for optionDescription(entry, option, meta) — the per-OPTION
// prose a desc-carrying control shows for a row that is not necessarily the
// selection. Pure of everything except the /api/metadata overlay signal, which
// the field-harness reset() seeds with its worked META payload (filters with an
// alias and a two-stage note, TPDF dither, ASDM7 modulator, an sdm_integrator
// options map).
//
// Entries come from the real schema; `meta` is the control's settings.json
// prose entry out of the same META payload, exactly what describe() hands the
// control.

import test from "node:test";
import assert from "node:assert/strict";

import { optionDescription } from "../../../hqptuner/static/store/prose.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { reset, META } from "../support/field-harness.js";

const INTEGRATOR_META = META.settings.dsp.sdm_integrator;
const FILTER_META = META.settings.dsp.filter_1x;
const SHAPER_META = META.settings.dsp.shaper;

// The meta carries an options map keyed by the option's value, so the "" here
// pins the missing `desc` on the entry alone, not a missing meta.
test("test_an_entry_without_desc_describes_no_option", async () => {
  await reset();
  assert.equal(
    optionDescription(
      schema.idle_time,
      { value: "0", label: "Never" },
      { label: "Idle", tooltip: "Idle prose.", options: { 0: "Never idles." } },
    ),
    "",
  );
});

test("test_a_config_desc_option_reads_the_settings_options_map_by_form_value", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_integrator, { value: "1", label: "Slow" }, INTEGRATOR_META),
    "Slow integrator.",
  );
});

test("test_a_config_desc_option_missing_from_the_options_map_describes_nothing", async () => {
  await reset();
  assert.equal(optionDescription(schema.sdm_integrator, { value: "7", label: "Odd" }, INTEGRATOR_META), "");
});

test("test_a_filter_desc_option_joins_the_manual_description_by_label", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-M" }, FILTER_META),
    "A very long sinc.",
  );
});

test("test_a_filter_option_label_resolves_through_an_alias", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_filter_1x, { value: "0", label: "poly-sinc-xtr-mp" }, FILTER_META),
    "Extra transient.",
  );
});

test("test_a_two_stage_filter_option_appends_the_shared_note_to_the_base_description", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.pcm_filter_1x, { value: "0", label: "sinc-M-2s" }, FILTER_META),
    "A very long sinc. Two stage oversampling.",
  );
});

test("test_a_filter_label_with_no_entry_alias_or_base_describes_nothing", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_filter_1x, { value: "0", label: "made-up" }, FILTER_META), "");
});

test("test_a_two_stage_label_whose_base_has_no_entry_describes_nothing", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_filter_1x, { value: "0", label: "made-up-2s" }, FILTER_META), "");
});

test("test_a_dither_desc_option_reads_the_pcm_dithers_overlay_by_label", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_dither, { value: "0", label: "TPDF" }, SHAPER_META), "Triangular dither.");
});

test("test_a_modulator_desc_option_reads_the_sdm_modulators_overlay_by_label", async () => {
  await reset();
  assert.equal(
    optionDescription(schema.sdm_modulator, { value: "0", label: "ASDM7" }, SHAPER_META),
    "Seventh order modulator.",
  );
});

test("test_a_dither_label_the_overlay_does_not_know_describes_nothing", async () => {
  await reset();
  assert.equal(optionDescription(schema.pcm_dither, { value: "9", label: "made-up" }, SHAPER_META), "");
});

test("test_a_modulator_label_the_overlay_does_not_know_describes_nothing", async () => {
  await reset();
  assert.equal(optionDescription(schema.sdm_modulator, { value: "9", label: "made-up" }, SHAPER_META), "");
});
