// Behavioral suite for the meter plots: where each plot puts what it paints (the spectrum axis, the time axis, the
// color ramp).

import test from "node:test";
import assert from "node:assert/strict";

import {
  apodRamp,
  freqTicks,
  rampLut,
  timeTicks,
} from "../../../../../hqptuner/static/model/gauges/meter/meter-plot.js";

// ── Spectrum plot ────────────────────────────────────────────────────────

test("test_the_nyquist_label_sits_where_the_axis_puts_nyquist", () => {
  assert.equal(freqTicks(22050, (f) => f / 44100).nyq.at, 0.5);
});

// ── Time axis ────────────────────────────────────────────────────────────

/**
 * The time axis's ticks as [position, value] pairs.
 *
 * @param {number} spanS
 * @returns {number[][]}
 */
const ticksOf = (spanS) => timeTicks(spanS * 10, 10).ticks.map((t) => [t.at, t.value]);

test("test_a_tick_crowding_the_right_edge_gives_way_to_the_end_label", () => {
  assert.deepEqual(
    ticksOf(42).map(([, v]) => v),
    [-42, -32, -22, -12, 0],
  );
});

test("test_a_tick_clear_of_the_right_edge_stays", () => {
  assert.deepEqual(
    ticksOf(44).map(([, v]) => v),
    [-44, -34, -24, -14, -4, 0],
  );
});

// ── Color ramp ──────────────────────────────────────────────────────────

//: Three stops, grey steps of 100.
const STOPS = [
  [0, 0, 0],
  [100, 100, 100],
  [200, 200, 200],
];

test("test_the_ramp_starts_on_the_first_color", () => {
  assert.deepEqual(Array.from(rampLut(STOPS).subarray(0, 3)), [0, 0, 0]);
});

test("test_the_ramp_ends_on_the_last_color", () => {
  assert.deepEqual(Array.from(rampLut(STOPS).subarray(765, 768)), [200, 200, 200]);
});

test("test_the_ramp_blends_the_two_stops_either_side_of_an_index", () => {
  assert.equal(rampLut(STOPS)[51 * 3], 40);
});

test("test_the_ramp_spreads_its_stops_evenly", () => {
  assert.deepEqual(
    Array.from(
      rampLut([
        [0, 0, 0],
        [30, 0, 0],
        [60, 0, 0],
        [255, 0, 0],
      ]).subarray(510, 513),
    ),
    [60, 0, 0],
  );
});

test("test_the_ramp_blends_each_channel_on_its_own", () => {
  assert.deepEqual(
    Array.from(
      rampLut([
        [0, 100, 200],
        [200, 100, 0],
      ]).subarray(51 * 3, 51 * 3 + 3),
    ),
    [40, 100, 160],
  );
});

//: Glass and the bad color, a grey step of 100 apart.
const GLASS = [0, 0, 0];
const BAD = [100, 100, 100];

test("test_no_apodizing_event_shows_the_glass", () => {
  assert.deepEqual(apodRamp(GLASS, BAD)[0], [0, 0, 0]);
});
