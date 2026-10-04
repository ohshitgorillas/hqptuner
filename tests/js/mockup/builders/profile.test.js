// Behavioral suite for mockup/scripts/model/profile.js: the decisions the Profile builder makes, each a value in and a
// value out. Which steps a profile skips, the crossfeed preset and settings path its values land on, whether an edit
// reads dirty, what the rail and the overview read for each part, when a step is laid out again, and what the
// picker, the name box and Delete show.
//
// Records, presets, defaults and step tables are tables this file writes; no shipped data supplies an input or an
// expected value.
//
// Run: node --test tests/js/mockup/profile.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT,
  stepContext,
  skipOf,
  crossfeedPreset,
  atDefaults,
  knownOf,
  isDirty,
  summaryOf,
  holdSkipped,
  shapeOf,
  needsLayout,
  paintView,
  pickerOf,
  renderView,
} from "../../../../mockup/scripts/model/builders/profile.js";
import { NEW, keyOf } from "../../../../mockup/scripts/model/builders/builder.js";

/** @typedef {import("../../../../mockup/scripts/model/builders/profile.js").Vals} Vals */
/** @typedef {import("../../../../mockup/scripts/model/builders/profile.js").Meta} Meta */
/** @typedef {import("../../../../mockup/scripts/model/builders/profile.js").Known} Known */
/** @typedef {import("../../../../mockup/scripts/model/builders/profile.js").StepContext} StepContext */

//: Steps whose skip rules echo what they read, so a test sees the context a step is handed.
const STEPS = [
  { id: "plain" },
  { id: "listen", skip: (/** @type {StepContext} */ x) => x.listen },
  { id: "fixed", skip: (/** @type {StepContext} */ x) => (x.fixed ? "fixed" : "") },
  { id: "models", skip: (/** @type {StepContext} */ x) => String(x.models) },
];

//: DAC models: the no-model entry, then two models.
const MODELS = [{ v: "" }, { v: "m1" }, { v: "m2" }];

//: Bauer presets with fixed values, and Structural presets by speaker angle and center character.
const PRESETS = {
  bauer: [
    { v: "b1", label: "Bee one" },
    { v: "b2", label: "Bee two" },
  ],
  structural: [
    { v: "s1", label: "Ess one", angle: 30, lambda: 0.7 },
    { v: "s2", label: "Ess two", angle: 45, lambda: 0.5 },
  ],
};

//: Loudness defaults.
const LD = { ldrlow: -60, ldrhigh: -20, ldlowlevel: 20 };

/**
 * A profile's values: crossfeed off, correction and loudness bypassed at the defaults, `over` written on top. Numbers
 * arrive as strings, as the family's values do.
 *
 * @param {Vals} [over]
 * @returns {Vals}
 */
const vals = (over = {}) => ({
  xfmode: "off",
  xfpreset: "b1",
  xsangle: "30",
  xslambda: "0.7",
  dcen: "0",
  dcdac: "",
  ldon: "0",
  ldrlow: "-60",
  ldrhigh: "-20",
  ldlowlevel: "20",
  ...over,
});

/**
 * An edit's meta: a speakers profile in one station, `over` written on top.
 *
 * @param {Partial<Meta>} [over]
 * @returns {Meta}
 */
const meta = (over = {}) => ({ name: "Rock", stations: ["den"], desc: "loud", listen: "speakers", ...over });

//: The saved record an edit compares against: two stations.
const SAVED = { vals: vals(), meta: meta({ stations: ["den", "loft"] }) };

//: The settings path both steps open on with presets.
const PRESET = /** @type {Known} */ ({ crossfeed: "preset", loudness: "preset" });

/**
 * The shape of the Crossfeed step for the default profile, `o` written over its parts.
 *
 * @param {{ at?: string, meta?: Meta, vals?: Vals, known?: Known, skip?: string }} o
 * @returns {string}
 */
const shape = (o) => shapeOf({ at: "crossfeed", meta: meta(), vals: vals(), known: PRESET, skip: "", ...o });

//: A record book: two stations, the first holding two profiles.
const BOOK = { den: { Rock: {}, Jazz: {} }, loft: { [DEFAULT]: {} } };
//: The profiles in BOOK that read dirty.
const DIRTY = new Set(["den Jazz"]);

/** @param {{ st: string, name: string }} r */
const dirtyIn = (r) => DIRTY.has(`${r.st} ${r.name}`);

// ── stepContext / skipOf ─────────────────────────────────────────────────

test("test_step_context_counts_the_models_carrying_a_value", () => {
  assert.equal(stepContext("speakers", false, MODELS).models, 2);
});

test("test_skip_reads_the_listening_answer", () => {
  assert.equal(skipOf(STEPS, "listen", stepContext("headphones", false, MODELS)), "headphones");
});

test("test_skip_reads_a_fixed_volume", () => {
  assert.equal(skipOf(STEPS, "fixed", stepContext("speakers", true, MODELS)), "fixed");
});

test("test_skip_reads_the_model_count", () => {
  assert.equal(skipOf(STEPS, "models", stepContext("speakers", false, [{ v: "" }])), "0");
});

test("test_step_without_a_skip_rule_applies", () => {
  assert.equal(skipOf(STEPS, "plain", stepContext("headphones", true, MODELS)), "");
});

test("test_unknown_step_applies", () => {
  assert.equal(skipOf(STEPS, "nowhere", stepContext("headphones", true, MODELS)), "");
});

// ── crossfeedPreset ──────────────────────────────────────────────────────

test("test_bauer_values_land_on_the_named_preset", () => {
  assert.equal(crossfeedPreset(vals({ xfmode: "bauer", xfpreset: "b2" }), PRESETS)?.label, "Bee two");
});

test("test_bauer_values_naming_no_fixed_preset_land_on_none", () => {
  assert.equal(crossfeedPreset(vals({ xfmode: "bauer", xfpreset: "custom" }), PRESETS), undefined);
});

test("test_structural_values_land_on_the_preset_at_their_angle_and_center", () => {
  assert.equal(
    crossfeedPreset(vals({ xfmode: "structural", xsangle: "45", xslambda: "0.5" }), PRESETS)?.label,
    "Ess two",
  );
});

test("test_structural_values_between_presets_land_on_none", () => {
  assert.equal(crossfeedPreset(vals({ xfmode: "structural", xsangle: "40", xslambda: "0.5" }), PRESETS), undefined);
});

test("test_another_mode_reads_as_a_preset_without_a_label", () => {
  assert.equal(crossfeedPreset(vals({ xfmode: "off" }), PRESETS)?.label, "");
});

// ── atDefaults / knownOf ─────────────────────────────────────────────────

test("test_values_matching_the_defaults_as_strings_are_at_defaults", () => {
  assert.equal(atDefaults(vals(), LD), true);
});

test("test_one_value_off_its_default_is_not_at_defaults", () => {
  assert.equal(atDefaults(vals({ ldrhigh: "-30" }), LD), false);
});

test("test_crossfeed_off_opens_on_a_preset", () => {
  assert.equal(knownOf(vals(), PRESETS, LD).crossfeed, "preset");
});

test("test_crossfeed_on_a_preset_opens_on_a_preset", () => {
  assert.equal(knownOf(vals({ xfmode: "structural" }), PRESETS, LD).crossfeed, "preset");
});

test("test_crossfeed_off_every_preset_opens_on_the_values", () => {
  assert.equal(knownOf(vals({ xfmode: "bauer", xfpreset: "custom" }), PRESETS, LD).crossfeed, "values");
});

test("test_loudness_at_the_defaults_opens_on_the_defaults", () => {
  assert.equal(knownOf(vals(), PRESETS, LD).loudness, "preset");
});

test("test_loudness_off_the_defaults_opens_on_the_values", () => {
  assert.equal(knownOf(vals({ ldlowlevel: "12" }), PRESETS, LD).loudness, "values");
});

// ── isDirty ──────────────────────────────────────────────────────────────

test("test_edit_matching_the_saved_record_is_clean", () => {
  assert.equal(isDirty(vals(), meta({ stations: ["den", "loft"] }), SAVED), false);
});

test("test_changed_value_is_dirty", () => {
  assert.equal(isDirty(vals({ dcen: "1" }), meta({ stations: ["den", "loft"] }), SAVED), true);
});

test("test_same_value_as_a_number_is_clean", () => {
  assert.equal(isDirty(vals({ ldrlow: -60 }), meta({ stations: ["den", "loft"] }), SAVED), false);
});

test("test_saved_value_the_edit_lacks_is_ignored", () => {
  const { dcdac: _gone, ...rest } = vals({ dcdac: "m9" });
  assert.equal(isDirty(rest, meta({ stations: ["den", "loft"] }), { ...SAVED, vals: vals({ dcdac: "m1" }) }), false);
});

test("test_changed_description_is_dirty", () => {
  assert.equal(isDirty(vals(), meta({ stations: ["den", "loft"], desc: "soft" }), SAVED), true);
});

test("test_changed_name_is_dirty", () => {
  assert.equal(isDirty(vals(), meta({ stations: ["den", "loft"], name: "Pop" }), SAVED), true);
});

test("test_changed_listening_is_dirty", () => {
  assert.equal(isDirty(vals(), meta({ stations: ["den", "loft"], listen: "headphones" }), SAVED), true);
});

test("test_same_stations_in_another_order_are_clean", () => {
  assert.equal(isDirty(vals(), meta({ stations: ["loft", "den"] }), SAVED), false);
});

test("test_changed_stations_are_dirty", () => {
  assert.equal(isDirty(vals(), meta({ stations: ["den"] }), SAVED), true);
});

// ── summaryOf ────────────────────────────────────────────────────────────

/**
 * The summary of `v` at level `level` (dBFS), the volume not fixed unless `fixed`.
 *
 * @param {Vals} v
 * @param {number} [level]
 * @param {boolean} [fixed]
 */
const summary = (v, level = -40, fixed = false) =>
  summaryOf(meta({ listen: "headphones" }), v, PRESETS, { level, fixed });

test("test_summary_listening_is_the_answer", () => {
  assert.equal(summary(vals()).listen, "headphones");
});

test("test_summary_crossfeed_is_on_when_engaged", () => {
  assert.equal(summary(vals({ xfmode: "bauer" })).crossfeed.on, true);
});

test("test_summary_crossfeed_is_off_when_off", () => {
  assert.equal(summary(vals()).crossfeed.on, false);
});

test("test_summary_crossfeed_mode_is_the_value", () => {
  assert.equal(summary(vals({ xfmode: "structural" })).crossfeed.mode, "structural");
});

test("test_summary_crossfeed_preset_is_the_one_the_values_land_on", () => {
  assert.equal(summary(vals({ xfmode: "bauer", xfpreset: "b2" })).crossfeed.preset, "Bee two");
});

test("test_summary_crossfeed_preset_is_none_off_every_preset", () => {
  assert.equal(summary(vals({ xfmode: "structural", xsangle: "12" })).crossfeed.preset, null);
});

test("test_summary_correction_is_on_when_engaged", () => {
  assert.equal(summary(vals({ dcen: "1" })).correction.on, true);
});

test("test_summary_correction_is_off_when_bypassed", () => {
  assert.equal(summary(vals({ dcen: "0" })).correction.on, false);
});

test("test_summary_correction_model_is_the_value", () => {
  assert.equal(summary(vals({ dcdac: "m2" })).correction.model, "m2");
});

test("test_summary_loudness_is_on_when_engaged", () => {
  assert.equal(summary(vals({ ldon: "1" })).loudness.on, true);
});

test("test_summary_loudness_applies_half_midway_through_its_range", () => {
  assert.equal(summary(vals({ ldon: "1" }), -40).loudness.percent, 50);
});

test("test_summary_loudness_applies_in_full_below_its_range", () => {
  assert.equal(summary(vals({ ldon: "1" }), -75).loudness.percent, 100);
});

test("test_summary_loudness_applies_none_at_a_fixed_volume", () => {
  assert.equal(summary(vals({ ldon: "1" }), -75, true).loudness.percent, 0);
});

// ── holdSkipped ──────────────────────────────────────────────────────────

test("test_skipped_step_reads_skipped", () => {
  assert.equal(holdSkipped("correction", "no models", vals()), true);
});

test("test_applied_step_does_not_read_skipped", () => {
  assert.equal(holdSkipped("correction", "", vals()), false);
});

test("test_skipped_crossfeed_still_engaged_does_not_read_skipped", () => {
  assert.equal(holdSkipped("crossfeed", "speakers", vals({ xfmode: "bauer" })), false);
});

test("test_skipped_crossfeed_turned_off_reads_skipped", () => {
  assert.equal(holdSkipped("crossfeed", "speakers", vals()), true);
});

// ── shapeOf / needsLayout ────────────────────────────────────────────────

test("test_shape_moves_with_the_page", () => {
  assert.notEqual(shape({ at: "loudness" }), shape({}));
});

test("test_shape_moves_with_the_listening_answer", () => {
  assert.notEqual(shape({ meta: meta({ listen: "headphones" }) }), shape({}));
});

test("test_shape_moves_with_the_crossfeed_mode", () => {
  assert.notEqual(shape({ vals: vals({ xfmode: "bauer" }) }), shape({}));
});

test("test_shape_moves_with_the_crossfeed_path", () => {
  assert.notEqual(shape({ known: { crossfeed: "values", loudness: "preset" } }), shape({}));
});

test("test_shape_moves_with_loudness_engaged", () => {
  assert.notEqual(shape({ vals: vals({ ldon: "1" }) }), shape({}));
});

test("test_shape_moves_with_the_loudness_path", () => {
  assert.notEqual(shape({ known: { crossfeed: "preset", loudness: "values" } }), shape({}));
});

test("test_shape_moves_with_the_skip", () => {
  assert.notEqual(shape({ skip: "speakers" }), shape({}));
});

test("test_shape_holds_through_a_value_change", () => {
  assert.equal(shape({ vals: vals({ dcen: "1", xsangle: "45" }) }), shape({}));
});

test("test_step_whose_shape_moved_is_laid_out_again", () => {
  assert.equal(needsLayout("crossfeed", "a", "b"), true);
});

test("test_step_whose_shape_held_is_not_laid_out_again", () => {
  assert.equal(needsLayout("crossfeed", "a", "a"), false);
});

test("test_overview_is_never_laid_out_again", () => {
  assert.equal(needsLayout("overview", "a", "b"), false);
});

test("test_advanced_settings_are_never_laid_out_again", () => {
  assert.equal(needsLayout("advanced", "a", "b"), false);
});

// ── paintView ────────────────────────────────────────────────────────────

test("test_structural_control_shows_the_preset_the_values_land_on", () => {
  assert.equal(paintView(vals({ xsangle: "45", xslambda: "0.5" }), PRESETS.structural).structural, "s2");
});

test("test_structural_control_shows_none_off_every_preset", () => {
  assert.equal(paintView(vals({ xsangle: "45", xslambda: "0.7" }), PRESETS.structural).structural, "");
});

test("test_dac_model_is_live_with_correction_engaged", () => {
  assert.equal(paintView(vals({ dcen: "1" }), PRESETS.structural).dacModel, true);
});

test("test_dac_model_is_not_live_with_correction_bypassed", () => {
  assert.equal(paintView(vals({ dcen: "0" }), PRESETS.structural).dacModel, false);
});

// ── pickerOf ─────────────────────────────────────────────────────────────

test("test_picker_groups_follow_the_station_order", () => {
  assert.deepEqual(
    pickerOf(["loft", "den"], BOOK, dirtyIn).map((g) => g.st),
    ["loft", "den"],
  );
});

test("test_picker_options_follow_the_book_order", () => {
  assert.deepEqual(
    pickerOf(["den"], BOOK, dirtyIn)[0].options.map((x) => x.name),
    ["Rock", "Jazz"],
  );
});

test("test_picker_option_is_keyed_as_its_staged_edit", () => {
  assert.equal(pickerOf(["den"], BOOK, dirtyIn)[0].options[1].key, keyOf({ st: "den", name: "Jazz" }));
});

test("test_picker_option_reads_dirty_where_its_edit_is", () => {
  assert.deepEqual(
    pickerOf(["den"], BOOK, dirtyIn)[0].options.map((x) => x.dirty),
    [false, true],
  );
});

// ── renderView ───────────────────────────────────────────────────────────

test("test_default_profile_name_is_fixed", () => {
  assert.equal(renderView({ st: "loft", name: DEFAULT }, false, false).fixedName, true);
});

test("test_named_profile_name_is_editable", () => {
  assert.equal(renderView({ st: "den", name: "Rock" }, false, false).fixedName, false);
});

test("test_default_profile_cannot_be_deleted", () => {
  assert.equal(renderView({ st: "loft", name: DEFAULT }, false, false).deletable, false);
});

test("test_new_profile_cannot_be_deleted", () => {
  assert.equal(renderView({ st: "den", name: NEW }, false, false).deletable, false);
});

test("test_named_profile_can_be_deleted", () => {
  assert.equal(renderView({ st: "den", name: "Rock" }, false, false).deletable, true);
});

test("test_staged_new_profile_reads_dirty", () => {
  assert.equal(renderView({ st: "den", name: "Rock" }, true, false).newDirty, true);
});

test("test_edited_new_profile_showing_reads_dirty", () => {
  assert.equal(renderView({ st: "den", name: NEW }, false, true).newDirty, true);
});

test("test_new_profile_reads_clean_while_another_is_edited", () => {
  assert.equal(renderView({ st: "den", name: "Rock" }, false, true).newDirty, false);
});
