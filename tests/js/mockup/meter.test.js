// Behavioral suite for the mockup's meter model (mockup/scripts/model/meter.js): spectrum peak-hold decay, the level
// target a column sets, the level ballistics and hold, the frame-loop step that clamps dt and owes spectrogram
// columns, the mock signal source, and where each plot puts what it paints (spectrum points and axes, the
// spectrogram's colour indices, the time axis, the colour ramp).
//
// Time is a table: every frame a test runs is a row holding its `now` (ms) and, where the step takes one, its `dt` (s).
// Nothing here reads a clock or waits on one.
//
// Run: node --test tests/js/mockup/meter.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  apodRamp,
  binLevels,
  emptySpectrum,
  freqTicks,
  jitter,
  levelTarget,
  mockColumn,
  power,
  rampLut,
  spectrogramIndex,
  spectrumAxes,
  spectrumPoints,
  stepFrame,
  stepLevel,
  stepSpectrum,
  timeTicks,
  windowSpan,
} from "../../../mockup/scripts/model/meter.js";
import { near } from "../support/near.js";

//: Tolerance for sums the float arithmetic may round in the last place.
const EPS = 1e-9;

/** @typedef {{ now: number, level: number, jump?: boolean }} SpectrumRow */
/** @typedef {{ now: number, dt: number }} FrameRow */
/** @typedef {{ peak: number, rms: number, hold: number, holdAt: number }} Reading */

/**
 * The one bin's shown level, held peak and peak stamp after the rows run in order from an empty spectrum.
 *
 * @param {SpectrumRow[]} rows
 * @returns {{ disp: number, peak: number, peakAt: number }}
 */
function spectrumAfter(rows) {
  const end = rows.reduce(
    (st, row) => stepSpectrum(st, Float64Array.of(row.level), row.now, row.jump ?? false),
    emptySpectrum(1),
  );
  return { disp: end.disp[0], peak: end.peak[0], peakAt: end.peakAt[0] };
}

/**
 * Spectrum rows at 10 Hz from `from` to `to` ms inclusive, every one at `level`.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} level
 * @returns {SpectrumRow[]}
 */
const tenHz = (from, to, level) =>
  Array.from({ length: Math.floor((to - from) / 100) + 1 }, (_, k) => ({ now: from + 100 * k, level }));

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

//: rAF frames one 62.5 ms apart across one second (17 stamps, 16 frames), the meter on screen throughout.
const ONE_SECOND = Array.from({ length: 17 }, (_, k) => ({ now: 1000 + 62.5 * k, shown: true }));
//: The same second with the meter off screen for its first half (stamps 1 to 8).
const HALF_HIDDEN = ONE_SECOND.map((f, k) => ({ ...f, shown: k > 8 }));

/** @type {Reading} */
const REST = { peak: -60, rms: -60, hold: -60, holdAt: 0 };
/** @type {Reading} */
const HELD = { peak: -10, rms: -30, hold: -10, holdAt: 0 };

/**
 * One mock column for the target.
 *
 * @param {{ env?: number, kick?: boolean }} o
 */
const column = ({ env = 0, kick = false }) => ({ idx: 7, env, kick });

// ── Spectrum ─────────────────────────────────────────────────────────────

test("test_a_jump_frame_shows_a_level_below_the_one_shown", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, { now: 100, level: -40, jump: true }]).disp, -40);
});

test("test_a_rising_level_is_shown_at_once", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -40 }, { now: 100, level: -10 }]).disp, -10);
});

test("test_a_falling_level_is_shown_falling_three_db_per_frame", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, { now: 100, level: -40 }]).disp, -13);
});

test("test_a_falling_level_is_never_shown_below_the_new_level", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, { now: 100, level: -12 }]).disp, -12);
});

test("test_the_spectrum_peak_is_stamped_when_the_shown_level_reaches_it", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -40 }, { now: 100, level: -10 }]).peakAt, 100);
});

test("test_the_spectrum_peak_holds_for_two_seconds", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, ...tenHz(100, 2000, -40)]).peak, -10);
});

test("test_the_spectrum_peak_falls_one_db_per_frame_after_two_seconds", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, ...tenHz(100, 2100, -40)]).peak, -11);
});

test("test_the_spectrum_peak_never_falls_below_the_shown_level", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, { now: 2100, level: -10.5 }]).peak, -10.5);
});

// ── Level target ─────────────────────────────────────────────────────────

test("test_the_target_peak_never_rises_past_the_ceiling", () => {
  assert.equal(levelTarget(column({ env: 40 }), 0, 0).peak, -0.6);
});

test("test_the_target_rms_follows_the_column_envelope_one_for_one", () => {
  assert.ok(...near(levelTarget(column({ env: 6 }), 0, 0).rms - levelTarget(column({}), 0, 0).rms, 6, EPS));
});

test("test_a_kick_lifts_the_target_peak_three_db", () => {
  assert.ok(...near(levelTarget(column({ kick: true }), 1, 0).peak - levelTarget(column({}), 1, 0).peak, 3, EPS));
});

test("test_the_target_peak_sits_at_least_eight_db_over_the_rms", () => {
  const t = levelTarget(column({}), 0, 500);
  assert.ok(t.peak - t.rms >= 8);
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

// ── Mock signal source ───────────────────────────────────────────────────

//: A source with its content ending at 19.6 kHz and no modulator noise.
const CD = { brick: 19600, dsdNoise: false };
//: The same source with its content running past 30 kHz.
const HIRES = { ...CD, brick: 30000 };
//: The CD source decimated from DSD: modulator noise above 12 kHz.
const DSD = { ...CD, dsdNoise: true };

/** @typedef {{ notes: number[], dyn: number[], hatDb: number, kick: boolean, hat: boolean, env: number }} Voice */

//: One 1 kHz note at full level, nothing else sounding.
/** @type {Voice} */
const NOTE = { notes: [1000], dyn: [0], hatDb: 0, kick: false, hat: false, env: 0 };
//: Silence: no note, no kick, no hat.
/** @type {Voice} */
const QUIET = { notes: [], dyn: [], hatDb: 0, kick: false, hat: false, env: 0 };
//: One 1.5 kHz note, its 13th harmonic at 19.5 kHz.
/** @type {Voice} */
const LOW_NOTE = { ...NOTE, notes: [1500] };

//: Ten columns a second over two rows (1 kHz, 500 Hz) of the CD source.
const SRC = { ...CD, perCol: 0.1, rowHz: [1000, 500] };

/**
 * Indices in [from, to) whose mock column has the flag set.
 *
 * @param {number} from
 * @param {number} to
 * @param {(c: { kick: boolean, hat: boolean, apod: number }) => boolean} pick
 * @returns {number[]}
 */
const columnsWhere = (from, to, pick) =>
  Array.from({ length: to - from }, (_, k) => from + k).filter((i) => pick(mockColumn(i, SRC)));

/**
 * Power in dB.
 *
 * @param {number} p
 */
const dbOf = (p) => 10 * Math.log10(p);

test("test_power_peaks_at_a_sounding_note", () => {
  assert.ok(power(NOTE, 1000, 0, CD) > power(NOTE, 1100, 0, CD));
});

test("test_a_note_adds_power_at_its_harmonics", () => {
  assert.ok(power(NOTE, 3000, 0, CD) > power(QUIET, 3000, 0, CD));
});

test("test_a_note_sounds_no_harmonic_past_97_percent_of_the_brick_wall", () => {
  assert.ok(power(LOW_NOTE, 19500, 0, CD) < power(LOW_NOTE, 19500, 0, HIRES));
});

test("test_content_above_the_brick_wall_falls_away", () => {
  assert.ok(power(QUIET, 21000, 0, CD) < power(QUIET, 21000, 0, HIRES));
});

test("test_a_kick_lifts_the_bass", () => {
  assert.ok(power({ ...QUIET, kick: true }, 60, 0, CD) > power(QUIET, 60, 0, CD));
});

test("test_a_kick_leaves_the_treble_alone", () => {
  assert.equal(power({ ...QUIET, kick: true }, 5000, 0, CD), power(QUIET, 5000, 0, CD));
});

test("test_a_hat_lifts_the_treble", () => {
  assert.ok(power({ ...QUIET, hat: true }, 8000, 0, CD) > power(QUIET, 8000, 0, CD));
});

test("test_dsd_modulator_noise_lifts_the_top_of_the_band", () => {
  assert.ok(power(QUIET, 18000, 0, DSD) > power(QUIET, 18000, 0, CD));
});

test("test_dsd_modulator_noise_leaves_the_bottom_of_the_band_alone", () => {
  assert.equal(power(QUIET, 8000, 0, DSD), power(QUIET, 8000, 0, CD));
});

test("test_the_envelope_scales_power_by_its_db", () => {
  assert.ok(...near(dbOf(power({ ...QUIET, env: 10 }, 4000, 1, CD)) - dbOf(power(QUIET, 4000, 1, CD)), 10, EPS));
});

test("test_the_two_channels_pan_a_note_apart", () => {
  assert.notEqual(power(NOTE, 1000, 0, CD), power(NOTE, 1000, 1, CD));
});

test("test_jitter_is_the_same_for_the_same_column_row_and_channel", () => {
  assert.equal(jitter({ idx: 12 }, 40, 1), jitter({ idx: 12 }, 40, 1));
});

test("test_jitter_differs_between_channels", () => {
  assert.notEqual(jitter({ idx: 12 }, 40, 0), jitter({ idx: 12 }, 40, 1));
});

//: Column, row and channel triples jitter is drawn at.
const JITTER = [
  { idx: 0, row: 0, ch: 0 },
  { idx: 17, row: 300, ch: 1 },
  { idx: 5999, row: 119, ch: 5 },
];

for (const row of JITTER) {
  test(`test_jitter_stays_within_three_db_at_column_${row.idx}_row_${row.row}`, () => {
    assert.ok(Math.abs(dbOf(jitter({ idx: row.idx }, row.row, row.ch))) <= 3);
  });
}

test("test_a_kick_lands_every_fifth_column", () => {
  assert.deepEqual(columnsWhere(0, 12, (c) => c.kick), [0, 5, 10]);
});

test("test_a_hat_lands_two_columns_before_each_kick", () => {
  assert.deepEqual(columnsWhere(0, 12, (c) => c.hat), [3, 8]);
});

test("test_the_chord_holds_for_two_point_four_seconds", () => {
  assert.deepEqual(mockColumn(23, SRC).notes, mockColumn(0, SRC).notes);
});

test("test_the_chord_changes_after_two_point_four_seconds", () => {
  assert.notDeepEqual(mockColumn(24, SRC).notes, mockColumn(0, SRC).notes);
});

test("test_the_chords_cycle_after_four", () => {
  assert.deepEqual(mockColumn(96, SRC).notes, mockColumn(0, SRC).notes);
});

test("test_apodizing_events_cluster_in_the_opening_ninety_columns", () => {
  assert.ok(columnsWhere(0, 90, (c) => c.apod > 0).length > columnsWhere(90, 180, (c) => c.apod > 0).length);
});

test("test_a_column_holds_each_row_for_both_channels_and_their_sum", () => {
  assert.equal(mockColumn(0, SRC).db.length, 6);
});

test("test_a_column_row_is_the_power_at_that_row_with_jitter", () => {
  const c = mockColumn(7, SRC);
  assert.ok(...near(c.db[1], dbOf(power(c, 500, 0, CD) * jitter(c, 1, 0)), 1e-4));
});

test("test_the_sum_row_averages_the_two_channels_power", () => {
  const c = mockColumn(7, SRC);
  assert.ok(...near(c.db[4], dbOf((10 ** (c.db[0] / 10) + 10 ** (c.db[2] / 10)) / 2), 1e-4));
});

test("test_one_channel_spectrum_reads_that_channel", () => {
  assert.notEqual(binLevels(mockColumn(7, SRC), [1000], "0", CD)[0], binLevels(mockColumn(7, SRC), [1000], "1", CD)[0]);
});

test("test_the_sum_spectrum_lies_between_the_two_channels", () => {
  const c = mockColumn(7, SRC);
  const [l, r, sum] = ["0", "1", "sum"].map((ch) => binLevels(c, [1000], ch, CD)[0]);
  assert.ok((sum - l) * (sum - r) < 0);
});

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
  assert.deepEqual(ticksOf(60, 200, false), [[0, -60], [0.25, -45], [0.5, -30], [0.75, -15], [1, 0]]);
});

test("test_a_thirty_second_window_ticks_every_10_seconds", () => {
  assert.deepEqual(ticksOf(30, 200, false).map(([, v]) => v), [-30, -20, -10, 0]);
});

test("test_a_window_over_two_minutes_reads_in_minutes", () => {
  assert.equal(timeTicks(3000, 4000, 10, false).inMin, true);
});

test("test_a_two_minute_window_reads_in_seconds", () => {
  assert.equal(timeTicks(1200, 4000, 10, false).inMin, false);
});

test("test_a_five_minute_window_ticks_every_minute", () => {
  assert.deepEqual(ticksOf(300, 400, false).map(([, v]) => v), [-5, -4, -3, -2, -1, 0]);
});

test("test_the_all_window_ticks_from_track_start_and_ends_on_the_track_position", () => {
  assert.deepEqual(ticksOf(40, 40, true), [[0, 0], [0.25, 10], [0.5, 20], [0.75, 30], [1, 40]]);
});

test("test_a_tick_crowding_the_right_edge_gives_way_to_the_end_label", () => {
  assert.deepEqual(ticksOf(42, 42, true).map(([, v]) => v), [0, 10, 20, 30, 42]);
});

test("test_a_tick_clear_of_the_right_edge_stays", () => {
  assert.deepEqual(ticksOf(44, 44, true).map(([, v]) => v), [0, 10, 20, 30, 40, 44]);
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
  assert.deepEqual(Array.from(rampLut([[0, 0, 0], [30, 0, 0], [60, 0, 0], [255, 0, 0]]).subarray(510, 513)), [60, 0, 0]);
});

test("test_the_ramp_blends_each_channel_on_its_own", () => {
  assert.deepEqual(Array.from(rampLut([[0, 100, 200], [200, 100, 0]]).subarray(51 * 3, 51 * 3 + 3)), [40, 100, 160]);
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
