// Behavioral suite for components/Field.js — the schema<->store binder.
// Written BEFORE the complexity refactor of Field (30) and selectionDescription (27).
//
// Field's whole job is to turn ONE schema key into a bound control, so the
// contract under test is: which widget, fed from which option source, disabled
// for which reason, captioned how, and hovered with what. All of it observable.
//
// The prose half of that contract — hover titles, inline notes and the
// per-selection description — lives in fielddesc.test.js (split for the
// file-length gate). The shared fixture, wire fake and HTML-extraction helpers
// both suites run on live in field-harness.js.

import test from "node:test";
import assert from "node:assert/strict";

import { enums } from "../../../hqptuner/static/store/signals.js";
import { nPhase, nApod1x } from "../../../hqptuner/static/store/narrowing.js";
import {
  reset,
  stageEdit,
  field,
  hasClass,
  line,
  span,
  controlRow,
  outsideControlRow,
  grayReason,
  attrOf,
  optionLabels,
  optionByLabel,
  activeSegment,
  isDisabled,
} from "../support/field-harness.js";

// The option a label names, and the control row of a rendered field. A field
// missing either is a broken fixture rather than a case with nothing to say, so
// both raise here instead of reaching an assertion as an absence.
/**
 * @param {string} out
 * @param {string} label
 */
const option = (out, label) => {
  const found = optionByLabel(out, label);
  if (found === undefined) throw new Error(`no option labelled "${label}" in the rendered field`);
  return found;
};

/** @param {string} out */
const row = (out) => {
  const found = controlRow(out);
  if (found === null) throw new Error("the rendered field encloses no control row");
  return found;
};

// ============================================================================
// binding basics
// ============================================================================

test("test_an_unknown_control_key_renders_nothing", async () => {
  await reset();
  assert.equal(field("no_such_control"), "");
});

test("test_the_widget_kind_is_named_in_the_field_class", async () => {
  await reset();
  assert.ok(hasClass(field("volume_max"), "field-number"));
});

test("test_the_schema_label_is_rendered", async () => {
  await reset();
  assert.ok(field("volume_max").includes("<label>Max volume"));
});

test("test_a_sublabel_renders_beside_the_label", async () => {
  await reset();
  assert.equal(span(field("optimal_iso"), "label-alt"), "(Optimal ISO)");
});

test("test_a_field_without_a_sublabel_renders_no_label_alt", async () => {
  await reset();
  assert.equal(span(field("volume_max"), "label-alt"), null);
});

test("test_the_dac_correction_profile_is_labelled_dac_model", async () => {
  await reset();
  assert.ok(field("dac_correction_profile").includes("<label>DAC model</label>"));
});

// ============================================================================
// class assembly
// ============================================================================

test("test_a_wide_field_carries_the_wide_class", async () => {
  await reset();
  assert.ok(hasClass(field("log_file"), "wide"));
});

test("test_a_full_span_field_carries_the_span_class", async () => {
  await reset();
  assert.ok(hasClass(field("log_file"), "span"));
});

test("test_a_half_track_field_is_neither_wide_nor_spanning", async () => {
  await reset();
  assert.equal(hasClass(field("volume_max"), "wide"), false);
});

test("test_a_staged_edit_marks_the_field_dirty", async () => {
  await reset({ fields: [{ name: "volume_max", value: "-3" }] });
  await stageEdit("volume_max", "-6", { volume_max: "-6" });
  assert.ok(hasClass(field("volume_max"), "dirty"));
});

test("test_a_staged_value_equal_to_the_baseline_is_not_dirty", async () => {
  await reset({ fields: [{ name: "volume_max", value: "-3" }] });
  await stageEdit("volume_max", "-3", { volume_max: "-3" });
  assert.equal(hasClass(field("volume_max"), "dirty"), false);
});

test("test_an_untouched_field_is_not_dirty", async () => {
  await reset({ fields: [{ name: "volume_max", value: "-3" }] });
  assert.equal(hasClass(field("volume_max"), "dirty"), false);
});

// ============================================================================
// value binding — the effective value reaches the primitive
// ============================================================================

test("test_the_effective_value_selects_the_active_segment", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(activeSegment(field("output_mode")), "SDM (DSD)");
});

test("test_the_effective_value_checks_a_checkbox", async () => {
  await reset({ fields: [{ name: "upnp_freewheel", value: true }] });
  assert.ok(/<input type="checkbox" checked/.test(field("upnp_freewheel")));
});

test("test_the_effective_value_positions_a_knob", async () => {
  await reset({ matrix: [{ name: "post_bauer_frequency", value: "600", min: "300", max: "2000" }] });
  assert.equal(attrOf(field("crossfeed_frequency"), "aria-valuenow"), "600");
});

test("test_a_staged_edit_outranks_the_form_baseline", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  await stageEdit("output_mode", "sdm", { mode: "sdm" });
  assert.equal(activeSegment(field("output_mode")), "SDM (DSD)");
});

// ============================================================================
// constraints — the daemon's own form is the authority for bounds
// ============================================================================

test("test_an_http_number_takes_its_minimum_from_the_daemon_form", async () => {
  await reset({ matrix: [{ name: "post_loudness_rangelow", value: "-60", min: "-90", max: "0" }] });
  assert.equal(attrOf(field("loudness_range_low"), "min"), "-90");
});

test("test_an_http_number_takes_its_maximum_from_the_daemon_form", async () => {
  await reset({ matrix: [{ name: "post_loudness_rangelow", value: "-60", min: "-90", max: "0" }] });
  assert.equal(attrOf(field("loudness_range_low"), "max"), "0");
});

test("test_a_schema_fallback_bound_is_used_when_the_form_carries_none", async () => {
  await reset({ matrix: [{ name: "post_loudness_lowsteep", value: "1" }] });
  assert.equal(attrOf(field("loudness_low_steep"), "aria-valuemin"), "0.1");
});

test("test_the_form_bound_wins_over_the_schema_fallback", async () => {
  await reset({ matrix: [{ name: "post_loudness_lowsteep", value: "1", min: "2" }] });
  assert.equal(attrOf(field("loudness_low_steep"), "aria-valuemin"), "2");
});

test("test_a_schema_fallback_step_is_used_when_the_form_carries_none", async () => {
  // the knob's readout renders with the step's decimals — 0.1 makes "1.0"
  await reset({ matrix: [{ name: "post_loudness_lowsteep", value: "1" }] });
  assert.equal(attrOf(field("loudness_low_steep"), "aria-valuetext"), "1.0");
});

// ============================================================================
// option source
// ============================================================================

test("test_a_schema_option_list_renders_as_given", async () => {
  await reset();
  const out = field("output_mode");
  assert.deepEqual(
    [...out.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].trim()),
    ["PCM", "SDM (DSD)", "Auto"],
  );
});

test("test_a_config_sourced_dropdown_offers_the_form_fields_options", async () => {
  const options = [
    { value: "0", label: "Never" },
    { value: "60", label: "1 min" },
  ];
  await reset({ fields: [{ name: "idle_time", value: "0", options }] });
  assert.deepEqual(optionLabels(field("idle_time")), ["Never", "1 min"]);
});

test("test_a_matrix_sourced_dropdown_offers_the_matrix_forms_options", async () => {
  const options = [
    { value: "0", label: "IIR" },
    { value: "1", label: "FIR" },
  ];
  await reset({ matrix: [{ name: "engine", value: "0", options }] });
  assert.deepEqual(optionLabels(field("matrix_engine")), ["IIR", "FIR"]);
});

// Every filter the engine enumerates carries a quality rating at the head of
// its description (protocol.md:228), and the quality facet's 3/5 default hides
// anything rated below it — including an item that carries no rating at all.
// These two cases are about the PHASE facet, so each item gets a rating that
// clears the floor and leaves phase the only thing dropping anything.
/** @param {string} name */
const PASSES_QUALITY = (name) => ({ name, description: "4/5 ⥮ Any" });

test("test_narrowing_drops_an_option_the_active_facets_exclude", async () => {
  await reset({
    fields: [
      {
        name: "filter1x",
        value: "0",
        options: [
          { value: "0", label: "poly-sinc-mp" },
          { value: "1", label: "sinc-Lm" },
        ],
      },
    ],
  });
  enums.value = { filters: [PASSES_QUALITY("poly-sinc-mp"), PASSES_QUALITY("sinc-Lm")] };
  nApod1x.value = "all";
  nPhase.value = "minimum";
  assert.deepEqual(optionLabels(field("pcm_filter_1x")), ["poly-sinc-mp"]);
});

// The current selection is judged on the facets like any other option: the
// field's value points at sinc-Lm, which is not minimum phase, so the engaged
// phase facet drops it from the list the dropdown offers.
test("test_narrowing_hides_the_selected_option_when_it_fails_the_facets", async () => {
  await reset({
    fields: [
      {
        name: "filter1x",
        value: "1",
        options: [
          { value: "0", label: "poly-sinc-mp" },
          { value: "1", label: "sinc-Lm" },
        ],
      },
    ],
  });
  enums.value = { filters: [PASSES_QUALITY("poly-sinc-mp"), PASSES_QUALITY("sinc-Lm")] };
  nApod1x.value = "all";
  nPhase.value = "minimum";
  assert.equal(optionLabels(field("pcm_filter_1x")).includes("sinc-Lm"), false);
});

// A modulator below its floor stops the engine producing output at all, so its
// option row is grayed. The SDM rate limit is `defaults_bitrate`; DSD512 leaves
// ASDM7EC below its 40.96 MHz floor. (A PCM DITHER below its floor still plays,
// so no rate grays a dither row at all; that advice is reported as an alert
// instead — tests/js/components/shaperfit-fields.test.js.)
const BELOW_MODULATOR_FLOOR = [
  { name: "defaults_bitrate", value: "24576000" },
  {
    name: "modulator",
    value: "0",
    options: [
      { value: "0", label: "ASDM7" },
      { value: "1", label: "ASDM7EC" },
    ],
  },
];

test("test_a_modulator_below_the_rate_floor_is_offered_disabled", async () => {
  await reset({ fields: BELOW_MODULATOR_FLOOR });
  assert.ok(/\bdisabled\b/.test(option(field("sdm_modulator"), "ASDM7EC").a));
});

test("test_a_rate_grayed_modulator_names_the_rate_it_needs", async () => {
  await reset({ fields: BELOW_MODULATOR_FLOOR });
  assert.equal(option(field("sdm_modulator"), "ASDM7EC").label, "ASDM7EC — needs ≥ 40.96 MHz");
});

test("test_a_modulator_the_rate_can_reach_stays_selectable", async () => {
  // The discriminating half: the SAME modulator one tier up from its floor. A
  // gray that fired on every modulator row, or on the rate rather than the
  // comparison, passes the two cases above and fails here.
  await reset({
    fields: [
      { name: "defaults_bitrate", value: "49152000" },
      {
        name: "modulator",
        value: "0",
        options: [
          { value: "0", label: "ASDM7" },
          { value: "1", label: "ASDM7EC" },
        ],
      },
    ],
  });
  assert.equal(/\bdisabled\b/.test(option(field("sdm_modulator"), "ASDM7EC").a), false);
});

// ============================================================================
// graying
// ============================================================================

test("test_a_gray_reason_disables_the_control", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: true }] });
  assert.ok(isDisabled(field("volume_max")));
});

test("test_a_field_with_no_gray_reason_is_enabled", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: false }] });
  assert.equal(isDisabled(field("volume_max")), false);
});

test("test_a_gray_reason_is_shown_as_a_visible_caption", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: true }] });
  assert.equal(
    line(field("volume_max"), "field-gray-reason"),
    "Direct SDM bypasses the volume control and sets PCM volume to a fixed -3 dBFS value.",
  );
});

test("test_an_enabled_field_shows_no_gray_caption", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: false }] });
  assert.equal(line(field("volume_max"), "field-gray-reason"), null);
});

test("test_a_quiet_gray_field_shows_no_caption", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(line(field("pcm_rate"), "field-gray-reason"), null);
});

test("test_a_quiet_gray_field_is_still_disabled", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.ok(isDisabled(field("pcm_rate")));
});

// ============================================================================
// graying — inline placement
//
// Some keys carry their gray reason INSIDE the control row rather than as the
// stacked caption below it. The observable contract is placement plus text: the
// reason element sits within <div class="control">…</div> and carries the
// field-gray-reason class, whatever tag it is written with.
//
// Subject choice is deliberate, not incidental. Since the Output tab's four
// per-backend settings became advisories (field-advice.test.js), inline graying
// survives on exactly two keys — adaptive_volume and loudness_enabled — and both
// are Volume-tab keys. There is no output-tab or network-lane inline-gray field
// left to point a case at, so adaptive_volume stands in for the placement
// contract that alsa_bits and net_bits used to carry.
// ============================================================================

test("test_inline_gray_adaptive_volume_names_the_direct_sdm_bypass_inside_the_control_row", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: true }] });
  assert.equal(
    grayReason(row(field("adaptive_volume"))),
    "Direct SDM bypasses the volume control and sets PCM volume to a fixed -3 dBFS value.",
  );
});

test("test_inline_gray_loudness_explains_why_adaptive_loudness_cannot_adapt", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: true }] });
  assert.equal(
    grayReason(row(field("loudness_enabled"))),
    "Direct SDM bypasses the volume control and sets PCM volume to a fixed -3 dBFS value." +
      " Volume-adaptive loudness cannot adapt — use a Matrix EQ" +
      " for a volume-agnostic equivalent.",
  );
});

test("test_an_inline_gray_field_renders_no_stacked_gray_caption", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: true }] });
  assert.equal(grayReason(outsideControlRow(field("adaptive_volume"))), null);
});

test("test_ungrayed_adaptive_volume_renders_no_reason_at_all", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: false }] });
  assert.equal(grayReason(field("adaptive_volume")), null);
});

test("test_ungrayed_loudness_renders_no_reason_at_all", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: false }] });
  assert.equal(grayReason(field("loudness_enabled")), null);
});

test("test_an_inline_gray_field_is_still_disabled_when_grayed", async () => {
  await reset({ fields: [{ name: "direct_sdm", value: true }] });
  assert.ok(isDisabled(field("adaptive_volume")));
});

// ============================================================================
// unit, hint, rescan
// ============================================================================

test("test_a_unit_renders_beside_the_control", async () => {
  await reset();
  assert.equal(span(field("alsa_period"), "unit"), "ms");
});

test("test_a_knob_carries_its_own_unit_rather_than_a_sibling_span", async () => {
  await reset({ matrix: [{ name: "post_bauer_frequency", value: "600" }] });
  assert.equal(span(field("crossfeed_frequency"), "unit"), null);
});

test("test_a_hint_renders_beside_the_control", async () => {
  await reset();
  assert.equal(span(field("alsa_period"), "field-hint"), "−1 = minimum, 0 = default");
});

test("test_a_rescan_field_offers_a_rescan_button", async () => {
  await reset();
  assert.ok(field("alsa_device").includes('class="rescan-btn"'));
});

test("test_a_plain_field_offers_no_rescan_button", async () => {
  await reset();
  assert.equal(field("volume_max").includes("rescan-btn"), false);
});
