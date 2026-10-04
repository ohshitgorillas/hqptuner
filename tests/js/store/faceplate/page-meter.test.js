// Store suite for hqptuner/static/store/faceplate/page/meter.js: what the page's Source section shows over the v1
// stream. Whether the meter or a no-stream line shows, the page's own Range setting both the spectrum's span and the
// levels' floor, the spectrum trace over the newest slice with its fall and its held peaks, the frequency axis to the
// source Nyquist, the two level bars and their readings, and whether the section is slim.
//
// The stream reaches the store at the wire: METER feed events through the EventSource fake
// (tests/js/support/eventsource.js), playback through fresh /api/status objects, a track change through the poll seam
// (tests/js/support/apodpolls.js), which empties the apodizing history and the spectrogram's slices with it. Five feed
// frames make one slice (store/meter/spectrogram.js), so every slice here is five frames of the same bands. The
// spectrum's hold runs on the playback the slices cover, so its release is a count of frames, never a wait. Prefs are
// written through their own setters over a fake storage; the plate through the window size the entry writes.
//
// Points and ticks are fractions of the plot: x across from 0 Hz, y down from full scale.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/page-meter.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { pageMeter } from "../../../../hqptuner/static/store/faceplate/page/meter.js";
import { engineStatus, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow, setMeterChannel, setMeterRange } from "../../../../hqptuner/static/store/ui/prefs.js";
import { setPageRange } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { newTrack } from "../../support/apodpolls.js";

const NYQUIST = 22050;
const GEO = { nyquist: NYQUIST, channels: 2, centres: [5512.5, 11025] };
const FRAMES_PER_SLICE = 5;
const FRAME_MS = 100; // one slice covers 500 ms of playback

/**
 * Open a fresh feed over one /api/status object, and send the geometry event.
 *
 * @param {{ state?: string, geometry?: object }} [o]
 */
function stream({ state = "2", geometry = GEO } = {}) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(() => 0);
  lastStream()?.emit("geometry", geometry);
}

/**
 * One feed frame: every channel at the given peak and RMS, every band at `db`.
 *
 * @param {number} db
 * @param {{ peak?: number, rms?: number, channels?: number, bands?: number }} [o]
 */
function frame(db, { peak = -6, rms = -12, channels = 2, bands = 2 } = {}) {
  const ch = { peak, rms, bands: Array.from({ length: bands }, () => db) };
  lastStream()?.emit("frame", { channels: Array.from({ length: channels }, () => ch), ms: FRAME_MS });
}

/**
 * `count` slices with every band at `db`.
 *
 * @param {number} db
 * @param {number} [count]
 */
function slices(db, count = 1) {
  for (let i = 0; i < count * FRAMES_PER_SLICE; i++) frame(db);
}

/** @param {number} v */
const r4 = (v) => +v.toFixed(4);

/**
 * The trace's y at the band at half the Nyquist, or NaN when the trace has no such point.
 *
 * @param {"disp" | "peak"} which
 */
function yAtHalf(which) {
  const pt = pageMeter().trace[which].find(([x]) => r4(x) === 0.5);
  return pt ? r4(pt[1]) : NaN;
}

beforeEach(() => {
  useStorage();
  matrixConfig.value = null;
  setApodWindow("60");
  setMeterChannel("sum");
  setMeterRange("90");
  setPageRange("90");
  viewport.value = { w: 1366, h: 1024 };
  initApodHistory();
  initSpectrogram();
  newTrack();
  stream();
});

// --- which shows ---------------------------------------------------------------------------------------------------

test("test_a_playing_source_with_frames_arriving_shows_the_meter", () => {
  assert.equal(pageMeter().state, "live");
});

test("test_nothing_playing_shows_the_idle_line", () => {
  stream({ state: "0" });
  assert.equal(pageMeter().state, "idle");
});

// --- the page's range ----------------------------------------------------------------------------------------------

test("test_the_range_is_the_pages_own_range", () => {
  setPageRange("120");
  assert.equal(pageMeter().range, 120);
});

test("test_the_drawers_range_leaves_the_pages_range_standing", () => {
  setPageRange("60");
  setMeterRange("120");
  assert.equal(pageMeter().range, 60);
});

test("test_the_db_scale_ends_at_a_60_db_range", () => {
  setPageRange("60");
  assert.equal(pageMeter().db.at(-1)?.db, -60);
});

test("test_the_db_scale_ends_at_a_120_db_range", () => {
  setPageRange("120");
  assert.equal(pageMeter().db.at(-1)?.db, -120);
});

test("test_the_db_scale_runs_from_full_scale_on_top_to_the_floor_at_the_bottom", () => {
  const { db } = pageMeter();
  assert.deepEqual([db[0]?.at, db.at(-1)?.at], [0, 1]);
});

test("test_a_band_level_sits_down_the_spectrum_by_a_60_db_range", () => {
  setPageRange("60");
  slices(-30);
  assert.equal(yAtHalf("disp"), 0.5);
});

test("test_a_band_level_sits_down_the_spectrum_by_a_120_db_range", () => {
  setPageRange("120");
  slices(-30);
  assert.equal(yAtHalf("disp"), 0.25);
});

test("test_a_level_fills_its_bar_from_a_60_db_floor", () => {
  setPageRange("60");
  frame(-90, { peak: -30 });
  assert.equal(pageMeter().levels[0]?.peak, 0.5);
});

test("test_a_level_fills_its_bar_from_a_120_db_floor", () => {
  setPageRange("120");
  frame(-90, { peak: -30 });
  assert.equal(pageMeter().levels[0]?.peak, 0.75);
});

test("test_the_rms_fills_its_bar_from_the_same_floor", () => {
  setPageRange("60");
  frame(-90, { rms: -45 });
  assert.equal(pageMeter().levels[0]?.rms, 0.25);
});

// --- the spectrum --------------------------------------------------------------------------------------------------

test("test_a_band_sits_across_the_spectrum_at_its_frequency_over_the_nyquist", () => {
  slices(-30);
  assert.deepEqual(
    pageMeter().trace.disp.map(([x]) => r4(x)),
    [0.25, 0.5],
  );
});

test("test_the_frequency_axis_ends_at_the_source_nyquist", () => {
  stream({ geometry: { nyquist: 48000, channels: 2, centres: [1000, 2000] } });
  assert.equal(pageMeter().freq.nyq.khz, 48);
});

test("test_the_frequency_axis_is_linear_across_the_spectrum", () => {
  stream({ geometry: { nyquist: 48000, channels: 2, centres: [1000, 2000] } });
  const at = pageMeter().freq.ticks.find((t) => t.khz === 20)?.at;
  assert.equal(at === undefined ? NaN : r4(at), 0.4167);
});

test("test_a_falling_band_falls_a_step_per_slice", () => {
  slices(-30);
  slices(-80);
  assert.equal(yAtHalf("disp"), r4(33 / 90));
});

test("test_a_rising_band_shows_at_once", () => {
  slices(-80);
  slices(-30);
  assert.equal(yAtHalf("disp"), r4(30 / 90));
});

test("test_a_peak_holds_while_the_band_falls_away", () => {
  slices(-20);
  slices(-80);
  assert.equal(yAtHalf("peak"), r4(20 / 90));
});

test("test_a_held_peak_decays_once_two_seconds_of_playback_pass", () => {
  slices(-20);
  slices(-80, 5);
  assert.equal(yAtHalf("peak"), r4(21 / 90));
});

test("test_the_hold_steps_through_every_slice_whenever_it_is_read", () => {
  slices(-30);
  pageMeter();
  slices(-80, 2);
  assert.equal(yAtHalf("disp"), r4(36 / 90));
});

test("test_a_new_track_lands_the_spectrum_on_its_first_slice_at_once", () => {
  slices(-30);
  pageMeter();
  newTrack();
  slices(-80);
  assert.equal(yAtHalf("disp"), r4(80 / 90));
});

// --- the levels ----------------------------------------------------------------------------------------------------

test("test_a_stereo_source_draws_two_bars", () => {
  frame(-90);
  assert.equal(pageMeter().levels.length, 2);
});

test("test_a_six_channel_source_draws_six_bars_before_any_reading", () => {
  stream({ geometry: { nyquist: NYQUIST, channels: 6, centres: [1000] } });
  assert.equal(pageMeter().levels.length, 6);
});

test("test_the_peak_reading_is_the_held_peak", () => {
  frame(-90, { peak: -6 });
  frame(-90, { peak: -30 });
  assert.equal(pageMeter().levels[0]?.peakDb, -6);
});

test("test_the_rms_reading_is_the_feeds_rms", () => {
  frame(-90, { rms: -14.5 });
  assert.equal(pageMeter().levels[1]?.rmsDb, -14.5);
});

test("test_a_bar_with_no_reading_carries_no_reading", () => {
  assert.equal(pageMeter().levels[0]?.peakDb, null);
});

// --- slim ----------------------------------------------------------------------------------------------------------

test("test_the_section_is_slim_on_a_10_inch_plate", () => {
  viewport.value = { w: 1080, h: 810 };
  assert.equal(pageMeter().slim, true);
});

test("test_the_section_is_full_on_a_13_inch_plate", () => {
  viewport.value = { w: 1366, h: 1024 };
  assert.equal(pageMeter().slim, false);
});
