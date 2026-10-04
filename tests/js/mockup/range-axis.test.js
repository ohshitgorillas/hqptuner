// Behavioral suite for mockup/scripts/model/range-axis.js: where a range bar puts a dB value and what value a pointer
// reads, its ticks and their lengths, the end labels' anchors, which handle a press takes, and the clamps a drag or a
// typed value passes through.
//
// The bar is a row the test writes: 232 px wide with a 16 px inset leaves 200 px of track.
//
// Run: node --test tests/js/mockup/range-axis.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  barValueAt,
  barX,
  clampBounds,
  clampToAxis,
  clampVolume,
  labelAnchor,
  pickBound,
  pickVolumeHandle,
  tickMarks,
  ticksEvery,
} from "../../../mockup/scripts/model/range-axis.js";
import { near } from "../support/near.js";

//: Tolerance for values the float arithmetic may round in the last place.
const EPS = 1e-9;

const W = 232;
const PADX = 16;
//: −120 … 0 dB, 120 dB over the 200 px track.
const AXIS = { min: -120, max: 0 };
//: −120 … +12 dB, 132 dB over the same track.
const WIDE = { min: -120, max: 12 };
const X = barX(W, AXIS, PADX);

//: Four ticks: two labelled, one strong and labelled, one bare.
const MARKS = tickMarks([-30, -20, -3, 0], new Set([-30, -3, 0]), [0]);

//: A loudness range and a volume range to press against; the pin row lies above y = 28.
const PAIR = { low: -60, high: -20 };
const VOL = { min: -60, startup: -20, max: 0 };
const PIN_BELOW = 28;
//: A volume range with startup and max above 0 dB.
const RAISED = { min: -60, startup: 5, max: 10 };

// ── Bar position ─────────────────────────────────────────────────────────

test("test_the_axis_minimum_sits_at_the_inset", () => {
  assert.equal(X(-120), 16);
});

test("test_the_axis_maximum_sits_at_the_far_inset", () => {
  assert.equal(X(0), 216);
});

test("test_a_value_maps_linearly_along_the_track", () => {
  assert.equal(X(-60), 116);
});

test("test_a_bar_position_snaps_to_half_a_pixel", () => {
  assert.equal(X(-119), 17.5);
});

// ── Pointer value ────────────────────────────────────────────────────────

test("test_a_pointer_at_the_inset_reads_the_axis_minimum", () => {
  assert.ok(...near(barValueAt(W, WIDE, PADX, 16), -120, EPS));
});

test("test_a_pointer_reads_linearly_along_the_track", () => {
  assert.ok(...near(barValueAt(W, WIDE, PADX, 116), -54, EPS));
});

test("test_a_pointer_outside_the_track_reads_past_the_axis", () => {
  assert.ok(...near(barValueAt(W, WIDE, PADX, 0), -130.56, EPS));
});

// ── Ticks ────────────────────────────────────────────────────────────────

test("test_ticks_run_from_the_start_to_the_end_inclusive", () => {
  assert.deepEqual(ticksEvery(-30, 0, 10), [-30, -20, -10, 0]);
});

test("test_ticks_stop_short_of_an_end_off_the_step", () => {
  assert.deepEqual(ticksEvery(-25, 0, 10), [-25, -15, -5]);
});

test("test_tick_marks_keep_the_ticks_in_order", () => {
  assert.deepEqual(
    MARKS.map((m) => m.d),
    [-30, -20, -3, 0],
  );
});

test("test_a_labelled_tick_is_longer_than_a_bare_one", () => {
  assert.ok(MARKS[0].len > MARKS[1].len);
});

test("test_a_strong_tick_is_longer_than_a_labelled_one", () => {
  assert.ok(MARKS[3].len > MARKS[2].len);
});

// ── End labels ───────────────────────────────────────────────────────────

test("test_the_minimum_label_starts_at_its_tick", () => {
  assert.equal(labelAnchor(-120, WIDE), "start");
});

test("test_the_maximum_label_ends_at_its_tick", () => {
  assert.equal(labelAnchor(12, WIDE), "end");
});

test("test_an_inner_label_centres_on_its_tick", () => {
  assert.equal(labelAnchor(0, WIDE), "middle");
});

// ── Press ────────────────────────────────────────────────────────────────

test("test_a_press_nearer_the_lower_bound_takes_it", () => {
  assert.equal(pickBound(-45, PAIR), "low");
});

test("test_a_press_nearer_the_upper_bound_takes_it", () => {
  assert.equal(pickBound(-30, PAIR), "high");
});

test("test_a_press_midway_between_the_bounds_takes_the_lower", () => {
  assert.equal(pickBound(-40, PAIR), "low");
});

test("test_a_press_in_the_pin_row_takes_startup_whatever_is_nearest", () => {
  assert.equal(pickVolumeHandle(-58, 10, VOL, PIN_BELOW), "startup");
});

test("test_a_press_on_the_bar_takes_the_nearest_volume_handle", () => {
  assert.equal(pickVolumeHandle(-3, 40, VOL, PIN_BELOW), "max");
});

test("test_a_press_on_the_bar_nearest_startup_takes_startup", () => {
  assert.equal(pickVolumeHandle(-25, 40, VOL, PIN_BELOW), "startup");
});

test("test_on_the_bar_a_bracket_wins_over_the_startup_pin_it_overlaps", () => {
  assert.equal(pickVolumeHandle(-40, 40, { min: -40, startup: -40, max: 0 }, PIN_BELOW), "min");
});

// ── Loudness bounds ──────────────────────────────────────────────────────

test("test_a_bound_holds_at_the_axis_minimum", () => {
  assert.equal(clampBounds("low", -130.4, PAIR, AXIS), -120);
});

test("test_a_bound_holds_at_the_axis_maximum", () => {
  assert.equal(clampBounds("high", 20, PAIR, WIDE), 12);
});

test("test_a_bound_snaps_to_whole_db", () => {
  assert.equal(clampBounds("high", -33.6, PAIR, AXIS), -34);
});

test("test_the_lower_bound_stops_at_the_upper", () => {
  assert.equal(clampBounds("low", -10, PAIR, AXIS), -20);
});

test("test_the_upper_bound_stops_at_the_lower", () => {
  assert.equal(clampBounds("high", -70, PAIR, AXIS), -60);
});

// ── Volume range ─────────────────────────────────────────────────────────

test("test_min_holds_at_the_axis_minimum", () => {
  assert.equal(clampVolume("min", -200, VOL, WIDE), -120);
});

test("test_min_stops_at_startup", () => {
  assert.equal(clampVolume("min", -10, VOL, WIDE), -20);
});

test("test_min_never_rises_past_zero_even_below_a_higher_startup", () => {
  assert.equal(clampVolume("min", 3, RAISED, WIDE) - clampVolume("min", -7, RAISED, WIDE), 7);
});

test("test_max_holds_at_the_axis_maximum", () => {
  assert.equal(clampVolume("max", 40, VOL, WIDE), 12);
});

test("test_max_stops_at_startup", () => {
  assert.equal(clampVolume("max", -50, VOL, WIDE), -20);
});

test("test_startup_stops_at_min", () => {
  assert.equal(clampVolume("startup", -100, VOL, WIDE), -60);
});

test("test_startup_stops_at_max", () => {
  assert.equal(clampVolume("startup", 30, RAISED, WIDE), 10);
});

test("test_a_volume_value_snaps_to_whole_db", () => {
  assert.equal(clampVolume("startup", -33.4, VOL, WIDE), -33);
});

// ── Readout clamp ────────────────────────────────────────────────────────

test("test_a_value_below_the_axis_holds_at_its_minimum", () => {
  assert.equal(clampToAxis(-130, AXIS), -120);
});

test("test_a_value_above_the_axis_holds_at_its_maximum", () => {
  assert.equal(clampToAxis(20, WIDE), 12);
});

test("test_a_value_on_the_axis_passes_unrounded", () => {
  assert.equal(clampToAxis(-45.25, AXIS), -45.25);
});
