// Suite for store/meter/spectrogram.js: slices built from decoded feed bins as 480 rows of bytes per channel and
// summed, closed into a fine history once the frames folded into each cover 25 ms of frame time and into a coarse one
// once they cover 200 ms, laid along the time axis by that frame time, and cleared by a track change and a geometry
// change. A window spanning at most 300 s draws the fine history, a wider one the coarse.
//
// Frames reach the store through addSpectrumFrame with the decoded channel shape; a track change through the poll
// seam (tests/js/support/apodpolls.js), which empties the apodizing history and the slices with it. Each case starts
// with 301 s of playback in the apodizing history, so the whole-history window spans past 300 s and draws the coarse
// history. Slicing runs on the frame time each frame carries, so no case waits on a clock.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  addSpectrumFrame,
  initSpectrogram,
  spectrogramCells,
  spectrogramEnd,
  spectrogramTier,
  visibleCells,
} from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow, setMeterChannel } from "../../../../hqptuner/static/store/ui/prefs.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll, setPollStep } from "../../support/apodpolls.js";

const ROWS = 480;
const NYQUIST = 24000;
const BINS = 1025;
const GEO = { nyquist: NYQUIST, channels: 2, bins: BINS };
const GEO_96K = { nyquist: 48000, channels: 2, bins: BINS };
const SILENT = -120;

// A window of exactly 300 s, and the whole-history window over the 301 s each case starts with.
const FINE = "300";
const COARSE = "all";

/**
 * Every bin at `db`.
 *
 * @param {number} db
 */
const flat = (db) => new Float32Array(BINS).fill(db);

/**
 * Every bin silent except the one nearest `hz`, at `db`.
 *
 * @param {number} hz
 * @param {number} db
 */
function tone(hz, db) {
  const bins = flat(SILENT);
  bins[Math.round((hz / NYQUIST) * (BINS - 1))] = db;
  return bins;
}

/**
 * One decoded channel carrying `bins`.
 *
 * @param {Float32Array} bins
 */
const channel = (bins) => ({ peak: -6, rms: -12, bins });

/**
 * `count` frames of `ms` frame time each, every one carrying `channels`.
 *
 * @param {number} count
 * @param {number} ms
 * @param {Array<{ peak: number, rms: number, bins: Float32Array }>} channels
 * @param {typeof GEO} [geo]
 */
function feed(count, ms, channels, geo = GEO) {
  for (let i = 0; i < count; i++) addSpectrumFrame(geo, channels, ms);
}

/**
 * The bytes each drawn slice holds in the picked channel, oldest first.
 *
 * @param {string} pick
 * @returns {ArrayLike<number>[]}
 */
function rows(pick) {
  setMeterChannel(pick);
  return spectrogramCells.value.map((/** @type {{ slices: ArrayLike<number>[] }} */ c) => c.slices[0]);
}

/** The frame time each drawn slice covers, to 0.1 ms, oldest first. */
const widths = () => spectrogramCells.value.map((/** @type {{ ms: number }} */ c) => Math.round(c.ms * 10) / 10);

/**
 * The frame time each slice drawn under `window` covers, to 0.1 ms, oldest first.
 *
 * @param {string} window
 */
function widthsAt(window) {
  setApodWindow(window);
  return widths();
}

/** How many slices are drawn and the frame time they cover together. */
function drawn() {
  /** @type {number[]} */
  const all = widths();
  return { count: all.length, ms: all.reduce((sum, ms) => sum + ms, 0) };
}

// A two-bin mono geometry, for the cases that close thousands of slices.
const TINY = { nyquist: NYQUIST, channels: 1, bins: 2 };

/**
 * `count` frames of `ms` frame time each in the two-bin mono geometry.
 *
 * @param {number} count
 * @param {number} ms
 */
const feedTiny = (count, ms) => feed(count, ms, [channel(new Float32Array(2).fill(-30))], TINY);

/**
 * Every bin silent except the one nearest each of `hzs`, at `db`.
 *
 * @param {number[]} hzs
 * @param {number} db
 */
function tones(hzs, db) {
  const bins = flat(SILENT);
  for (const hz of hzs) bins[Math.round((hz / NYQUIST) * (BINS - 1))] = db;
  return bins;
}

/**
 * The loudest row of a slice. A row counts down from full scale, so the loudest holds the smallest value.
 *
 * @param {ArrayLike<number>} bytes
 */
function loudestRow(bytes) {
  const all = Array.from(bytes);
  return all.indexOf(Math.min(...all));
}

/**
 * The value the first row of each drawn slice holds, after one slice per level of `levels` is fed as flat stereo
 * frames, oldest first.
 *
 * @param {number[]} levels  dBFS
 */
function rowValues(levels) {
  for (const db of levels) feed(5, 40, [channel(flat(db)), channel(flat(db))]);
  return rows("0").map((slice) => slice[0]);
}

beforeEach(() => {
  useStorage();
  setApodWindow(COARSE);
  setMeterChannel("sum");
  setPollStep(301);
  initApodHistory();
  initSpectrogram();
  newTrack();
  poll();
});

// --- the slice's rows ----------------------------------------------------------------------------------------------

test("test_a_flat_level_reads_as_480_rows_alike", () => {
  feed(5, 40, [channel(flat(-30)), channel(flat(-30))]);
  assert.deepEqual(
    rows("0").map((slice) => [slice.length, new Set(Array.from(slice)).size]),
    [[ROWS, 1]],
  );
});

// A row counts down from full scale, so a deeper level keeps a larger value.
test("test_levels_30_130_and_200_db_down_keep_rows_apart_and_in_order", () => {
  const kept = rowValues([-30, -130, -200]);
  assert.deepEqual(
    [...new Set(kept)].sort((a, b) => a - b),
    kept,
  );
});

test("test_a_level_below_300_db_down_reads_as_300_db_down", () => {
  const [floor, below] = rowValues([-300, -400]);
  assert.equal(below, floor);
});

const TONES = [
  { name: "a_tone_near_a_quarter_of_nyquist", hz: 6025, db: -12, row: 120 },
  { name: "a_tone_near_five_eighths_of_nyquist", hz: 15070, db: -30, row: 301 },
];

for (const { name, hz, db, row } of TONES) {
  test(`test_${name}_lands_in_the_row_its_frequency_falls_in`, () => {
    feed(5, 40, [channel(tone(hz, db)), channel(flat(SILENT))]);
    assert.deepEqual(rows("0").map(loudestRow), [row]);
  });
}

// A -12 dB tone in one channel beside a silent one averages to -15.01 dB in power: the second slice carries that
// level in both channels.
test("test_the_sum_rows_are_the_power_average_across_channels", () => {
  feed(5, 40, [channel(tone(6025, -12)), channel(tone(15070, -12))]);
  const both = tones([6025, 15070], -15.01);
  feed(5, 40, [channel(both), channel(both)]);
  const [split, alike] = rows("sum").map((sum) => [sum[120], sum[301]]);
  assert.deepEqual(split, alike);
});

// Three frames at -10 dB and two at -20 average to -11.94 dB in power, where their dB mean is -14: the second slice
// carries the power average.
test("test_the_frames_a_slice_covers_fold_as_their_power_average", () => {
  for (const db of [-10, -20, -10, -20, -10]) addSpectrumFrame(GEO, [channel(flat(db)), channel(flat(db))], 40);
  feed(5, 40, [channel(flat(-11.94)), channel(flat(-11.94))]);
  const [folded, level] = rows("0").map((slice) => slice[0]);
  assert.equal(folded, level);
});

// --- closing a slice -----------------------------------------------------------------------------------------------

const PACES = [
  { name: "frames_at_sixty_a_second", count: 30, ms: 16.7, closed: [200.4, 200.4] },
  { name: "frames_longer_than_half_a_slice", count: 5, ms: 120, closed: [240, 240] },
];

for (const { name, count, ms, closed } of PACES) {
  test(`test_${name}_close_a_slice_once_they_cover_200_ms_of_frame_time`, () => {
    feed(count, ms, [channel(flat(-30)), channel(flat(-30))]);
    assert.deepEqual(widths(), closed);
  });
}

test("test_one_second_of_frames_at_sixty_a_second_closes_33_4_ms_fine_slices_and_200_4_ms_coarse_slices", () => {
  feed(60, 16.7, [channel(flat(-30)), channel(flat(-30))]);
  assert.deepEqual([widthsAt(FINE), widthsAt(COARSE)], [Array(30).fill(33.4), Array(5).fill(200.4)]);
});

test("test_a_fine_history_past_300_s_still_draws_its_newest_300_s", () => {
  setApodWindow(FINE);
  feedTiny(1610, 187.5);
  assert.deepEqual(drawn(), { count: 1600, ms: 300000 });
});

// --- the tier drawn ------------------------------------------------------------------------------------------------

const TIERS = [
  { name: "a_window_of_exactly_300_s", window: FINE, tier: "fine" },
  { name: "a_window_spanning_301_s", window: COARSE, tier: "coarse" },
];

for (const { name, window, tier } of TIERS) {
  test(`test_${name}_draws_the_${tier}_tier`, () => {
    setApodWindow(window);
    assert.equal(spectrogramTier.value, tier);
  });
}

// --- the end -------------------------------------------------------------------------------------------------------

const ENDS = [
  { tier: "fine", window: FINE, end: 450 },
  { tier: "coarse", window: COARSE, end: 300 },
];

for (const { tier, window, end } of ENDS) {
  test(`test_the_end_under_the_${tier}_tier_is_the_frame_time_of_its_closed_slices`, () => {
    feed(3, 150, [channel(flat(-30)), channel(flat(-30))]);
    setApodWindow(window);
    assert.equal(spectrogramEnd.value, end);
  });
}

test("test_the_end_keeps_counting_the_fine_slices_dropped_off_the_front", () => {
  setApodWindow(FINE);
  feedTiny(1610, 187.5);
  assert.equal(spectrogramEnd.value, 301875);
});

test("test_a_track_change_brings_the_end_back_to_0_before_it_grows_again", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  setApodWindow(FINE);
  feed(3, 150, level);
  newTrack();
  feed(1, 150, level);
  assert.equal(spectrogramEnd.value, 150);
});

// --- clearing ------------------------------------------------------------------------------------------------------

test("test_a_track_change_clears_the_slices_and_the_slice_in_hand", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  feed(2, 120, level);
  feed(3, 60, level);
  newTrack();
  poll();
  feed(4, 50, level);
  assert.deepEqual(widths(), [200]);
});

test("test_a_geometry_change_clears_the_slice_in_hand_and_keeps_the_closed_slices", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  feed(2, 120, level);
  feed(3, 60, level);
  feed(4, 50, level, { nyquist: 48000, channels: 2, bins: BINS });
  assert.deepEqual(widths(), [240, 200]);
});

test("test_a_geometry_change_drops_the_fine_and_the_coarse_slice_in_hand", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  feed(1, 20, level);
  feed(1, 190, level, GEO_96K);
  feed(1, 15, level, GEO_96K);
  assert.deepEqual([widthsAt(FINE), widthsAt(COARSE)], [[190], [205]]);
});

// --- the cells drawn -----------------------------------------------------------------------------------------------

/**
 * One stored slice of `ms` frame time, every row of it marked by `mark`.
 *
 * @param {number} ms
 * @param {number} mark
 */
const slice = (ms, mark) => ({
  ms,
  nyquist: NYQUIST,
  channels: [new Uint8Array(ROWS).fill(mark), new Uint8Array(ROWS).fill(mark + 1)],
  sum: new Uint8Array(ROWS).fill(mark + 2),
});

test("test_the_newest_slices_that_fit_the_span_are_drawn_oldest_first", () => {
  const cells = visibleCells([slice(300, 10), slice(300, 20), slice(300, 30)], 700, "sum");
  assert.deepEqual(
    cells.map((c) => c.slices[0][0]),
    [22, 32],
  );
});

test("test_a_cell_is_as_wide_as_the_frame_time_its_slice_covers", () => {
  assert.deepEqual(
    visibleCells([slice(232.2, 0)], 30000, "sum").map((c) => c.ms),
    [232.2],
  );
});

test("test_a_cell_draws_the_picked_channel", () => {
  assert.equal(visibleCells([slice(200, 40)], 30000, "1")[0].slices[0][0], 41);
});

test("test_a_cell_falls_back_to_the_sum_where_its_slice_lacks_the_picked_channel", () => {
  assert.equal(visibleCells([slice(200, 40)], 30000, "5")[0].slices[0][0], 42);
});
