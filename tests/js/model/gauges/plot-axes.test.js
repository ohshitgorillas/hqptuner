// Behavioral suite for mockup/scripts/model/plot-axes.js: where a response plot puts a frequency and a level, the
// level grid it draws, the trace it samples and the point a handle drag lands on.
//
// Every box is a row the test writes. W = 332 leaves 300 px of frequency over 20 Hz to 20 kHz (100 px a decade);
// H = 122 leaves 100 px of level, 2.5 px a dB over −10 … +30 dB.
//
// Run: node --test tests/js/mockup/plot-axes.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  centredLevelY,
  levelGrid,
  plotGeometry,
  pointAt,
  tracePath,
} from "../../../../hqptuner/static/model/gauges/plot-axes.js";
import { near } from "../../support/near.js";

//: Tolerance for maps the float arithmetic may round in the last place.
const EPS = 1e-9;

const BOX = { W: 332, H: 122, fMin: 20, fMax: 20000, lo: -10, hi: 30 };
const GEO = plotGeometry(BOX);
//: The same box on a ±12 dB scale drawn about its middle.
const CENTRED = plotGeometry({ ...BOX, lo: -12, hi: 12 }, centredLevelY);

//: The Loudness drawer's scale: −3 … +24 dB, majors every 6, minors every 3.
const LOUD = { lo: -3, hi: 24, step: 6, minor: 3 };

/**
 * The frequencies a trace of `n` segments samples, in order.
 *
 * @param {number} n
 * @returns {number[]}
 */
function sampled(n) {
  /** @type {number[]} */
  const seen = [];
  tracePath(GEO, n, (f) => {
    seen.push(f);
    return 0;
  });
  return seen;
}

/**
 * A path's points as [x, y] pairs.
 *
 * @param {string} d
 * @returns {number[][]}
 */
const points = (d) =>
  d
    .split(/[ML]/)
    .filter((p) => p.trim())
    .map((p) => p.trim().split(" ").map(Number));

// ── Frequency axis ───────────────────────────────────────────────────────

test("test_the_lowest_frequency_sits_at_the_left_gutter", () => {
  assert.ok(...near(GEO.x(20), 28, EPS));
});

test("test_the_highest_frequency_sits_four_px_inside_the_right_edge", () => {
  assert.ok(...near(GEO.x(20000), 328, EPS));
});

test("test_every_decade_spans_the_same_width", () => {
  assert.ok(...near(GEO.x(2000) - GEO.x(200), 100, EPS));
});

test("test_the_frame_right_edge_is_the_highest_frequency", () => {
  assert.equal(GEO.x1, 328);
});

// ── Level axis ───────────────────────────────────────────────────────────

test("test_the_top_of_the_scale_sits_at_the_top_pad", () => {
  assert.ok(...near(GEO.y(30), 6, EPS));
});

test("test_the_bottom_of_the_scale_sits_on_the_frequency_band", () => {
  assert.ok(...near(GEO.y(-10), 106, EPS));
});

test("test_a_level_maps_linearly_between_the_bounds", () => {
  assert.ok(...near(GEO.y(10), 56, EPS));
});

test("test_the_frame_bottom_edge_is_the_lowest_level", () => {
  assert.equal(GEO.yb, 106);
});

test("test_a_centred_scale_puts_zero_at_mid_height", () => {
  assert.ok(...near(CENTRED.y(0), 56, EPS));
});

test("test_a_centred_scale_puts_its_top_at_the_top_pad", () => {
  assert.ok(...near(CENTRED.y(12), 6, EPS));
});

// ── Level grid ───────────────────────────────────────────────────────────

test("test_majors_fall_on_every_step", () => {
  assert.deepEqual(levelGrid(LOUD, 108, 12).major, [6, 12, 18, 24]);
});

test("test_minors_fall_between_the_majors", () => {
  assert.deepEqual(levelGrid(LOUD, 108, 12).minor, [-3, 3, 9, 15, 21]);
});

test("test_without_a_minor_step_every_line_is_a_major", () => {
  assert.deepEqual(levelGrid({ lo: -15, hi: 3, step: 3 }, 100, 12).major, [-15, -12, -9, -6, -3, 3]);
});

test("test_fractional_steps_land_on_tenths", () => {
  assert.deepEqual(
    levelGrid({ lo: -12.5, hi: 12.5, step: 5, minor: 2.5 }, 100, 12).minor,
    [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5],
  );
});

test("test_zero_is_labelled_after_the_majors_when_inside_the_scale", () => {
  assert.deepEqual(levelGrid(LOUD, 108, 12).labels, [6, 12, 18, 24, 0]);
});

test("test_zero_is_not_labelled_when_outside_the_scale", () => {
  assert.deepEqual(levelGrid({ lo: 2, hi: 30, step: 8 }, 100, 12).labels, [8, 16, 24]);
});

test("test_minor_lines_show_when_every_gap_reaches_the_minimum", () => {
  assert.equal(levelGrid(LOUD, 108, 12).roomy, true);
});

test("test_minor_lines_hide_when_a_gap_falls_short_of_the_minimum", () => {
  assert.notEqual(levelGrid(LOUD, 107, 12).roomy, levelGrid(LOUD, 108, 12).roomy);
});

// ── Trace ────────────────────────────────────────────────────────────────

test("test_a_trace_samples_evenly_spaced_decades", () => {
  assert.deepEqual(sampled(3).map(Math.round), [20, 200, 2000, 20000]);
});

test("test_a_trace_has_one_point_more_than_its_segments", () => {
  assert.equal(points(tracePath(GEO, 5, () => 0)).length, 6);
});

test("test_a_trace_point_is_rounded_to_a_tenth", () => {
  assert.deepEqual(points(tracePath(GEO, 1, () => 1.23))[0], [28, 77.9]);
});

test("test_a_trace_ends_on_the_right_edge", () => {
  assert.equal(points(tracePath(GEO, 4, () => 0))[4][0], 328);
});

// ── Handle drag ──────────────────────────────────────────────────────────

test("test_a_drag_reads_frequency_on_the_log_axis", () => {
  assert.equal(pointAt(GEO, 128, 56)[0], 200);
});

test("test_a_drag_reads_level_on_the_linear_axis", () => {
  assert.equal(pointAt(GEO, 128, 56)[1], 10);
});

test("test_a_drag_frequency_snaps_to_whole_hz", () => {
  assert.equal(pointAt(GEO, 129, 56)[0], 205);
});

test("test_a_drag_level_snaps_to_a_tenth", () => {
  assert.equal(pointAt(GEO, 128, 56.37)[1], 9.9);
});

test("test_a_drag_past_the_right_edge_holds_the_highest_frequency", () => {
  assert.equal(pointAt(GEO, 900, 56)[0], 20000);
});

test("test_a_drag_past_the_left_edge_holds_the_lowest_frequency", () => {
  assert.equal(pointAt(GEO, -40, 56)[0], 20);
});
