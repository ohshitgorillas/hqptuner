// Behavioral suite for the mockup's meter model (hqptuner/static/model/gauges/meter.js): spectrum peak-hold decay, the
// level ballistics and hold, and the frame-loop step that clamps dt and owes
// spectrogram columns.
//
// Time is a table: every frame a test runs is a row holding its `now` (ms) and, where the step takes one, its `dt` (s).
// Nothing here reads a clock or waits on one.
//
// Run: node --test tests/js/model/gauges/meter.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { emptySpectrum, stepFrame, stepLevel, stepSpectrum } from "../../../../hqptuner/static/model/gauges/meter.js";
import { near } from "../../support/near.js";

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

// ── Spectrum ─────────────────────────────────────────────────────────────

test("test_a_jump_frame_shows_a_level_below_the_one_shown", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, level: -10 },
      { now: 100, level: -40, jump: true },
    ]).disp,
    -40,
  );
});

test("test_a_rising_level_is_shown_at_once", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, level: -40 },
      { now: 100, level: -10 },
    ]).disp,
    -10,
  );
});

test("test_a_falling_level_is_shown_falling_three_db_per_frame", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, level: -10 },
      { now: 100, level: -40 },
    ]).disp,
    -13,
  );
});

test("test_a_falling_level_is_never_shown_below_the_new_level", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, level: -10 },
      { now: 100, level: -12 },
    ]).disp,
    -12,
  );
});

test("test_the_spectrum_peak_is_stamped_when_the_shown_level_reaches_it", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, level: -40 },
      { now: 100, level: -10 },
    ]).peakAt,
    100,
  );
});

test("test_the_spectrum_peak_holds_for_two_seconds", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, ...tenHz(100, 2000, -40)]).peak, -10);
});

test("test_the_spectrum_peak_falls_one_db_per_frame_after_two_seconds", () => {
  assert.equal(spectrumAfter([{ now: 0, level: -10 }, ...tenHz(100, 2100, -40)]).peak, -11);
});

test("test_the_spectrum_peak_never_falls_below_the_shown_level", () => {
  assert.equal(
    spectrumAfter([
      { now: 0, level: -10 },
      { now: 2100, level: -10.5 },
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
