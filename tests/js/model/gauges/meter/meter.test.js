// Behavioral suite for the meter model (hqptuner/static/model/gauges/meter/meter.js): decoding the feed's bin bytes, folding
// feed frames, picking a channel's bins, spreading bins across trace columns, where a level sits on a bar, how the shown
// spectrum and its ghost rise and fall, and the level ballistics and hold.
//
// Time is a table: every frame a test runs is a row holding its `now` (ms) and, where the step takes one, its `dt` (s).
// Nothing here reads a clock or waits on one.
//
// Run: node --test tests/js/model/gauges/meter/meter.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeBins,
  emptySpectrum,
  foldFrames,
  fraction,
  pickBins,
  stepLevel,
  stepSpectrum,
  traceColumns,
} from "../../../../../hqptuner/static/model/gauges/meter/meter.js";
import { near } from "../../../support/near.js";

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
 * The spectrum hold after each row's levels run in order from an empty spectrum, one level a bin, read with the ghost
 * optional so a hold without one fails the ghost cases on their assertions.
 *
 * @param {{ now: number, dt: number, levels: number[], jump?: boolean }[]} rows
 * @returns {{ disp: ArrayLike<number>, ghost?: ArrayLike<number> }}
 */
const holdAfter = (rows) =>
  rows.reduce(
    (st, row) => stepSpectrum(st, Float64Array.from(row.levels), { now: row.now, dt: row.dt }, row.jump ?? false),
    emptySpectrum(rows[0].levels.length),
  );

/**
 * The one bin's shown level and ghost after the rows run in order from an empty spectrum; the ghost is NaN where the
 * hold carries none.
 *
 * @param {SpectrumRow[]} rows
 * @returns {{ disp: number, ghost: number }}
 */
function spectrumAfter(rows) {
  const end = holdAfter(rows.map((row) => ({ ...row, levels: [row.level] })));
  return { disp: end.disp[0], ghost: end.ghost?.[0] ?? NaN };
}

//: One frame of a falling trace: its dt in seconds and the same step in ms.
const FRAME_S = 0.1;
const FRAME_MS = 100;
//: A frame ten frames long, as a stalled loop hands the step.
const LONG_FRAME_S = 1;
//: The level a falling trace starts at, and two levels it falls to, the second twice as far below it as the first.
const LOUD = -10;
const QUIETER = -40;
const QUIETEST = -70;
//: Tolerance for a ratio of levels a Float32Array may round in the last place.
const RATIO_EPS = 1e-4;

/**
 * One frame at `LOUD`, then `n` frames at `to`, every frame `FRAME_MS` apart.
 *
 * @param {number} to
 * @param {number} n
 * @returns {SpectrumRow[]}
 */
const falling = (to, n) => [
  { now: 0, dt: FRAME_S, level: LOUD },
  ...Array.from({ length: n }, (_, k) => ({ now: FRAME_MS * (k + 1), dt: FRAME_S, level: to })),
];

/**
 * How far above `to` the shown level still sits after `n` frames of falling to it from `LOUD`.
 *
 * @param {number} to
 * @param {number} n
 */
const gapAfter = (to, n) => spectrumAfter(falling(to, n)).disp - to;

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
 * One channel of a feed frame.
 *
 * @param {number} peak
 * @param {number} rms
 * @param {number[]} bins
 */
const channel = (peak, rms, bins) => ({ peak, rms, bins: Float32Array.from(bins) });

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

// ── Bin bytes ────────────────────────────────────────────────────────────

test("test_each_bin_decodes_from_two_bytes_low_first_to_half_a_db_below_full_scale_per_step_in_bin_order", () => {
  assert.deepEqual(Array.from(decodeBins("AQAoAJAB")), [-0.5, -20, -200]);
});

test("test_a_padded_bin_string_decodes_every_bin_and_no_more", () => {
  assert.deepEqual(Array.from(decodeBins("PwBYAg==")), [-31.5, -300]);
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

test("test_a_column_holding_no_bin_takes_the_bin_nearest_its_center", () => {
  assert.deepEqual(Array.from(traceColumns([-10, -20, -30], 5)), [-10, -20, -20, -20, -30]);
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

test("test_one_frame_of_a_fall_closes_the_same_share_of_a_gap_twice_as_wide", () => {
  const wide = LOUD - spectrumAfter(falling(QUIETEST, 1)).disp;
  const narrow = LOUD - spectrumAfter(falling(QUIETER, 1)).disp;
  assert.ok(...near(wide / narrow, 2, RATIO_EPS));
});

test("test_each_frame_of_a_fall_closes_the_same_share_of_the_gap_left", () => {
  const first = gapAfter(QUIETER, 1) / (LOUD - QUIETER);
  const second = gapAfter(QUIETER, 2) / gapAfter(QUIETER, 1);
  assert.ok(...near(second, first, RATIO_EPS));
});

test("test_a_falling_level_is_never_shown_below_the_new_level", () => {
  const end = spectrumAfter([
    { now: 0, dt: FRAME_S, level: LOUD },
    { now: 1000 * LONG_FRAME_S, dt: LONG_FRAME_S, level: QUIETER },
  ]).disp;
  assert.ok(end >= QUIETER, `shown ${end} dBFS, below the ${QUIETER} dBFS it falls to`);
});

// ── Ghost ────────────────────────────────────────────────────────────────

test("test_a_rising_trace_lifts_its_ghost_to_the_new_level_at_once", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, dt: FRAME_S, level: QUIETER },
      { now: FRAME_MS, dt: FRAME_S, level: LOUD },
    ]).ghost,
    LOUD,
  );
});

test("test_a_falling_trace_leaves_its_ghost_above_it", () => {
  const end = spectrumAfter(falling(QUIETER, 1));
  assert.ok(end.ghost > end.disp, `ghost ${end.ghost} dBFS, not above the ${end.disp} dBFS trace`);
});

test("test_a_ghost_leaves_the_level_it_came_from_on_the_first_frame_of_a_fall", () => {
  const ghost = spectrumAfter(falling(QUIETER, 1)).ghost;
  assert.ok(ghost < LOUD, `ghost ${ghost} dBFS, still at the ${LOUD} dBFS it fell from`);
});

test("test_a_ghost_is_never_below_the_trace_after_a_long_frame", () => {
  const end = spectrumAfter([
    { now: 0, dt: FRAME_S, level: LOUD },
    { now: 1000 * LONG_FRAME_S, dt: LONG_FRAME_S, level: QUIETER },
  ]);
  assert.ok(end.ghost >= end.disp, `ghost ${end.ghost} dBFS, below the ${end.disp} dBFS trace`);
});

//: Two bins falling together to `QUIETEST`, the first from twice as high above it as the second.
const TWO_BINS_FALLING = [
  { now: 0, dt: FRAME_S, levels: [LOUD, QUIETER] },
  { now: FRAME_MS, dt: FRAME_S, levels: [QUIETEST, QUIETEST] },
  { now: 2 * FRAME_MS, dt: FRAME_S, levels: [QUIETEST, QUIETEST] },
];

test("test_a_settling_ghost_keeps_the_shape_of_the_trace_it_came_from", () => {
  const ghost = holdAfter(TWO_BINS_FALLING).ghost ?? [NaN, NaN];
  const ratio = (ghost[0] - QUIETEST) / (ghost[1] - QUIETEST);
  assert.ok(...near(ratio, 2, RATIO_EPS));
});

// ── Level ballistics and hold ────────────────────────────────────────────

test("test_a_rising_peak_is_shown_at_once", () => {
  assert.equal(levelAfter(REST, { peak: -10, rms: -60 }, [{ now: 50, dt: 0.05 }]).peak, -10);
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

test("test_the_level_hold_never_falls_below_the_peak", () => {
  const start = { ...HELD, hold: -9.5 };
  assert.equal(levelAfter(start, { peak: -10.2, rms: -30 }, [{ now: 2000, dt: 0.1 }]).hold, -10.2);
});
