// Suite for store/meter/spectrogram.js: where a closed slice puts each level on the frequency axis. A slice's row r
// of 480 is the band from r / 480 to (r + 1) / 480 of the slice's Nyquist, as the raster reads it. Each row holds
// the loudest level among the bins whose frequencies fall in its band, and a row whose band holds no bin holds the
// level of the bin nearest the band's center, so no row is left without a level.
//
// Bin k of a geometry with `bins` bins stands at k / (bins - 1) of the Nyquist, as the feed's frames are laid out. No
// case puts a level on a bin that sits on a band's edge: at 1025 bins those are the multiples of 32, at 2049 bins
// the multiples of 64, at 65 bins the even ones. A row is a byte counting down from full scale at STEP_DB a byte,
// the encoding the raster reads (tests/js/lib/spectroraster.test.js), and every level here is a whole number of
// steps.
//
// Each case hands the store one 40 ms frame carrying its levels, beginning a break, then a second, silent one after it,
// and reads the first slice drawn with the playhead where the second ends.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram-bands.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as spectrogramStore from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll, setPollStep } from "../../support/apodpolls.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").FrameGeometry} FrameGeometry */
/**
 * The range the store exposes: slices[lo..hi) drawn.
 *
 * @typedef {{ slices: { channels: ArrayLike<number>[] }[], lo: number, hi: number }} DrawnRange
 */

const { addSpectrumFrame, initSpectrogram } = spectrogramStore;

const NYQUIST = 24000;

// The measured geometry, more bins than rows; a finer one, with four or five bins to a band; and a sparse one with
// fewer bins than rows, so most bands hold none.
const FULL = { rate: 48000, nyquist: NYQUIST, channels: 1, bins: 1025 };
const FINE = { rate: 48000, nyquist: NYQUIST, channels: 1, bins: 2049 };
const SPARSE = { rate: 48000, nyquist: NYQUIST, channels: 1, bins: 65 };

// dB a row's byte counts down from full scale.
const STEP_DB = 1.2;

// Levels, dBFS: the one a case looks for, a quieter one beside it, and the floor every other bin sits at.
const LOUD = -12;
const QUIET = -36;
const SILENT = -120;

// The first frame, the one read, and the silent one that follows it: playback, ms.
const FIRST = { at: 0, ms: 40 };
const SECOND = { at: 40, ms: 40 };
const SECOND_END = 80;

const WIDEST = "300";

/**
 * A row's byte for `db`.
 *
 * @param {number} db
 */
const byteOf = (db) => Math.round(-db / STEP_DB);

/**
 * `geo`'s bins, all silent except each bin index in `levels` at its level, dBFS.
 *
 * @param {FrameGeometry} geo
 * @param {Record<number, number>} levels
 */
function binsWith(geo, levels) {
  const bins = new Float32Array(geo.bins).fill(SILENT);
  for (const [k, db] of Object.entries(levels)) bins[Number(k)] = db;
  return bins;
}

/**
 * The rows of the first slice drawn after the store is handed one frame carrying `bins` under `geo` and a silent one
 * after it, or no rows where nothing is drawn.
 *
 * @param {FrameGeometry} geo
 * @param {Float32Array} bins
 * @returns {ArrayLike<number>}
 */
function sliceRows(geo, bins) {
  const silent = new Float32Array(geo.bins).fill(SILENT);
  addSpectrumFrame({ channels: [{ peak: -6, rms: -12, bins }], ...FIRST, break: true, geo });
  addSpectrumFrame({ channels: [{ peak: -6, rms: -12, bins: silent }], ...SECOND, break: false, geo });
  playhead.value = SECOND_END;
  const store = /** @type {{ spectrogramRange?: { value: DrawnRange } }} */ (spectrogramStore);
  const range = store.spectrogramRange?.value;
  return range?.slices[range.lo]?.channels[0] ?? new Uint8Array(0);
}

/**
 * The indices of the rows holding `db`.
 *
 * @param {ArrayLike<number>} rows
 * @param {number} db
 */
const rowsHolding = (rows, db) => Array.from(rows).flatMap((b, r) => (b === byteOf(db) ? [r] : []));

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

// --- each level at its own frequency -------------------------------------------------------------------------------

// Bin 1020 stands at 1020/1024 of the Nyquist, inside row 478's band (478/480 to 479/480).
// Breaks when: rows are filled at the trace's placement, row j at j/479 of the Nyquist, which stands bin 1020 in row 477.
test("test_a_tone_near_the_nyquist_stands_only_in_the_row_whose_band_holds_its_frequency", () => {
  const rows = sliceRows(FULL, binsWith(FULL, { 1020: LOUD }));
  assert.deepEqual(rowsHolding(rows, LOUD), [478]);
});

// Bin 2 stands at 2/1024 of the Nyquist, inside row 0's band (0 to 1/480).
// Breaks when: rows are filled at the trace's placement, row j at j/479 of the Nyquist, which stands bin 2 in row 1.
test("test_a_tone_near_0_hz_stands_only_in_the_row_whose_band_holds_its_frequency", () => {
  const rows = sliceRows(FULL, binsWith(FULL, { 2: LOUD }));
  assert.deepEqual(rowsHolding(rows, LOUD), [0]);
});

// --- the loudest bin in a band -------------------------------------------------------------------------------------

// At 2049 bins, row 479's band, 2043.73 to 2048 bins, holds bins 2044 and 2045, both at LOUD; the trace's placement
// stands row 479 at 2048, nearest bins 2046 to 2048.
// Breaks when: a band's bins are summed in power (3 dB over LOUD), or rows are filled at the trace's placement.
test("test_two_bins_at_one_level_in_a_band_leave_its_row_at_that_level", () => {
  const rows = sliceRows(FINE, binsWith(FINE, { 2044: LOUD, 2045: LOUD }));
  assert.equal(rows[479], byteOf(LOUD));
});

// --- a band that holds no bin --------------------------------------------------------------------------------------

// At 65 bins, row 468's band, 62.4 to 62.53 bins, holds none; its center, 62.47, is nearest bin 62, where row 468 of
// the trace's placement, 62.53, is nearest bin 63.
// Breaks when: an empty band takes the bin nearest j/479 of the Nyquist, blends its neighbors, or is left at the floor.
test("test_a_row_near_the_nyquist_whose_band_holds_no_bin_holds_the_bin_nearest_its_center", () => {
  const rows = sliceRows(SPARSE, binsWith(SPARSE, { 62: LOUD, 63: QUIET }));
  assert.equal(rows[468], byteOf(LOUD));
});

// At 65 bins, row 11's band, 1.47 to 1.6 bins, holds none; its center, 1.53, is nearest bin 2, where row 11 of the
// trace's placement, 1.47, is nearest bin 1.
// Breaks when: an empty band takes the bin nearest j/479 of the Nyquist, blends its neighbors, or is left at the floor.
test("test_a_row_near_0_hz_whose_band_holds_no_bin_holds_the_bin_nearest_its_center", () => {
  const rows = sliceRows(SPARSE, binsWith(SPARSE, { 1: QUIET, 2: LOUD }));
  assert.equal(rows[11], byteOf(LOUD));
});
