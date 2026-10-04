// Behavioral suite for mockup/scripts/model/settings.js: how a settings readout prints a control's value, and which
// visual effect a live setting change causes with the values it carries.
//
// Run: node --test tests/js/mockup/settings.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { readoutOf, effectOf } from "../../../../mockup/scripts/model/settings.js";

//: Accents the test writes: a known pick carries its own swatch color and name.
const ACCENTS = [
  { v: "ember", label: "Ember", hex: "#c04020" },
  { v: "sea", label: "Sea", hex: "#2080c0" },
];

//: Stages the test writes as hideable from the chain rail.
const HIDEABLE = [{ v: "spk" }, { v: "xf" }, { v: "eqz" }];

//: Controls the test writes, one per readout form.
const SEG = { type: "seg", options: [{ v: "a", label: "Alpha" }, { v: "b", label: "Beta", unit: "kHz" }] };
const SELECT = { type: "select", options: [{ v: 1, label: "One" }, { v: 2, label: "Two" }] };
const TOGGLES = { type: "toggles", options: [{ v: "p", label: "Pea" }, { v: "q", label: "Queue" }, { v: "r", label: "Two words" }] };
const SLIDER = { type: "slider", auto: { v: 0 } };
const NUMBER = { type: "number" };
const ACCENT = { type: "accent", options: ACCENTS };
const TEXT = { type: "text" };

/**
 * The value of one accent token, or undefined when the effect is not an accent change.
 * @param {import("../../../../mockup/scripts/model/settings.js").Effect} fx
 * @param {string} name
 */
const tokenOf = (fx, name) => (fx.kind === "accent" ? fx.tokens[name] : undefined);

/**
 * Whether stage `id` is hidden, or undefined when the effect is not a hide change or does not name it.
 * @param {import("../../../../mockup/scripts/model/settings.js").Effect} fx
 * @param {string} id
 */
const hiddenOf = (fx, id) => (fx.kind === "hide" ? fx.stages.find((s) => s.id === id)?.hidden : undefined);

/** @param {import("../../../../mockup/scripts/model/settings.js").Effect} fx */
const stageCount = (fx) => (fx.kind === "hide" ? fx.stages.length : undefined);

/** @param {import("../../../../mockup/scripts/model/settings.js").Effect} fx */
const onOf = (fx) => (fx.kind === "pinallow" ? fx.on : undefined);

/** @param {import("../../../../mockup/scripts/model/settings.js").Effect} fx */
const familyOf = (fx) => (fx.kind === "font" ? fx.family : undefined);

/** @param {import("../../../../mockup/scripts/model/settings.js").Effect} fx */
const valueOf = (fx) => (fx.kind === "fill" || fx.kind === "bottom" || fx.kind === "style" ? fx.value : undefined);

// ── readoutOf ───────────────────────────────────────────────────────────────

test("test_readout_of_a_seg_prints_the_picked_option_label", () => {
  assert.equal(readoutOf(SEG, "a", ACCENTS).text, "Alpha");
});

test("test_readout_of_an_option_with_a_unit_carries_the_unit", () => {
  assert.ok(readoutOf(SEG, "b", ACCENTS).text.includes("kHz"));
});

test("test_readout_of_a_select_matches_a_numeric_option_from_its_string_form", () => {
  assert.equal(readoutOf(SELECT, "2", ACCENTS).text, "Two");
});

test("test_readout_of_an_unknown_option_prints_the_value", () => {
  assert.equal(readoutOf(SELECT, "7", ACCENTS).text, "7");
});

test("test_readout_of_toggles_names_a_picked_option", () => {
  assert.ok(readoutOf(TOGGLES, "p,q", ACCENTS).text.includes("Queue"));
});

test("test_readout_of_toggles_leaves_out_an_unpicked_option", () => {
  assert.equal(readoutOf(TOGGLES, "p,q", ACCENTS).text.includes("Two"), false);
});

// The expected text joins the two words with a no-break space (U+00A0).
test("test_readout_of_toggles_keeps_a_label_on_one_line", () => {
  assert.equal(readoutOf(TOGGLES, "r", ACCENTS).text, "Two words");
});

test("test_readout_of_toggles_with_nothing_picked_is_not_blank", () => {
  assert.notEqual(readoutOf(TOGGLES, "", ACCENTS).text, "");
});

test("test_readout_of_a_slider_at_its_automatic_value_names_it_rather_than_the_number", () => {
  assert.notEqual(readoutOf(SLIDER, "0", ACCENTS).text, "0");
});

test("test_readout_of_a_slider_off_its_automatic_value_prints_the_number", () => {
  assert.equal(readoutOf(SLIDER, "12", ACCENTS).text, "12");
});

// The expected text leads with the typographic minus (U+2212), not a hyphen.
test("test_readout_of_a_negative_number_prints_a_typographic_minus", () => {
  assert.equal(readoutOf(NUMBER, "-3", ACCENTS).text, "−3");
});

test("test_readout_of_a_known_accent_carries_its_swatch_color", () => {
  assert.equal(readoutOf(ACCENT, "sea", ACCENTS).swatch, "#2080c0");
});

test("test_readout_of_a_known_accent_prints_its_name", () => {
  assert.equal(readoutOf(ACCENT, "ember", ACCENTS).text, "Ember");
});

test("test_readout_of_an_unknown_accent_swatches_the_value_itself", () => {
  assert.equal(readoutOf(ACCENT, "#abcdef", ACCENTS).swatch, "#abcdef");
});

test("test_readout_of_a_non_accent_carries_no_swatch", () => {
  assert.equal(readoutOf(SEG, "a", ACCENTS).swatch, null);
});

test("test_readout_of_a_text_control_prints_the_value", () => {
  assert.equal(readoutOf(TEXT, "/srv/music", ACCENTS).text, "/srv/music");
});

// ── effectOf ────────────────────────────────────────────────────────────────

test("test_effect_of_allowing_pinned_rates_turns_them_on", () => {
  assert.equal(onOf(effectOf("pinallow", "1", ACCENTS, HIDEABLE)), true);
});

test("test_effect_of_disallowing_pinned_rates_turns_them_off", () => {
  assert.equal(onOf(effectOf("pinallow", "0", ACCENTS, HIDEABLE)), false);
});

test("test_effect_of_a_known_accent_sets_the_accent_to_its_color", () => {
  assert.equal(tokenOf(effectOf("vacc", "sea", ACCENTS, HIDEABLE), "--acc"), "#2080c0");
});

test("test_effect_of_an_unknown_accent_sets_the_accent_to_the_value", () => {
  assert.equal(tokenOf(effectOf("vacc", "#123456", ACCENTS, HIDEABLE), "--acc"), "#123456");
});

test("test_effect_of_an_accent_derives_its_dim_token_from_the_color", () => {
  assert.ok(tokenOf(effectOf("vacc", "ember", ACCENTS, HIDEABLE), "--acc-dim")?.includes("#c04020"));
});

test("test_effect_of_an_accent_derives_its_rim_token_from_the_color", () => {
  assert.ok(tokenOf(effectOf("vacc", "ember", ACCENTS, HIDEABLE), "--acc-rim")?.includes("#c04020"));
});

test("test_effect_of_hiding_hides_a_listed_stage", () => {
  assert.equal(hiddenOf(effectOf("vhide", "spk,eqz", ACCENTS, HIDEABLE), "eqz"), true);
});

test("test_effect_of_hiding_shows_an_unlisted_stage", () => {
  assert.equal(hiddenOf(effectOf("vhide", "spk,eqz", ACCENTS, HIDEABLE), "xf"), false);
});

test("test_effect_of_hiding_nothing_shows_every_stage", () => {
  assert.equal(hiddenOf(effectOf("vhide", "", ACCENTS, HIDEABLE), "spk"), false);
});

test("test_effect_of_hiding_answers_once_per_hideable_stage_and_ignores_unknown_ids", () => {
  assert.equal(stageCount(effectOf("vhide", "spk,nope", ACCENTS, HIDEABLE)), 3);
});

test("test_effect_of_the_dyslexic_font_on_swaps_the_body_family_from_off", () => {
  assert.notEqual(familyOf(effectOf("vdys", "1", ACCENTS, HIDEABLE)), familyOf(effectOf("vdys", "0", ACCENTS, HIDEABLE)));
});

test("test_effect_of_the_dyslexic_font_off_clears_the_body_family", () => {
  assert.equal(familyOf(effectOf("vdys", "0", ACCENTS, HIDEABLE)), null);
});

test("test_effect_of_the_bottom_bar_carries_the_pick", () => {
  assert.equal(valueOf(effectOf("vbottom", "volume", ACCENTS, HIDEABLE)), "volume");
});

test("test_effect_of_the_top_of_page_carries_the_pick", () => {
  assert.equal(valueOf(effectOf("vfill", "matrix", ACCENTS, HIDEABLE)), "matrix");
});

test("test_effect_of_the_option_style_carries_the_pick", () => {
  assert.equal(valueOf(effectOf("vstyle", "plain", ACCENTS, HIDEABLE)), "plain");
});

test("test_effect_of_a_setting_the_mock_does_not_act_on_is_none", () => {
  assert.equal(effectOf("vdesc", "1", ACCENTS, HIDEABLE).kind, "none");
});
