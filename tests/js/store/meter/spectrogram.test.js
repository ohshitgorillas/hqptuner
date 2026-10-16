// Suite for store/meter/spectrogram.js: slices built from decoded feed bins as 480 rows of bytes per channel and
// summed, each placed in playback by its frames' own stamps, starting at its first frame's `at` and ending where its
// last frame ends, the history emptied by a frame that begins a break and by a track change, which the poll seam
// (tests/js/support/apodpolls.js) makes; and the cells drawn, the slices within the window that ends at the one
// playhead, none while the playhead is null.
//
// Frames reach the store through addSpectrumFrame as whole MeterFrames, as the feed store hands them over: `at` and
// `ms` playback, ms, read from the hand-written tables in tests/js/support/meterfeed.js, whose lengths span the
// measured 17.3 to 23.2 ms and change mid-table. Every case's first frame begins a break, so each starts on an empty
// history. The playhead is the exported signal the meter loop publishes, written here directly: no loop runs, so
// nothing else moves it and no case waits on a clock. The window is the widest, 300 s, far wider than any table.
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
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow, setMeterChannel } from "../../../../hqptuner/static/store/ui/prefs.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll, setPollStep } from "../../support/apodpolls.js";
import {
  CONTIGUOUS_MS,
  CONTIGUOUS_MS_CHANGE,
  CONTIGUOUS_MS_END,
  EARLIER_MS,
  LATER_MS,
  LATER_MS_END,
} from "../../support/meterfeed.js";

/** @typedef {import("../../support/meterfeed.js").MsStamp} MsStamp */
/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").FrameGeometry} FrameGeometry */
/** @typedef {{ at: number, ms: number, slices: ArrayLike<number>[] }} DrawnCell */

const ROWS = 480;
const NYQUIST = 24000;
const BINS = 1025;
const GEO = { rate: 48000, nyquist: NYQUIST, channels: 2, bins: BINS };
const SILENT = -120;

// A two-bin mono geometry, for the cases about where slices stand rather than what they hold.
const TINY = { rate: 48000, nyquist: NYQUIST, channels: 1, bins: 2 };
const TINY_LEVEL = [{ peak: -6, rms: -12, bins: new Float32Array(2).fill(-30) }];

// The widest window, as wide as the history, s.
const WIDEST = "300";

/**
 * Every bin at `db`.
 *
 * @param {number} db
 */
const flat = (db) => new Float32Array(BINS).fill(db);

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
 * One decoded channel carrying `bins`.
 *
 * @param {Float32Array} bins
 */
const channel = (bins) => ({ peak: -6, rms: -12, bins });

/**
 * Hand the store one MeterFrame per row, the first beginning a break, every one carrying `channels` under `geo`.
 *
 * @param {MsStamp[]} rows
 * @param {Array<{ peak: number, rms: number, bins: Float32Array }>} [channels]
 * @param {FrameGeometry} [geo]
 */
function feed(rows, channels = TINY_LEVEL, geo = TINY) {
  rows.forEach(({ at, ms }, i) => addSpectrumFrame({ channels, at, ms, break: i === 0, geo }));
}

/**
 * The cells drawn with the playhead at `edge`.
 *
 * @param {number | null} edge  playback, ms
 * @returns {DrawnCell[]}
 */
function drawnAt(edge) {
  playhead.value = edge;
  return /** @type {DrawnCell[]} */ (spectrogramCells.value);
}

/**
 * Where a cell ends: playback, ms.
 *
 * @param {DrawnCell | undefined} cell
 */
const end = (cell) => (cell ? cell.at + cell.ms : NaN);

/**
 * [ok, message] for one assert.ok: whether there are at least two cells and each starts where the one before it ends.
 *
 * @param {DrawnCell[]} cells
 * @returns {[boolean, string]}
 */
const contiguous = (cells) => [
  cells.length > 1 && cells.slice(1).every((c, i) => c.at === end(cells[i])),
  `expected end-to-end cells, got ${cells.map((c) => `${c.at}+${c.ms}`).join(", ")}`,
];

/**
 * [ok, message] for one assert.ok: whether there is a cell and every cell ends where one of `rows` ends, which is where
 * the next row starts, or at `last` for the last row.
 *
 * @param {DrawnCell[]} cells
 * @param {MsStamp[]} rows
 * @param {number} last  playback, ms
 * @returns {[boolean, string]}
 */
function onFrameEnds(cells, rows, last) {
  const ends = new Set([...rows.slice(1).map((r) => r.at), last]);
  return [
    cells.length > 0 && cells.every((c) => ends.has(end(c))),
    `expected every cell to end where a frame ends, got ends ${cells.map(end).join(", ")}`,
  ];
}

/**
 * The bytes each drawn slice holds in the picked channel, oldest first, with the playhead at `edge`.
 *
 * @param {string} pick
 * @param {number} edge  playback, ms
 */
function pickedRows(pick, edge) {
  setMeterChannel(pick);
  return drawnAt(edge).map((c) => c.slices[0]);
}

// One 40 ms stretch of playback per level the level cases feed, each starting where the one before it ended.
const FORTY_MS = [
  { at: 0, ms: 40 },
  { at: 40, ms: 40 },
  { at: 80, ms: 40 },
];
const FORTY_MS_END = 120;

// Five 5 ms frames, each starting where the one before it ended, and the level each carries, dBFS.
const FIVE_MS = [
  { at: 0, db: -10 },
  { at: 5, db: -20 },
  { at: 10, db: -10 },
  { at: 15, db: -20 },
  { at: 20, db: -10 },
];

beforeEach(() => {
  useStorage();
  setApodWindow(WIDEST);
  setMeterChannel("sum");
  initApodHistory();
  initSpectrogram();
  setPollStep(1);
  newTrack();
  poll();
  playhead.value = null;
});

// --- the slice's rows ----------------------------------------------------------------------------------------------

// A row counts down from full scale, so a deeper level keeps a larger value.
test("test_levels_30_130_and_200_db_down_keep_rows_apart_and_in_order", () => {
  [-30, -130, -200].forEach((db, i) => {
    const row = FORTY_MS[i] ?? { at: NaN, ms: NaN };
    addSpectrumFrame({ channels: [channel(flat(db)), channel(flat(db))], ...row, break: i === 0, geo: GEO });
  });
  const kept = pickedRows("0", FORTY_MS_END).map((slice) => slice[0]);
  assert.deepEqual(
    [...new Set(kept)].sort((a, b) => (a ?? 0) - (b ?? 0)),
    kept,
  );
});

// A -12 dB tone in one channel beside a silent one averages to -15.01 dB in power: the second slice carries that
// level in both channels.
test("test_the_sum_rows_are_the_power_average_across_channels", () => {
  const both = tones([6025, 15070], -15.01);
  addSpectrumFrame({
    channels: [channel(tones([6025], -12)), channel(tones([15070], -12))],
    at: 0,
    ms: 40,
    break: true,
    geo: GEO,
  });
  addSpectrumFrame({ channels: [channel(both), channel(both)], at: 40, ms: 40, break: false, geo: GEO });
  const [split, alike] = pickedRows("sum", 80).map((sum) => [sum[120], sum[301]]);
  assert.deepEqual(split, alike);
});

// Three frames at -10 dB and two at -20 average to -11.94 dB in power, where their dB mean is -14: the second slice
// carries the power average.
test("test_the_frames_a_slice_covers_fold_as_their_power_average", () => {
  FIVE_MS.forEach(({ at, db }, i) =>
    addSpectrumFrame({ channels: [channel(flat(db)), channel(flat(db))], at, ms: 5, break: i === 0, geo: GEO }),
  );
  addSpectrumFrame({
    channels: [channel(flat(-11.94)), channel(flat(-11.94))],
    at: 25,
    ms: 25,
    break: false,
    geo: GEO,
  });
  const [folded, level] = pickedRows("0", 50).map((slice) => slice[0]);
  assert.equal(folded, level);
});

// --- where a slice stands ------------------------------------------------------------------------------------------

test("test_the_oldest_slice_starts_at_its_first_frames_stamp", () => {
  feed(CONTIGUOUS_MS);
  assert.equal(drawnAt(CONTIGUOUS_MS_END)[0]?.at, CONTIGUOUS_MS[0]?.at);
});

test("test_each_slice_starts_where_the_one_before_it_ends", () => {
  feed(CONTIGUOUS_MS);
  assert.ok(...contiguous(drawnAt(CONTIGUOUS_MS_END)));
});

test("test_every_slice_ends_where_one_of_its_frames_ends", () => {
  feed(CONTIGUOUS_MS);
  assert.ok(...onFrameEnds(drawnAt(CONTIGUOUS_MS_END), CONTIGUOUS_MS, CONTIGUOUS_MS_END));
});

// --- a break -------------------------------------------------------------------------------------------------------

test("test_after_a_break_the_oldest_slice_starts_at_the_frame_that_began_it", () => {
  feed(CONTIGUOUS_MS);
  feed(LATER_MS);
  assert.equal(drawnAt(LATER_MS_END)[0]?.at, LATER_MS[0]?.at);
});

test("test_a_break_back_to_earlier_playback_leaves_no_slice_from_before_it", () => {
  feed(CONTIGUOUS_MS);
  feed(EARLIER_MS);
  assert.ok((drawnAt(CONTIGUOUS_MS_END).at(-1)?.at ?? Infinity) < (CONTIGUOUS_MS[0]?.at ?? -Infinity));
});

// --- a track change ------------------------------------------------------------------------------------------------

// The first frame after the track change, by its place in CONTIGUOUS_MS: the two before it close a slice and the one
// before it is still in hand when the track changes.
const FIRST_AFTER_TRACK = 3;

// A gapless track change: the frames run on contiguous across it, so no break marks it.
test("test_after_a_track_change_the_oldest_slice_starts_at_the_first_frame_after_it", () => {
  feed(CONTIGUOUS_MS.slice(0, FIRST_AFTER_TRACK));
  newTrack();
  CONTIGUOUS_MS.slice(FIRST_AFTER_TRACK).forEach(({ at, ms }) =>
    addSpectrumFrame({ channels: TINY_LEVEL, at, ms, break: false, geo: TINY }),
  );
  assert.equal(drawnAt(CONTIGUOUS_MS_END)[0]?.at, CONTIGUOUS_MS[FIRST_AFTER_TRACK]?.at);
});

// --- the right edge ------------------------------------------------------------------------------------------------

test("test_nothing_is_drawn_while_the_playhead_is_null", () => {
  feed(CONTIGUOUS_MS);
  assert.equal(drawnAt(null).length, 0);
});

test("test_no_slice_drawn_ends_after_the_playhead", () => {
  feed(CONTIGUOUS_MS);
  assert.ok(end(drawnAt(CONTIGUOUS_MS_CHANGE).at(-1)) <= CONTIGUOUS_MS_CHANGE);
});

// --- the cells drawn -----------------------------------------------------------------------------------------------

// Stored slices for visibleCells, each SLICE_MS long, laid end to end from playback 0.
const SLICE_MS = 300;
const STARTS = [0, 300, 600, 900];
const AFTER_ALL = 1200;
const WIDE_SPAN = 30000;

/**
 * One stored slice starting at `at`, every row of it marked by `mark`.
 *
 * @param {number} at  playback, ms
 * @param {number} ms  playback, ms
 * @param {number} mark
 */
const slice = (at, ms, mark) => ({
  at,
  ms,
  nyquist: NYQUIST,
  channels: [new Uint8Array(ROWS).fill(mark), new Uint8Array(ROWS).fill(mark + 1)],
  sum: new Uint8Array(ROWS).fill(mark + 2),
});

// The slices at STARTS, marked 10, 20, 30 and 40, whose sums read 12, 22, 32 and 42.
const STORED = STARTS.map((at, i) => slice(at, SLICE_MS, 10 * (i + 1)));

test("test_the_newest_cell_is_the_newest_slice_ending_by_the_edge", () => {
  const cells = visibleCells(STORED, WIDE_SPAN, "sum", 600);
  assert.equal(cells.at(-1)?.slices[0]?.[0], 22);
});

test("test_the_oldest_cell_is_the_oldest_slice_inside_the_window_ending_at_the_edge", () => {
  const cells = visibleCells(STORED, SLICE_MS, "sum", 900);
  assert.equal(cells[0]?.slices[0]?.[0], 32);
});

test("test_a_cell_is_as_wide_as_the_playback_its_slice_covers", () => {
  assert.deepEqual(
    visibleCells([slice(0, 232.2, 0)], WIDE_SPAN, "sum", AFTER_ALL).map((c) => c.ms),
    [232.2],
  );
});

test("test_a_cell_draws_the_picked_channel", () => {
  assert.equal(visibleCells([slice(0, 200, 40)], WIDE_SPAN, "1", AFTER_ALL)[0]?.slices[0]?.[0], 41);
});

test("test_a_cell_falls_back_to_the_sum_where_its_slice_lacks_the_picked_channel", () => {
  assert.equal(visibleCells([slice(0, 200, 40)], WIDE_SPAN, "5", AFTER_ALL)[0]?.slices[0]?.[0], 42);
});
