// Suite for store/meter/spectrogram.js: slices built from decoded feed bins as 480 rows of bytes per channel and
// summed, closed into the history once the frames folded into each cover 25 ms of frame time, kept for 300 s, laid
// along the time axis by that frame time, and cleared by a track change and a geometry change; and the apodizing
// strip's right edge, carried forward on that frame time from the newest bin less the output delay.
//
// Frames reach the store through addSpectrumFrame with the decoded channel shape; a track change through the poll
// seam (tests/js/support/apodpolls.js), which empties the apodizing history and the slices with it. Each case starts
// under the 300 s window. Slicing runs on the frame time each frame carries, so no case waits on a clock.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  addSpectrumFrame,
  initSpectrogram,
  spectrogramCells,
  spectrogramEnd,
  stripEnd,
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

// The widest window, as wide as the history.
const FINE = "300";

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
  for (const db of levels) feed(1, 40, [channel(flat(db)), channel(flat(db))]);
  return rows("0").map((slice) => slice[0]);
}

beforeEach(() => {
  useStorage();
  setApodWindow(FINE);
  setMeterChannel("sum");
  initApodHistory();
  initSpectrogram();
  setPollStep(1);
  newTrack();
  poll();
});

// --- the slice's rows ----------------------------------------------------------------------------------------------

test("test_a_flat_level_reads_as_480_rows_alike", () => {
  feed(1, 40, [channel(flat(-30)), channel(flat(-30))]);
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
    feed(1, 40, [channel(tone(hz, db)), channel(flat(SILENT))]);
    assert.deepEqual(rows("0").map(loudestRow), [row]);
  });
}

// A -12 dB tone in one channel beside a silent one averages to -15.01 dB in power: the second slice carries that
// level in both channels.
test("test_the_sum_rows_are_the_power_average_across_channels", () => {
  feed(1, 40, [channel(tone(6025, -12)), channel(tone(15070, -12))]);
  const both = tones([6025, 15070], -15.01);
  feed(1, 40, [channel(both), channel(both)]);
  const [split, alike] = rows("sum").map((sum) => [sum[120], sum[301]]);
  assert.deepEqual(split, alike);
});

// Three frames at -10 dB and two at -20 average to -11.94 dB in power, where their dB mean is -14: the second slice
// carries the power average.
test("test_the_frames_a_slice_covers_fold_as_their_power_average", () => {
  for (const db of [-10, -20, -10, -20, -10]) addSpectrumFrame(GEO, [channel(flat(db)), channel(flat(db))], 5);
  feed(1, 25, [channel(flat(-11.94)), channel(flat(-11.94))]);
  const [folded, level] = rows("0").map((slice) => slice[0]);
  assert.equal(folded, level);
});

// --- closing a slice -----------------------------------------------------------------------------------------------

const PACES = [
  { name: "frames_at_sixty_a_second", count: 4, ms: 16.7, closed: [33.4, 33.4] },
  { name: "frames_longer_than_half_a_slice", count: 4, ms: 15, closed: [30, 30] },
];

for (const { name, count, ms, closed } of PACES) {
  test(`test_${name}_close_a_slice_once_they_cover_25_ms_of_frame_time`, () => {
    feed(count, ms, [channel(flat(-30)), channel(flat(-30))]);
    assert.deepEqual(widths(), closed);
  });
}

test("test_a_history_past_300_s_still_draws_its_newest_300_s", () => {
  feedTiny(1610, 187.5);
  assert.deepEqual(drawn(), { count: 1600, ms: 300000 });
});

// --- the end -------------------------------------------------------------------------------------------------------

test("test_the_end_is_the_frame_time_of_the_closed_slices", () => {
  feed(3, 150, [channel(flat(-30)), channel(flat(-30))]);
  assert.equal(spectrogramEnd.value, 450);
});

test("test_the_end_keeps_counting_the_slices_dropped_off_the_front", () => {
  feedTiny(1610, 187.5);
  assert.equal(spectrogramEnd.value, 301875);
});

test("test_a_track_change_brings_the_end_back_to_0_before_it_grows_again", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  feed(3, 150, level);
  newTrack();
  feed(1, 150, level);
  assert.equal(spectrogramEnd.value, 150);
});

// --- clearing ------------------------------------------------------------------------------------------------------

test("test_a_track_change_clears_the_slices_and_the_slice_in_hand", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  feed(2, 120, level);
  feed(1, 20, level);
  newTrack();
  poll();
  feed(1, 30, level);
  assert.deepEqual(widths(), [30]);
});

test("test_a_geometry_change_clears_the_slice_in_hand_and_keeps_the_closed_slices", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  feed(2, 120, level);
  feed(1, 20, level);
  feed(1, 30, level, GEO_96K);
  assert.deepEqual(widths(), [120, 120, 30]);
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

// --- the apodizing strip's right edge ------------------------------------------------------------------------------
// Each case starts on a track whose first bin ends 2 s in, with no output delay reported and no slice closed since.

test("test_the_strip_edge_moves_on_with_the_frame_time_the_spectrogram_closes", () => {
  feedTiny(25, 40);
  assert.equal(stripEnd.value, 3000);
});

test("test_the_strip_edge_runs_the_reported_output_delay_behind_the_newest_bin", () => {
  newTrack({ output_delay: "500000" });
  poll({ output_delay: "500000" });
  assert.equal(stripEnd.value, 1500);
});

test("test_a_poll_far_from_the_carried_strip_edge_moves_it_to_the_poll", () => {
  feedTiny(25, 40);
  setPollStep(5);
  poll();
  assert.equal(stripEnd.value, 7000);
});
