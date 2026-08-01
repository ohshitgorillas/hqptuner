// Behavioral suite for scripts/eqlab/notes.js — note names, equal temperament,
// note ranges, and the note/harmonic tables read off a summed curve. Written
// blind from a spec block: no eqlab source was read.
//
// Split out of the former eqlab.test.js; every test here is unchanged.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-notes.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { valueAt } from "../../../scripts/eqlab/metrics.js";
import { noteToMidi, midiToName, midiToHz, noteRange, noteTable, noteDeltas } from "../../../scripts/eqlab/notes.js";
import { near, band, curve } from "../support/eqlab-helpers.js";

const FLAT = curve([]);
const PEAK_5 = curve([band(1000, 5, 3)]);

test("test_midi_sixty_nine_is_the_four_hundred_and_forty_hertz_reference", () => {
  assert.ok(...near(midiToHz(69), 440, 1e-9));
});

test("test_a4_resolves_to_midi_sixty_nine", () => {
  assert.equal(noteToMidi("A4"), 69);
});

test("test_c_four_resolves_to_midi_sixty", () => {
  assert.equal(noteToMidi("C4"), 60);
});

// Absolute values, not equality of the two: assert.equal is Object.is, under
// which NaN === NaN, so comparing them would pass on a parser that ignores
// accidentals entirely.
test("test_a_sharp_raises_its_natural_by_a_semitone", () => {
  assert.equal(noteToMidi("A#3"), 58);
});

test("test_a_flat_lowers_its_natural_by_a_semitone", () => {
  assert.equal(noteToMidi("Bb3"), 58);
});

test("test_an_unparseable_note_name_is_named_in_the_error", () => {
  assert.throws(() => noteToMidi("H9"), /H9/);
});

test("test_a_black_key_is_spelled_with_a_sharp", () => {
  assert.equal(midiToName(61), "C#4");
});

test("test_a_note_range_spans_both_endpoints_inclusively", () => {
  assert.equal(noteRange("G4", "A4").length, 3);
});

test("test_a_note_range_starts_at_its_lowest_note", () => {
  assert.equal(noteRange("G4", "A4")[0].name, "G4");
});

test("test_a_note_range_ends_at_its_highest_note", () => {
  assert.equal(noteRange("G4", "A4")[2].name, "A4");
});

test("test_a_note_range_entry_carries_the_frequency_of_its_midi_number", () => {
  const entry = noteRange("G4", "A4")[1];
  assert.ok(...near(entry.hz, midiToHz(entry.midi), 1e-9));
});

test("test_a_note_range_given_backwards_still_reads_low_to_high", () => {
  assert.equal(noteRange("A4", "G4")[0].name, "G4");
});

const TABLE = noteTable(PEAK_5, { from: "A4", to: "A4", harmonics: [1, 2, 3] });

test("test_a_note_table_has_one_row_per_note", () => {
  assert.equal(TABLE.length, 1);
});

test("test_a_note_table_row_has_one_entry_per_requested_harmonic", () => {
  assert.equal(TABLE[0].harmonics.length, 3);
});

test("test_a_harmonic_sits_at_its_multiple_of_the_fundamental", () => {
  assert.ok(...near(TABLE[0].harmonics[1].hz, 880, 1e-6));
});

test("test_a_harmonic_above_twenty_kilohertz_is_kept_with_a_null_level", () => {
  const table = noteTable(PEAK_5, { from: "A4", to: "A4", harmonics: [1, 48] });
  assert.equal(table[0].harmonics[1].db, null);
});

test("test_a_note_table_without_a_spec_is_null", () => {
  assert.equal(noteTable(PEAK_5, null), null);
});

// +6 dB right on A4, so an in-band level is unmistakable against null or zero.
const A_BOOST = curve([band(440, 6, 3)]);

test("test_a_harmonic_inside_the_band_carries_the_curve_level_at_its_frequency", () => {
  const row = noteTable(A_BOOST, { from: "A4", to: "A4", harmonics: [1] })[0];
  assert.ok(...near(row.harmonics[0].db, valueAt(A_BOOST, 440), 0.01));
});

test("test_a_note_delta_is_the_after_level_minus_the_before_level", () => {
  const deltas = noteDeltas(FLAT, A_BOOST, { from: "A4", to: "A4", harmonics: [1] });
  assert.ok(...near(deltas[0].harmonics[0].delta, 6, 0.1));
});

test("test_a_note_delta_carries_the_before_level_it_was_measured_from", () => {
  const deltas = noteDeltas(FLAT, A_BOOST, { from: "A4", to: "A4", harmonics: [1] });
  assert.ok(...near(deltas[0].harmonics[0].before, 0, 1e-9));
});

test("test_a_note_delta_carries_the_after_level_it_was_measured_to", () => {
  const deltas = noteDeltas(FLAT, A_BOOST, { from: "A4", to: "A4", harmonics: [1] });
  assert.ok(...near(deltas[0].harmonics[0].after, valueAt(A_BOOST, 440), 0.01));
});
