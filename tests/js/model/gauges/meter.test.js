// Behavioral suite for the mockup's meter model (hqptuner/static/model/gauges/meter.js): decoding the feed's bin
// bytes, folding feed frames, picking a channel's bins, spreading bins across trace columns, smoothing the columns and
// easing the trace toward them, where a level sits on a bar, spectrum peak-hold decay, the level ballistics and hold, and the frame-loop step that clamps dt and owes
// spectrogram columns.
//
// Time is a table: every frame a test runs is a row holding its `now` (ms) and, where the step takes one, its `dt` (s).
// Nothing here reads a clock or waits on one.
//
// Run: node --test tests/js/model/gauges/meter.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeBins,
  easeTrace,
  emptySpectrum,
  foldFrames,
  fraction,
  pickBins,
  smoothColumns,
  stepFrame,
  stepLevel,
  stepSpectrum,
  traceColumns,
} from "../../../../hqptuner/static/model/gauges/meter.js";
import { near } from "../../support/near.js";

//: Tolerance for sums the float arithmetic may round in the last place.
const EPS = 1e-9;
//: Tolerance for a power average stored in a Float32Array and written here to three places.
const DB_EPS = 1e-3;

/** @typedef {{ now: number, dt: number, level: number, jump?: boolean }} SpectrumRow */
/** @typedef {{ now: number, dt: number }} FrameRow */
/** @typedef {{ peak: number, rms: number, hold: number, holdAt: number }} Reading */
/** @typedef {{ channels: { peak: number, rms: number, bins: Float32Array }[], ms: number }} Frame */

/**
 * [ok, message] for spreading into ONE assert.ok: every value lies within `tol` of the one written at its index, and
 * there are as many values as written.
 *
 * @param {ArrayLike<number>} actual
 * @param {number[]} expected
 * @param {number} tol
 * @returns {[boolean, string]}
 */
const nearEach = (actual, expected, tol) => [
  actual.length === expected.length && expected.every((e, i) => Math.abs(actual[i] - e) <= tol),
  `expected [${expected}] ± ${tol}, got [${Array.from(actual)}]`,
];

/**
 * The one bin's shown level, held peak and peak stamp after the rows run in order from an empty spectrum.
 *
 * @param {SpectrumRow[]} rows
 * @returns {{ disp: number, peak: number, peakAt: number }}
 */
function spectrumAfter(rows) {
  const end = rows.reduce(
    (st, row) => stepSpectrum(st, Float64Array.of(row.level), { now: row.now, dt: row.dt }, row.jump ?? false),
    emptySpectrum(1),
  );
  return { disp: end.disp[0], peak: end.peak[0], peakAt: end.peakAt[0] };
}

/**
 * Spectrum rows every `ms` from `from` to `to` ms inclusive, each stepping `ms` of dt, every one at `level`.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} ms
 * @param {number} level
 * @returns {SpectrumRow[]}
 */
const paced = (from, to, ms, level) =>
  Array.from({ length: Math.floor((to - from) / ms) + 1 }, (_, k) => ({ now: from + ms * k, dt: ms / 1000, level }));

/**
 * The reading after every frame of the table steps it toward one fixed target.
 *
 * @param {Reading} start
 * @param {{ peak: number, rms: number }} target
 * @param {FrameRow[]} frames
 * @returns {Reading}
 */
const levelAfter = (start, target, frames) => frames.reduce((v, f) => stepLevel(v, target, f.now, f.dt), start);

/**
 * Frames at 20 fps (50 ms, dt 0.05 s) from `from` to `to` ms inclusive.
 *
 * @param {number} from
 * @param {number} to
 * @returns {FrameRow[]}
 */
const twentyFps = (from, to) =>
  Array.from({ length: Math.floor((to - from) / 50) + 1 }, (_, k) => ({ now: from + 50 * k, dt: 0.05 }));

/**
 * Spectrogram columns owed over a table of rAF frames, the loop starting at the first stamp with nothing accumulated.
 *
 * @param {{ now: number, shown: boolean }[]} frames
 * @param {number} perCol
 * @returns {number}
 */
function columnsOver(frames, perCol) {
  let loop = { prev: frames[0].now, acc: 0 };
  let cols = 0;
  for (const { now, shown } of frames) {
    const f = stepFrame(loop, now, perCol, shown);
    cols += f.cols;
    loop = f;
  }
  return cols;
}

/**
 * One channel of a feed frame.
 *
 * @param {number} peak
 * @param {number} rms
 * @param {number[]} bins
 */
const channel = (peak, rms, bins) => ({ peak, rms, bins: Float32Array.from(bins) });

//: rAF frames one 62.5 ms apart across one second (17 stamps, 16 frames), the meter on screen throughout.
const ONE_SECOND = Array.from({ length: 17 }, (_, k) => ({ now: 1000 + 62.5 * k, shown: true }));
//: The same second with the meter off screen for its first half (stamps 1 to 8).
const HALF_HIDDEN = ONE_SECOND.map((f, k) => ({ ...f, shown: k > 8 }));

/** @type {Reading} */
const REST = { peak: -60, rms: -60, hold: -60, holdAt: 0 };
/** @type {Reading} */
const HELD = { peak: -10, rms: -30, hold: -10, holdAt: 0 };

//: Three feed frames of two channels and two bins. Channel 0's loudest peak is in the middle frame, channel 1's in the
//: first; channel 0's rms and bins differ in every frame.
/** @type {Frame[]} */
const THREE_FRAMES = [
  { channels: [channel(-20, -10, [-10, -40]), channel(-3, -30, [-30, -30])], ms: 10 },
  { channels: [channel(-6, -20, [-20, -30]), channel(-40, -30, [-30, -30])], ms: 21.5 },
  { channels: [channel(-30, -30, [-30, -50]), channel(-12, -30, [-30, -30])], ms: 0.25 },
];

//: One feed frame whose levels a fold through power would not hand back exactly in the last place.
/** @type {Frame} */
const ONE_FRAME = { channels: [channel(-4.7, -12.3, [-12.3, -47.5]), channel(-8.1, -19.9, [-21.5, -60])], ms: 16.667 };

//: One feed frame of two channels whose two bins power-average to -12.596 and -32.596.
/** @type {Frame} */
const TWO_CHANNELS = { channels: [channel(-1, -10, [-10, -40]), channel(-2, -20, [-20, -30])], ms: 20 };

//: Nine bins at -120 dBFS, but for a tone at bin 2 of the four bins in [0, 0.5) of Nyquist.
const TONE = [-120, -120, -6, -120, -120, -120, -120, -120, -120];

//: Nine trace columns at -100 dBFS, but for column 4 at -10.
const LONE = Float32Array.of(-100, -100, -100, -100, -10, -100, -100, -100, -100);

// ── Bin bytes ────────────────────────────────────────────────────────────

test("test_each_bin_byte_decodes_to_half_a_db_below_full_scale_per_step_in_bin_order", () => {
  assert.deepEqual(Array.from(decodeBins("ASj/")), [-0.5, -20, -127.5]);
});

test("test_a_padded_bin_string_decodes_every_byte_and_no_more", () => {
  assert.deepEqual(Array.from(decodeBins("P/8=")), [-31.5, -127.5]);
});

// ── Folding feed frames ──────────────────────────────────────────────────

test("test_a_folded_peak_is_each_channels_loudest_peak", () => {
  assert.deepEqual(
    foldFrames(THREE_FRAMES).channels.map((c) => c.peak),
    [-6, -3],
  );
});

test("test_a_folded_rms_is_each_channels_power_average", () => {
  assert.ok(
    ...nearEach(
      foldFrames(THREE_FRAMES).channels.map((c) => c.rms),
      [-14.318, -30],
      DB_EPS,
    ),
  );
});

test("test_each_folded_bin_is_the_power_average_of_that_bin", () => {
  assert.ok(
    ...nearEach(
      foldFrames(THREE_FRAMES).channels.flatMap((c) => Array.from(c.bins)),
      [-14.318, -34.318, -30, -30],
      DB_EPS,
    ),
  );
});

test("test_a_folded_frame_covers_the_frame_time_of_every_frame", () => {
  assert.equal(foldFrames(THREE_FRAMES).ms, 31.75);
});

test("test_a_single_frame_folds_to_itself", () => {
  assert.deepEqual(foldFrames([ONE_FRAME]), ONE_FRAME);
});

// ── Picking a channel's bins ─────────────────────────────────────────────

test("test_a_channel_index_picks_that_channels_bins", () => {
  assert.deepEqual(Array.from(pickBins(TWO_CHANNELS, "1")), [-20, -30]);
});

test("test_sum_picks_the_power_average_across_channels_bin_by_bin", () => {
  assert.ok(...nearEach(pickBins(TWO_CHANNELS, "sum"), [-12.596, -32.596], DB_EPS));
});

test("test_a_channel_the_frame_lacks_picks_as_sum", () => {
  assert.ok(...nearEach(pickBins(TWO_CHANNELS, "5"), [-12.596, -32.596], DB_EPS));
});

// ── Trace columns ────────────────────────────────────────────────────────

test("test_a_single_bin_tone_keeps_its_full_level_in_a_column_spanning_several_bins", () => {
  assert.equal(traceColumns(TONE, 2)[0], -6);
});

test("test_a_bin_on_a_columns_lower_edge_belongs_to_that_column_alone", () => {
  assert.equal(traceColumns([-30, -40, -5, -50, -60], 2)[0], -30);
});

test("test_the_bin_at_nyquist_belongs_to_the_last_column", () => {
  assert.equal(traceColumns([-30, -40, -50, -60, -5], 2)[1], -5);
});

test("test_a_column_holding_no_bin_takes_the_bin_nearest_its_centre", () => {
  assert.deepEqual(Array.from(traceColumns([-10, -20, -30], 5)), [-10, -20, -20, -20, -30]);
});

// ── Smoothing and easing the trace ───────────────────────────────────────

test("test_a_lone_loud_column_spreads_its_power_two_columns_either_side_at_weights_3_2_1_over_9", () => {
  assert.ok(
    ...nearEach(smoothColumns(LONE), [-100, -100, -19.542, -16.532, -14.771, -16.532, -19.542, -100, -100], DB_EPS),
  );
});

test("test_a_20_db_rise_eases_8_5_db_in_one_thirtieth_of_a_second", () => {
  assert.ok(...near(easeTrace(Float32Array.of(-30), Float32Array.of(-10), 1 / 30)[0], -21.475, DB_EPS));
});

// ── Where a level sits on a bar ──────────────────────────────────────────

test("test_a_level_sits_its_height_above_the_floor_over_the_floors_depth", () => {
  assert.equal(fraction(-15, -60), 0.75);
});

test("test_the_same_level_sits_higher_on_a_deeper_bar", () => {
  assert.equal(fraction(-15, -120), 0.875);
});

test("test_a_level_above_full_scale_fills_the_bar", () => {
  assert.equal(fraction(6, -60), 1);
});

test("test_a_level_below_the_floor_sits_half_a_bar_under_mid_scale", () => {
  assert.equal(fraction(-30, -60) - fraction(-90, -60), 0.5);
});

// ── Spectrum ─────────────────────────────────────────────────────────────

test("test_a_jump_frame_shows_a_level_below_the_one_shown", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: 0.1, level: -10 },
      { now: 100, dt: 0.1, level: -40, jump: true },
    ]).disp,
    -40,
  );
});

test("test_a_rising_level_is_shown_at_once", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: 0.1, level: -40 },
      { now: 100, dt: 0.1, level: -10 },
    ]).disp,
    -10,
  );
});

test("test_a_falling_level_is_shown_falling_thirty_db_per_second", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: 0.1, level: -10 },
      { now: 100, dt: 0.1, level: -40 },
    ]).disp,
    -13,
  );
});

test("test_a_falling_level_falls_half_as_far_in_half_the_time", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: 0.05, level: -10 },
      { now: 50, dt: 0.05, level: -40 },
    ]).disp,
    -11.5,
  );
});

test("test_a_falling_level_is_never_shown_below_the_new_level", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: 0.1, level: -10 },
      { now: 100, dt: 0.1, level: -12 },
    ]).disp,
    -12,
  );
});

test("test_the_spectrum_peak_is_stamped_when_the_shown_level_reaches_it", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: 0.1, level: -40 },
      { now: 100, dt: 0.1, level: -10 },
    ]).peakAt,
    100,
  );
});

test("test_the_spectrum_peak_holds_for_two_seconds", () => {
  assert.equal(spectrumAfter([{ now: 0, dt: 0.1, level: -10 }, ...paced(100, 2000, 100, -40)]).peak, -10);
});

test("test_the_spectrum_peak_falls_ten_db_per_second_after_two_seconds", () => {
  assert.equal(spectrumAfter([{ now: 0, dt: 0.1, level: -10 }, ...paced(100, 2100, 100, -40)]).peak, -11);
});

test("test_a_released_spectrum_peak_falls_half_as_far_in_half_the_time", () => {
  assert.equal(spectrumAfter([{ now: 0, dt: 0.05, level: -10 }, ...paced(50, 2050, 50, -40)]).peak, -10.5);
});

test("test_the_spectrum_peak_never_falls_below_the_shown_level", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: 0.1, level: -10 },
      { now: 2100, dt: 0.1, level: -10.5 },
    ]).peak,
    -10.5,
  );
});

// ── Level ballistics and hold ────────────────────────────────────────────

test("test_a_rising_peak_is_shown_at_once", () => {
  assert.equal(levelAfter(REST, { peak: -10, rms: -60 }, [{ now: 50, dt: 0.05 }]).peak, -10);
});

test("test_a_falling_peak_falls_twenty_db_per_second", () => {
  assert.ok(...near(levelAfter(HELD, { peak: -40, rms: -30 }, [{ now: 100, dt: 0.1 }]).peak, -12, EPS));
});

test("test_a_falling_peak_never_falls_below_the_target", () => {
  assert.equal(levelAfter(HELD, { peak: -11, rms: -30 }, [{ now: 100, dt: 0.1 }]).peak, -11);
});

test("test_the_rms_closes_the_gap_at_dt_over_300_ms", () => {
  assert.ok(...near(levelAfter(HELD, { peak: -10, rms: -20 }, [{ now: 150, dt: 0.15 }]).rms, -25, EPS));
});

test("test_the_rms_never_overshoots_on_a_long_frame", () => {
  assert.equal(levelAfter(HELD, { peak: -10, rms: -20 }, [{ now: 600, dt: 0.6 }]).rms, -20);
});

test("test_the_level_hold_is_stamped_when_the_peak_reaches_it", () => {
  assert.equal(levelAfter(REST, { peak: -10, rms: -60 }, [{ now: 400, dt: 0.05 }]).holdAt, 400);
});

test("test_the_level_hold_holds_for_one_and_a_half_seconds", () => {
  assert.equal(levelAfter(HELD, { peak: -40, rms: -30 }, twentyFps(50, 1500)).hold, -10);
});

test("test_the_level_hold_falls_ten_db_per_second_after_one_and_a_half_seconds", () => {
  assert.ok(...near(levelAfter(HELD, { peak: -40, rms: -30 }, twentyFps(50, 1550)).hold, -10.5, EPS));
});

test("test_the_level_hold_never_falls_below_the_peak", () => {
  const start = { ...HELD, hold: -9.5 };
  assert.equal(levelAfter(start, { peak: -10.2, rms: -30 }, [{ now: 2000, dt: 0.1 }]).hold, -10.2);
});

// ── Frame loop ───────────────────────────────────────────────────────────

test("test_a_frame_steps_by_the_seconds_since_the_last_one", () => {
  assert.equal(stepFrame({ prev: 1000, acc: 0 }, 1062.5, 0.125, true).dt, 0.0625);
});

test("test_a_frame_after_a_long_gap_steps_at_most_100_ms", () => {
  assert.equal(stepFrame({ prev: 1000, acc: 0 }, 6000, 0.125, true).dt, 0.1);
});

test("test_a_frame_stamped_before_the_last_one_takes_back_no_time", () => {
  assert.equal(stepFrame({ prev: 1000, acc: 0.0625 }, 990, 0.125, true).acc, 0.0625);
});

test("test_a_hidden_frame_still_moves_the_loop_to_its_stamp", () => {
  assert.equal(stepFrame({ prev: 1000, acc: 0 }, 1062.5, 0.125, false).prev, 1062.5);
});

test("test_hidden_frames_owe_no_columns", () => {
  assert.equal(columnsOver(HALF_HIDDEN, 0.125), 4);
});

test("test_a_hidden_frame_accumulates_no_time", () => {
  assert.equal(stepFrame({ prev: 1000, acc: 0.0625 }, 1062.5, 0.125, false).acc, 0.0625);
});

test("test_one_second_of_frames_owes_one_second_of_columns", () => {
  assert.equal(columnsOver(ONE_SECOND, 0.125), 8);
});

test("test_time_short_of_a_column_carries_to_the_next_frame", () => {
  assert.equal(stepFrame({ prev: 1000, acc: 0 }, 1062.5, 0.125, true).acc, 0.0625);
});

test("test_one_long_frame_owes_no_more_columns_than_100_ms_holds", () => {
  assert.equal(stepFrame({ prev: 1000, acc: 0 }, 6000, 0.03125, true).cols, 3);
});
