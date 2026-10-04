// Behavioral suite for mockup/scripts/model/crossfeed.js: the name a crossfeed mode shows, the Bauer preset a stored
// value names, and the Structural preset a speaker angle and center character land on, exactly or within a tolerance.
//
// Run: node --test tests/js/mockup/crossfeed.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { bauerPreset, modeName, structuralPreset } from "../../../mockup/scripts/model/crossfeed.js";

//: Modes the test writes, each named by a number.
const MODES = [
  { v: "off", label: 10 },
  { v: "bauer", label: 20 },
  { v: "structural", label: 30 },
];

//: Bauer presets the test writes.
const BAUER = [
  { v: "default", n: 1 },
  { v: "cmoy", n: 2 },
];

//: Structural presets the test writes: two share an angle, two share a center character.
const STRUCTURAL = [
  { v: "a", angle: 30, lambda: 0.7 },
  { v: "b", angle: 30, lambda: 1 },
  { v: "c", angle: 45, lambda: 0.7 },
];

//: A tolerance the test writes, wider on the angle than on the center character.
const TOL = { angle: 0.5, lambda: 0.125 };

// ── modeName ─────────────────────────────────────────────────────────────

test("test_mode_name_names_a_known_mode", () => {
  assert.equal(modeName(MODES, "bauer"), 20);
});

test("test_mode_name_names_the_off_mode", () => {
  assert.equal(modeName(MODES, "off"), 10);
});

test("test_mode_name_of_an_unknown_mode_is_undefined", () => {
  assert.equal(modeName(MODES, "binaural"), undefined);
});

// ── bauerPreset ──────────────────────────────────────────────────────────

test("test_bauer_preset_finds_the_preset_a_value_names", () => {
  assert.equal(bauerPreset(BAUER, "cmoy"), BAUER[1]);
});

test("test_bauer_preset_of_an_unknown_value_is_undefined", () => {
  assert.equal(bauerPreset(BAUER, "custom"), undefined);
});

// ── structuralPreset ─────────────────────────────────────────────────────

test("test_structural_preset_matches_angle_and_center_exactly", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30, 1), STRUCTURAL[1]);
});

test("test_structural_preset_reads_stored_strings_as_numbers", () => {
  assert.equal(structuralPreset(STRUCTURAL, "45", "0.7"), STRUCTURAL[2]);
});

test("test_structural_preset_without_a_tolerance_misses_a_near_angle", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30.25, 0.7), undefined);
});

test("test_structural_preset_needs_both_values_to_match", () => {
  assert.equal(structuralPreset(STRUCTURAL, 45, 1), undefined);
});

test("test_structural_preset_within_the_tolerance_matches_a_near_angle", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30.25, 0.7, TOL), STRUCTURAL[0]);
});

test("test_structural_preset_within_the_tolerance_matches_a_near_center", () => {
  assert.equal(structuralPreset(STRUCTURAL, 45, 0.75, TOL), STRUCTURAL[2]);
});

test("test_structural_preset_misses_an_angle_at_the_tolerance", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30.5, 0.7, TOL), undefined);
});

test("test_structural_preset_misses_a_center_past_the_tolerance", () => {
  assert.equal(structuralPreset(STRUCTURAL, 45, 0.9, TOL), undefined);
});
