// Behavioral suite for components/Field.js — the schema<->store binder.
// Written BEFORE the complexity refactor of Field (30) and selectionDescription (27).
//
// Rendered through preact-render-to-string against the VENDORED preact bundle
// (tests/js/vendor-resolve.js maps the importmap specifiers), so this exercises
// the code that ships rather than an npm substitute.
//
// `selectionDescription` is private and stays that way: it is a pure function of
// the schema entry, the effective value, the option list and the settings.json
// entry — all four of which the rendered `.field-desc` line exposes. Every
// assertion below is on rendered output (classes, attributes, option text, the
// three prose lines), never on a helper.
//
// Field's whole job is to turn ONE schema key into a bound control, so the
// contract under test is: which widget, fed from which option source, disabled
// for which reason, captioned how, and hovered with what. All of it observable.
//
// State is driven through the store's exported source signals plus a faked wire
// for the staging round-trip (docs/testing.md rule 4 — no store function is ever
// stubbed). `reset()` reassigns EVERY signal Field reads on every call rather
// than only the ones a case cares about: module-level signals persist for the
// life of the process, so a partial reset makes tests pass alone and fail in
// sequence. `staged` is not exported, so it is cleared via discardAll().

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { Field } from "../../hqptuner/static/components/Field.js";
import {
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
  discardAll,
  edit,
} from "../../hqptuner/static/store/state.js";
import { showDescriptions, keepOptionDescriptions } from "../../hqptuner/static/store/prefs.js";
import { nPhase, nApod, resetNarrowing } from "../../hqptuner/static/store/narrowing.js";

// --- the wire ---------------------------------------------------------------
// Real REST paths, real response shapes (hqptuner/static/lib/api.js).

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

function wire(staged = { live: {}, http: {} }) {
  globalThis.fetch = async (path) => {
    if (path === "/api/config/stage" || path === "/api/config/pending") return ok(staged);
    return ok({});
  };
}

// --- static metadata --------------------------------------------------------
// The /api/metadata payload shape: settings.json prose keyed by group, plus the
// filters.json / shapers.json name-keyed overlays.

const META = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Mode prose." },
      pcm_rate: { label: "PCM", tooltip: "Rate prose." },
      buffer_time: { label: "Buffer time", tooltip: "Buffer prose." },
      output_device: { label: "Output Device", tooltip: "Device prose." },
    },
    volume: {
      volume_max: { label: "Max volume", tooltip: "Max prose." },
    },
    dsp: {
      sdm_integrator: {
        label: "Integrator",
        tooltip: "Integrator prose.",
        options: { 0: "Fast integrator.", 1: "Slow integrator." },
      },
      filter_1x: { label: "1x filter", tooltip: "Filter prose." },
      shaper: { label: "Shaper", tooltip: "Shaper prose." },
    },
  },
  filters: {
    filters: { "sinc-M": { description: "A very long sinc." }, "xtr-mp": { description: "Extra transient." } },
    aliases: { "poly-sinc-xtr-mp": "xtr-mp" },
    two_stage_note: "Two stage oversampling.",
  },
  shapers: {
    pcm_dithers: { TPDF: { description: "Triangular dither." }, NS9: { min_rate_hz: 352800 } },
    sdm_modulators: { ASDM7: { description: "Seventh order modulator." } },
  },
};

// --- reset ------------------------------------------------------------------

async function reset({ fields = [], matrix = [], meta = META, desc = true, keep = true } = {}) {
  wire();
  engineState.value = {};
  enums.value = null;
  metadata.value = meta;
  config.value = { fields, file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: matrix };
  showDescriptions.value = desc;
  keepOptionDescriptions.value = keep;
  resetNarrowing();
  await discardAll();
}

// Stage one http-lane edit against a wire that echoes it back, exactly as the
// server's pending buffer would.
async function stageEdit(key, value, http) {
  wire({ live: {}, http });
  await edit(key, value);
}

// --- rendering --------------------------------------------------------------
// SSR escapes entities; the contract is the text a user reads, not its encoding.

const field = (k) =>
  render(html`<${Field} k=${k} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const rootAttrs = (out) => out.slice(0, out.indexOf(">"));
const classOf = (out) => (/class="([^"]*)"/.exec(rootAttrs(out)) || [])[1] || "";
const titleOf = (out) => (/title="([^"]*)"/.exec(rootAttrs(out)) || [])[1];
const hasClass = (out, c) => classOf(out).split(/\s+/).includes(c);

// Text of one of the field's three prose lines (note / desc / gray reason).
function line(out, cls) {
  const m = new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`).exec(out);
  return m ? m[1] : null;
}

const span = (out, cls) => {
  const m = new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>`).exec(out);
  return m ? m[1] : null;
};

const attrOf = (fragment, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(fragment || "") || [])[1];

const opts = (out) => [...out.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((m) => ({ a: m[1], label: m[2] }));
const optionLabels = (out) => opts(out).map((o) => o.label);
const optionByLabel = (out, label) => opts(out).find((o) => o.label.startsWith(label));

const activeSegment = (out) => {
  const m = /<button[^>]*class="seg active"[^>]*>([\s\S]*?)<\/button>/.exec(out);
  return m ? m[1].trim() : null;
};

const isDisabled = (out) => /<(?:input|select)[^>]*\bdisabled\b/.test(out);

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

// ============================================================================
// class assembly
// ============================================================================

test("test_a_large_field_carries_the_field_lg_class", async () => {
  await reset();
  assert.ok(hasClass(field("optimal_iso"), "field-lg"));
});

test("test_a_normal_sized_field_is_not_marked_large", async () => {
  await reset();
  assert.equal(hasClass(field("volume_max"), "field-lg"), false);
});

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
  await reset({ matrix: [{ name: "post_loudness_lowfreq", value: "100", min: "20", max: "500" }] });
  assert.equal(attrOf(field("loudness_low_freq"), "min"), "20");
});

test("test_an_http_number_takes_its_maximum_from_the_daemon_form", async () => {
  await reset({ matrix: [{ name: "post_loudness_lowfreq", value: "100", min: "20", max: "500" }] });
  assert.equal(attrOf(field("loudness_low_freq"), "max"), "500");
});

test("test_a_schema_fallback_bound_is_used_when_the_form_carries_none", async () => {
  await reset({ matrix: [{ name: "post_loudness_lowsteep", value: "1" }] });
  assert.equal(attrOf(field("loudness_low_steep"), "min"), "0.1");
});

test("test_the_form_bound_wins_over_the_schema_fallback", async () => {
  await reset({ matrix: [{ name: "post_loudness_lowsteep", value: "1", min: "2" }] });
  assert.equal(attrOf(field("loudness_low_steep"), "min"), "2");
});

test("test_a_schema_fallback_step_is_used_when_the_form_carries_none", async () => {
  await reset({ matrix: [{ name: "post_loudness_lowsteep", value: "1" }] });
  assert.equal(attrOf(field("loudness_low_steep"), "step"), "0.1");
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
  enums.value = { filters: [{ name: "poly-sinc-mp" }, { name: "sinc-Lm" }] };
  nApod.value = false;
  nPhase.value = "minimum";
  assert.deepEqual(optionLabels(field("pcm_filter_1x")), ["poly-sinc-mp"]);
});

test("test_narrowing_never_hides_the_selected_option", async () => {
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
  enums.value = { filters: [{ name: "poly-sinc-mp" }, { name: "sinc-Lm" }] };
  nApod.value = false;
  nPhase.value = "minimum";
  assert.ok(optionLabels(field("pcm_filter_1x")).includes("sinc-Lm"));
});

test("test_a_shaper_below_the_rate_floor_is_offered_disabled", async () => {
  await reset({
    fields: [
      { name: "defaults_samplerate", value: "44100" },
      {
        name: "dither",
        value: "0",
        options: [
          { value: "0", label: "TPDF" },
          { value: "1", label: "NS9" },
        ],
      },
    ],
  });
  assert.ok(/\bdisabled\b/.test(optionByLabel(field("pcm_dither"), "NS9").a));
});

test("test_a_rate_grayed_shaper_names_the_rate_it_needs", async () => {
  await reset({
    fields: [
      { name: "defaults_samplerate", value: "44100" },
      {
        name: "dither",
        value: "0",
        options: [
          { value: "0", label: "TPDF" },
          { value: "1", label: "NS9" },
        ],
      },
    ],
  });
  assert.equal(optionByLabel(field("pcm_dither"), "NS9").label, "NS9 — needs ≥ 352.8 kHz");
});

test("test_a_shaper_the_rate_can_reach_stays_selectable", async () => {
  await reset({
    fields: [
      { name: "defaults_samplerate", value: "705600" },
      {
        name: "dither",
        value: "0",
        options: [
          { value: "0", label: "TPDF" },
          { value: "1", label: "NS9" },
        ],
      },
    ],
  });
  assert.equal(/\bdisabled\b/.test(optionByLabel(field("pcm_dither"), "NS9").a), false);
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
  assert.equal(line(field("volume_max"), "field-gray-reason"), "Direct SDM bypasses the volume control.");
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
