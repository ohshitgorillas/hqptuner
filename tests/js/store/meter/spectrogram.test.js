// Suite for store/meter/spectrogram.js: slices built from decoded feed bins as 480 rows of bytes per channel and
// summed, each placed in playback by its frames' own stamps, starting at its first frame's `at` and ending where its
// last frame ends, the history emptied by a frame that begins a break and by a track change, which the poll seam
// (tests/js/support/apodpolls.js) makes; and the range of the history drawn, spectrogramRange: none while the playhead
// is null, nothing ending after the playhead, nothing starting before the window that ends there, its edge the one
// playhead, and the range moving as the playhead and the history move. Which channel a slice is drawn in is the
// raster's to choose, and which slices fall in a window is sliceRange's; neither is tested here.
//
// Frames reach the store through addSpectrumFrame as whole MeterFrames, as the feed store hands them over: `at` and
// `ms` playback, ms, read from the hand-written tables in tests/js/support/meterfeed.js, whose lengths span the
// measured 17.3 to 23.2 ms and change mid-table. Every case's first frame begins a break, so each starts on an empty
// history. The playhead is the exported signal the meter loop publishes, written here directly: no loop runs, so
// nothing else moves it and no case waits on a clock. The window is the widest, 300 s, far wider than any table,
// unless a case says otherwise. The store is reached through its module namespace, so a store without the range reads
// as one that exposes none rather than failing to load.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as spectrogramStore from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";
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
/**
 * One slice of the history: `at` and `ms` playback, ms.
 *
 * @typedef {{ at: number, ms: number, nyquist: number, channels: ArrayLike<number>[], sum: ArrayLike<number> }}
 *   DrawnSlice
 */
/**
 * The range the store exposes: slices[lo..hi) drawn, `edge` playback, ms, or null.
 *
 * @typedef {{ slices: DrawnSlice[], lo: number, hi: number, edge: number | null }} DrawnRange
 */

const { addSpectrumFrame, initSpectrogram } = spectrogramStore;

const NYQUIST = 24000;
const BINS = 1025;
const GEO = { rate: 48000, nyquist: NYQUIST, channels: 2, bins: BINS };
const SILENT = -120;

// A two-bin mono geometry, for the cases about where slices stand rather than what they hold.
const TINY = { rate: 48000, nyquist: NYQUIST, channels: 1, bins: 2 };
const TINY_LEVEL = [{ peak: -6, rms: -12, bins: new Float32Array(2).fill(-30) }];

// The widest window, as wide as the history, and a narrower one, as the store's identifiers, s; and the narrower one's
// width, playback, ms.
const WIDEST = "300";
const NARROW = "60";
const NARROW_MS = 60000;

// A playhead between two of CONTIGUOUS_MS's frame ends, inside its thirteenth frame: playback, ms.
const BETWEEN_ENDS_MS = CONTIGUOUS_MS_CHANGE + 7;

// How many of CONTIGUOUS_MS's frames the store holds before the rest run on from them.
const FIRST_PART = 12;

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
 * Hand the store one MeterFrame per row, none beginning a break, so they run on from the frames before them.
 *
 * @param {MsStamp[]} rows
 */
function feedOn(rows) {
  rows.forEach(({ at, ms }) => addSpectrumFrame({ channels: TINY_LEVEL, at, ms, break: false, geo: TINY }));
}

/**
 * The range the store exposes with the playhead at `edge`, or undefined where the store exposes none.
 *
 * @param {number | null} edge  playback, ms
 * @returns {DrawnRange | undefined}
 */
function rangeAt(edge) {
  playhead.value = edge;
  const store = /** @type {{ spectrogramRange?: { value: DrawnRange } }} */ (spectrogramStore);
  return store.spectrogramRange?.value;
}

/**
 * The slices drawn with the playhead at `edge`, oldest first.
 *
 * @param {number | null} edge  playback, ms
 * @returns {DrawnSlice[]}
 */
function drawnAt(edge) {
  const range = rangeAt(edge);
  return range ? range.slices.slice(range.lo, range.hi) : [];
}

/**
 * Where a slice ends: playback, ms.
 *
 * @param {DrawnSlice | undefined} slice
 */
const end = (slice) => (slice ? slice.at + slice.ms : NaN);

/**
 * Where the newest slice drawn with the playhead at `edge` ends: playback, ms.
 *
 * @param {number} edge  playback, ms
 */
const newestEnd = (edge) => end(drawnAt(edge).at(-1));

/**
 * [ok, message] for one assert.ok: whether there are at least two slices and each starts where the one before it ends.
 *
 * @param {DrawnSlice[]} slices
 * @returns {[boolean, string]}
 */
const contiguous = (slices) => [
  slices.length > 1 && slices.slice(1).every((c, i) => c.at === end(slices[i])),
  `expected end-to-end slices, got ${slices.map((c) => `${c.at}+${c.ms}`).join(", ")}`,
];

/**
 * [ok, message] for one assert.ok: whether there is a slice and every slice ends where one of `rows` ends, which is
 * where the next row starts, or at `last` for the last row.
 *
 * @param {DrawnSlice[]} slices
 * @param {MsStamp[]} rows
 * @param {number} last  playback, ms
 * @returns {[boolean, string]}
 */
function onFrameEnds(slices, rows, last) {
  const ends = new Set([...rows.slice(1).map((r) => r.at), last]);
  return [
    slices.length > 0 && slices.every((c) => ends.has(end(c))),
    `expected every slice to end where a frame ends, got ends ${slices.map(end).join(", ")}`,
  ];
}

/**
 * The rows of channel `which`, or of the sum, of each slice drawn with the playhead at `edge`, oldest first.
 *
 * @param {number | "sum"} which
 * @param {number} edge  playback, ms
 * @returns {ArrayLike<number>[]}
 */
const rowsAt = (which, edge) =>
  drawnAt(edge).map((s) => (which === "sum" ? s.sum : (s.channels[which] ?? new Uint8Array(0))));

/**
 * [ok, message] for one assert.ok: whether there are at least two values and each is larger than the one before it.
 *
 * @param {Array<number | undefined>} values
 * @returns {[boolean, string]}
 */
const rising = (values) => [
  values.length > 1 && values.slice(1).every((v, i) => (v ?? NaN) > (values[i] ?? NaN)),
  `expected rising values, got ${values.join(", ")}`,
];

/**
 * [ok, message] for one assert.ok: whether there are at least two values and the first two are the same.
 *
 * @param {string[]} values
 * @returns {[boolean, string]}
 */
const firstTwoAlike = (values) => [
  values.length > 1 && values[0] === values[1],
  `expected the first two alike, got ${values.join(" | ")}`,
];

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
  assert.ok(...rising(rowsAt(0, FORTY_MS_END).map((rows) => rows[0])));
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
  assert.ok(...firstTwoAlike(rowsAt("sum", 80).map((sum) => `${sum[120]},${sum[301]}`)));
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
  assert.ok(...firstTwoAlike(rowsAt(0, 50).map((rows) => `${rows[0]}`)));
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
  feedOn(CONTIGUOUS_MS.slice(FIRST_AFTER_TRACK));
  assert.equal(drawnAt(CONTIGUOUS_MS_END)[0]?.at, CONTIGUOUS_MS[FIRST_AFTER_TRACK]?.at);
});

// --- the range drawn -----------------------------------------------------------------------------------------------

test("test_nothing_is_drawn_while_the_playhead_is_null", () => {
  feed(CONTIGUOUS_MS);
  const range = rangeAt(null);
  assert.equal(range ? range.hi - range.lo : NaN, 0);
});

test("test_no_slice_drawn_ends_after_the_playhead", () => {
  feed(CONTIGUOUS_MS);
  assert.ok(newestEnd(CONTIGUOUS_MS_CHANGE) <= CONTIGUOUS_MS_CHANGE);
});

// The window ends at the playhead and is NARROW_MS wide: a playhead NARROW_MS after the frame lengths change leaves
// every slice from before the change outside it.
test("test_no_slice_drawn_starts_before_the_window_that_ends_at_the_playhead", () => {
  setApodWindow(NARROW);
  feed(CONTIGUOUS_MS);
  assert.ok((drawnAt(CONTIGUOUS_MS_CHANGE + NARROW_MS)[0]?.at ?? -Infinity) >= CONTIGUOUS_MS_CHANGE);
});

test("test_the_edge_is_the_playhead_even_between_two_slice_ends", () => {
  feed(CONTIGUOUS_MS);
  assert.equal(rangeAt(BETWEEN_ENDS_MS)?.edge, BETWEEN_ENDS_MS);
});

test("test_the_playhead_moving_on_brings_later_slices_into_the_range", () => {
  feed(CONTIGUOUS_MS);
  const before = newestEnd(CONTIGUOUS_MS_CHANGE);
  assert.ok(newestEnd(CONTIGUOUS_MS_END) > before);
});

test("test_slices_closing_under_a_standing_playhead_join_the_range", () => {
  feed(CONTIGUOUS_MS.slice(0, FIRST_PART));
  const before = newestEnd(CONTIGUOUS_MS_END);
  feedOn(CONTIGUOUS_MS.slice(FIRST_PART));
  assert.ok(newestEnd(CONTIGUOUS_MS_END) > before);
});
