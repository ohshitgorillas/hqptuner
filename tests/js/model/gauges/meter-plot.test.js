// Behavioral suite for the meter plots: where each plot puts what it paints (spectrum points and axes, the
// spectrogram's colour indices, the time axis, the colour ramp).

import test from "node:test";
import assert from "node:assert/strict";

import {
  apodRamp,
  freqTicks,
  rampLut,
  spectrogramIndex,
  spectrumPoints,
  timeTicks,
} from "../../../../hqptuner/static/model/gauges/meter-plot.js";

// ── Spectrum plot ────────────────────────────────────────────────────────

//: A 200 × 100 plot of 0 … 20 kHz over a 60 dB span.
const PLOT = { nyq: 20000, range: 60, w: 200, h: 100 };

test("test_a_spectrum_point_sits_at_its_frequency_across_the_width", () => {
  assert.equal(spectrumPoints([-30, -30], [0, 5000], PLOT)[1][0], 50);
});

test("test_a_spectrum_point_at_full_scale_sits_on_the_top_edge", () => {
  assert.equal(spectrumPoints([0], [1000], PLOT)[0][1], 0);
});

test("test_a_spectrum_point_drops_by_its_share_of_the_range", () => {
  assert.equal(spectrumPoints([-15], [1000], PLOT)[0][1], 25);
});

test("test_a_spectrum_point_drops_further_on_a_narrower_range", () => {
  assert.equal(spectrumPoints([-15], [1000], { ...PLOT, range: 30 })[0][1], 50);
});

test("test_a_spectrum_point_below_the_range_rests_on_the_bottom_edge", () => {
  assert.equal(spectrumPoints([-300], [1000], PLOT)[0][1], 100);
});

test("test_a_spectrum_point_above_full_scale_stays_on_the_top_edge", () => {
  assert.equal(spectrumPoints([6], [1000], PLOT)[0][1], 0);
});

test("test_the_nyquist_label_sits_where_the_axis_puts_nyquist", () => {
  assert.equal(freqTicks(22050, (f) => f / 44100).nyq.at, 0.5);
});

// ── Spectrogram ──────────────────────────────────────────────────────────

/** @typedef {{ db: number[], apod: number }} Col */

/**
 * A history column holding one row per channel (L, R, Sum) of a two-row spectrogram.
 *
 * @param {number[]} db  six levels: L rows, R rows, Sum rows
 * @param {number} [apod]
 * @returns {Col}
 */
const col = (db, apod = 0) => ({ db, apod });

//: Four history columns, the loudest Sum row in column 1; columns 0 and 3 carry two apodizing events each.
const HIST = [
  col([0, -60, -30, -30, -20, -30], 2),
  col([-60, -60, -30, -30, -10, -40]),
  col([-60, -60, -30, -30, -45, -60]),
  col([-60, -60, -30, -30, -60, -70], 2),
];

//: Four pixel columns over two rows, a 60 dB span, Sum rows, all four history columns.
const VIEW = { cols: 4, rows: 2, span: 4, off: 4, range: 60 };

test("test_a_pixel_at_full_scale_takes_the_top_colour", () => {
  assert.equal(spectrogramIndex([col([0, 0, 0, 0, 0, 0])], 0, { ...VIEW, span: 1, cols: 1 }).colour[0], 255);
});

test("test_a_pixel_at_the_bottom_of_the_range_takes_the_first_colour", () => {
  assert.equal(spectrogramIndex(HIST, 0, VIEW).colour[3], 0);
});

test("test_a_pixel_below_the_range_takes_the_first_colour", () => {
  assert.equal(spectrogramIndex(HIST, 0, VIEW).colour[7], 0);
});

test("test_a_narrower_range_darkens_the_same_level", () => {
  assert.equal(spectrogramIndex(HIST, 0, { ...VIEW, range: 30 }).colour[4], 0);
});

test("test_a_pixel_half_way_down_the_range_takes_the_middle_colour", () => {
  assert.equal(spectrogramIndex(HIST, 0, VIEW).colour[4], 128);
});

test("test_a_pixel_reads_the_rows_of_the_channel_shown", () => {
  assert.equal(spectrogramIndex(HIST, 0, { ...VIEW, off: 0 }).colour[0], 255);
});

test("test_a_pixel_column_spanning_several_history_columns_shows_the_loudest", () => {
  assert.equal(spectrogramIndex(HIST, 0, { ...VIEW, cols: 1 }).colour[0], 213);
});

test("test_a_pixel_before_the_first_column_held_shows_no_data", () => {
  assert.equal(spectrogramIndex(HIST, 0, { ...VIEW, span: 8, cols: 8 }).colour[0], -1);
});

test("test_a_pixel_on_a_column_dropped_from_history_shows_no_data", () => {
  assert.equal(spectrogramIndex(HIST.slice(2), 2, VIEW).colour[1], -1);
});

test("test_a_pixel_on_a_column_still_held_after_some_dropped_shows_it", () => {
  assert.equal(spectrogramIndex(HIST.slice(2), 2, VIEW).colour[2], 64);
});

test("test_a_pixel_column_counts_the_apodizing_events_it_spans", () => {
  assert.equal(spectrogramIndex(HIST, 0, VIEW).events[3], 2);
});

test("test_a_pixel_column_caps_its_apodizing_count_at_three", () => {
  assert.equal(spectrogramIndex(HIST, 0, { ...VIEW, cols: 1 }).events[0], 3);
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

// ── Colour ramp ──────────────────────────────────────────────────────────

//: Three stops, grey steps of 100.
const STOPS = [
  [0, 0, 0],
  [100, 100, 100],
  [200, 200, 200],
];

test("test_the_ramp_starts_on_the_first_colour", () => {
  assert.deepEqual(Array.from(rampLut(STOPS).subarray(0, 3)), [0, 0, 0]);
});

test("test_the_ramp_ends_on_the_last_colour", () => {
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

//: Glass and the bad colour, a grey step of 100 apart.
const GLASS = [0, 0, 0];
const BAD = [100, 100, 100];

test("test_no_apodizing_event_shows_the_glass", () => {
  assert.deepEqual(apodRamp(GLASS, BAD)[0], [0, 0, 0]);
});
