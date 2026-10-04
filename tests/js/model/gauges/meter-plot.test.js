// Behavioral suite for the mockup's meter plots (mockup/scripts/model/gauges/meter-plot.js): where each plot puts what
// it paints (spectrum points and axes, the spectrogram's colour indices, the time axis, the colour ramp).
//
// Run: node --test tests/js/mockup/gauges/meter-plot.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  apodRamp,
  freqTicks,
  rampLut,
  spectrogramIndex,
  spectrumAxes,
  spectrumPoints,
  timeTicks,
  windowSpan,
} from "../../../../hqptuner/static/model/gauges/meter-plot.js";
import { near } from "../../support/near.js";

//: Tolerance for sums the float arithmetic may round in the last place.
const EPS = 1e-9;

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

test("test_the_spectrum_db_ticks_run_from_full_scale_to_the_range", () => {
  assert.deepEqual(
    spectrumAxes(PLOT).db.map((t) => t.db),
    [0, -10, -20, -30, -40, -50, -60],
  );
});

test("test_a_wider_range_spaces_its_db_ticks_further_apart", () => {
  assert.deepEqual(
    spectrumAxes({ ...PLOT, range: 120 }).db.map((t) => t.db),
    [0, -20, -40, -60, -80, -100, -120],
  );
});

test("test_a_spectrum_db_tick_sits_at_its_level", () => {
  assert.equal(spectrumAxes(PLOT).db[3].y, 50);
});

test("test_a_spectrum_frequency_tick_sits_at_its_frequency", () => {
  assert.equal(spectrumAxes(PLOT).hz[2].x, 100);
});

//: Nyquist, and the frequency ticks (Hz) its axis carries.
const KHZ = [
  { name: "a_cd_nyquist_ticks_every_5_khz", nyq: 22050, want: [0, 5000, 10000, 15000] },
  { name: "a_nyquist_past_30_khz_ticks_every_10_khz", nyq: 48000, want: [0, 10000, 20000, 30000, 40000] },
  { name: "a_nyquist_past_60_khz_ticks_every_20_khz", nyq: 96000, want: [0, 20000, 40000, 60000, 80000] },
  { name: "no_tick_crowds_the_top_15_percent_under_nyquist", nyq: 20000, want: [0, 5000, 10000, 15000] },
];

for (const row of KHZ) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(
      freqTicks(row.nyq, (f) => f / row.nyq).ticks.map((t) => t.khz * 1000),
      row.want,
    );
  });
}

test("test_a_frequency_tick_sits_where_the_axis_puts_its_frequency", () => {
  assert.equal(freqTicks(20000, (f) => 1 - f / 20000).ticks[1].at, 0.75);
});

test("test_the_nyquist_label_sits_where_the_axis_puts_nyquist", () => {
  assert.equal(freqTicks(22050, (f) => f / 44100).nyq.at, 0.5);
});

test("test_the_nyquist_label_reads_in_khz_to_two_places", () => {
  assert.equal(freqTicks(22050, (f) => f / 22050).nyq.khz, 22.05);
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

test("test_the_all_window_spans_every_column_since_track_start", () => {
  assert.equal(windowSpan("all", 2000, 10), 2000);
});

test("test_a_timed_window_spans_its_seconds_of_columns", () => {
  assert.equal(windowSpan(60, 2000, 10), 600);
});

// ── Time axis ────────────────────────────────────────────────────────────

/**
 * The time axis's ticks as [position, value] pairs.
 *
 * @param {number} spanS
 * @param {number} totalS
 * @param {boolean} all
 * @returns {number[][]}
 */
const ticksOf = (spanS, totalS, all) => timeTicks(spanS * 10, totalS * 10, 10, all).ticks.map((t) => [t.at, t.value]);

test("test_a_one_minute_window_ticks_every_15_seconds_back_to_its_left_edge", () => {
  assert.deepEqual(ticksOf(60, 200, false), [
    [0, -60],
    [0.25, -45],
    [0.5, -30],
    [0.75, -15],
    [1, 0],
  ]);
});

test("test_a_thirty_second_window_ticks_every_10_seconds", () => {
  assert.deepEqual(
    ticksOf(30, 200, false).map(([, v]) => v),
    [-30, -20, -10, 0],
  );
});

test("test_a_window_over_two_minutes_reads_in_minutes", () => {
  assert.equal(timeTicks(3000, 4000, 10, false).inMin, true);
});

test("test_a_two_minute_window_reads_in_seconds", () => {
  assert.equal(timeTicks(1200, 4000, 10, false).inMin, false);
});

test("test_a_five_minute_window_ticks_every_minute", () => {
  assert.deepEqual(
    ticksOf(300, 400, false).map(([, v]) => v),
    [-5, -4, -3, -2, -1, 0],
  );
});

test("test_the_all_window_ticks_from_track_start_and_ends_on_the_track_position", () => {
  assert.deepEqual(ticksOf(40, 40, true), [
    [0, 0],
    [0.25, 10],
    [0.5, 20],
    [0.75, 30],
    [1, 40],
  ]);
});

test("test_a_tick_crowding_the_right_edge_gives_way_to_the_end_label", () => {
  assert.deepEqual(
    ticksOf(42, 42, true).map(([, v]) => v),
    [0, 10, 20, 30, 42],
  );
});

test("test_a_tick_clear_of_the_right_edge_stays", () => {
  assert.deepEqual(
    ticksOf(44, 44, true).map(([, v]) => v),
    [0, 10, 20, 30, 40, 44],
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

test("test_one_apodizing_event_leans_most_of_the_way_to_the_bad_colour", () => {
  assert.ok(...near(apodRamp(GLASS, BAD)[1][0], 63, EPS));
});

test("test_three_apodizing_events_lean_furthest_to_the_bad_colour", () => {
  assert.ok(...near(apodRamp(GLASS, BAD)[3][0], 99, EPS));
});
