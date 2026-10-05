// Suite for store/meter/spectrogram.js: slices built from decoded feed bins as 480 rows of bytes per channel and
// summed, closed once the frames folded into each cover 200 ms of frame time, laid along the time axis by that frame
// time, and cleared by a track change and a geometry change.
//
// Frames reach the store through addSpectrumFrame with the decoded channel shape; a track change through the poll
// seam (tests/js/support/apodpolls.js), which empties the apodizing history and the slices with it. Slicing runs on the
// frame time each frame carries, so no case waits on a clock.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  addSpectrumFrame,
  initSpectrogram,
  spectrogramCells,
  visibleCells,
} from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow, setMeterChannel } from "../../../../hqptuner/static/store/ui/prefs.js";
import { useStorage } from "../../support/storage.js";
import { newTrack } from "../../support/apodpolls.js";

const ROWS = 480;
const NYQUIST = 24000;
const BINS = 1025;
const GEO = { nyquist: NYQUIST, channels: 2, bins: BINS };
const SILENT = -120;

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
 * The loudest row of a slice and its byte.
 *
 * @param {ArrayLike<number>} bytes
 */
function loudest(bytes) {
  const all = Array.from(bytes);
  const byte = Math.min(...all);
  return { row: all.indexOf(byte), byte };
}

beforeEach(() => {
  useStorage();
  setApodWindow("30");
  setMeterChannel("sum");
  initApodHistory();
  initSpectrogram();
  newTrack();
});

// --- the slice's rows ----------------------------------------------------------------------------------------------

const LEVELS = [
  { name: "a_level_inside_the_byte_range", db: -30, byte: 60 },
  { name: "a_level_past_the_last_byte", db: -150, byte: 255 },
];

for (const { name, db, byte } of LEVELS) {
  test(`test_${name}_reads_as_480_rows_of_its_byte`, () => {
    feed(5, 40, [channel(flat(db)), channel(flat(db))]);
    assert.deepEqual(rows("0"), [new Uint8Array(ROWS).fill(byte)]);
  });
}

const TONES = [
  { name: "a_tone_near_a_quarter_of_nyquist", hz: 6025, db: -12, row: 120, byte: 24 },
  { name: "a_tone_near_five_eighths_of_nyquist", hz: 15070, db: -30, row: 301, byte: 60 },
];

for (const { name, hz, db, row, byte } of TONES) {
  test(`test_${name}_lands_in_the_row_its_frequency_falls_in_at_its_level`, () => {
    feed(5, 40, [channel(tone(hz, db)), channel(flat(SILENT))]);
    assert.deepEqual(rows("0").map(loudest), [{ row, byte }]);
  });
}

test("test_the_sum_rows_are_the_power_average_across_channels", () => {
  feed(5, 40, [channel(tone(6025, -12)), channel(tone(15070, -12))]);
  assert.deepEqual(
    rows("sum").map((sum) => [sum[120], sum[301]]),
    [[30, 30]],
  );
});

test("test_the_frames_a_slice_covers_fold_as_their_power_average", () => {
  for (const db of [-10, -20, -10, -20, -10]) addSpectrumFrame(GEO, [channel(flat(db)), channel(flat(db))], 40);
  assert.deepEqual(rows("0"), [new Uint8Array(ROWS).fill(24)]);
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

// --- clearing ------------------------------------------------------------------------------------------------------

test("test_a_track_change_clears_the_slices_and_the_slice_in_hand", () => {
  const level = [channel(flat(-30)), channel(flat(-30))];
  feed(2, 120, level);
  feed(3, 60, level);
  newTrack();
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
