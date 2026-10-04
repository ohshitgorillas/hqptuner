// Store suite for hqptuner/static/store/faceplate/drawers/source.js: what the Source drawer's meter shows over the v1
// stream. Which of the meter or a no-stream line shows (metering off, nothing playing, the feed silent while it plays,
// a silent DSD source with the matrix off), the linear frequency axis ending at the source Nyquist, the channel
// switch's choices and pick, the time window both charts share and its axis, and the apodizing strip's events per pixel
// column.
//
// The stream reaches the store at the wire: METER feed events through the EventSource fake
// (tests/js/support/eventsource.js), playback through fresh /api/status objects, the apodizing history through the poll
// seam (tests/js/support/apodpolls.js). The feed's clock is the one openMeterFeed() is handed, so silence is a clock
// step, never a wait. Prefs are written through their own setters over a fake storage.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-source.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { sourceMeter, stripEvents } from "../../../../hqptuner/static/store/faceplate/drawers/source.js";
import { engineStatus, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow, setMeterChannel, setMeterRange } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { feed, setPollStep } from "../../support/apodpolls.js";

const QUIET_MS = 2000; // the feed's silence threshold, store/meter/feed.js

let now = 0;
const clock = () => now;

/**
 * Open a fresh feed over one /api/status object, and send the geometry event when one is given.
 *
 * @param {{ state?: string, metering?: boolean, metadata?: Record<string, string>, geometry?: object }} [o]
 */
function stream({ state = "2", metering = true, metadata = { samplerate: "44100" }, geometry } = {}) {
  closeMeterFeed();
  useEventSource();
  now = 0;
  engineStatus.value = { status: { state }, metering, metadata };
  openMeterFeed(clock);
  if (geometry) lastStream()?.emit("geometry", geometry);
}

/** @param {number} nyquist @param {number} channels */
const geo = (nyquist, channels) => ({ nyquist, channels, centres: [1000, 2000] });

beforeEach(() => {
  useStorage();
  matrixConfig.value = null;
  setApodWindow("60");
  setMeterChannel("sum");
  setMeterRange("90");
  setPollStep(1);
  stream();
});

// --- which shows ---------------------------------------------------------------------------------------------------

test("test_a_playing_source_with_frames_arriving_shows_the_meter", () => {
  assert.equal(sourceMeter().state, "live");
});

test("test_metering_switched_off_shows_the_off_line", () => {
  stream({ metering: false });
  assert.equal(sourceMeter().state, "off");
});

test("test_nothing_playing_shows_the_idle_line", () => {
  stream({ state: "0" });
  assert.equal(sourceMeter().state, "idle");
});

test("test_a_playing_pcm_source_whose_feed_went_quiet_shows_the_silent_line", () => {
  now = QUIET_MS;
  assert.equal(sourceMeter().state, "silent");
});

test("test_a_quiet_dsd_source_with_the_matrix_off_shows_the_matrix_line", () => {
  stream({ metadata: { samplerate: "2822400" } });
  now = QUIET_MS;
  assert.equal(sourceMeter().state, "matrix");
});

test("test_a_quiet_dsd_source_with_the_matrix_engaged_shows_the_silent_line", () => {
  matrixConfig.value = { fields: [{ name: "enabled", type: "checkbox", value: true }] };
  stream({ metadata: { sdm: "1", samplerate: "2822400" } });
  now = QUIET_MS;
  assert.equal(sourceMeter().state, "silent");
});

// --- frequency axis ------------------------------------------------------------------------------------------------

test("test_the_frequency_axis_ends_at_the_source_nyquist", () => {
  stream({ geometry: geo(96000, 2) });
  assert.equal(sourceMeter().freq.nyq.khz, 96);
});

test("test_the_frequency_axis_ends_at_a_cd_nyquist_before_any_geometry", () => {
  assert.equal(sourceMeter().freq.nyq.khz, 22.05);
});

test("test_the_frequency_axis_runs_from_zero_at_the_bottom_to_nyquist_on_top", () => {
  stream({ geometry: geo(48000, 2) });
  const { ticks, nyq } = sourceMeter().freq;
  assert.deepEqual([ticks.find((t) => t.khz === 0)?.at, nyq.at], [1, 0]);
});

test("test_the_frequency_axis_is_linear", () => {
  stream({ geometry: geo(48000, 2) });
  const at = sourceMeter().freq.ticks.find((t) => t.khz === 20)?.at;
  assert.equal(at === undefined ? NaN : +at.toFixed(4), 0.5833);
});

// --- channel -------------------------------------------------------------------------------------------------------

test("test_the_channel_switch_offers_each_reported_channel_and_the_sum", () => {
  stream({ geometry: geo(48000, 6) });
  assert.deepEqual([...sourceMeter().channels].sort(), ["0", "1", "2", "3", "4", "5", "sum"]);
});

test("test_a_picked_channel_the_source_carries_is_drawn", () => {
  stream({ geometry: geo(48000, 6) });
  setMeterChannel("5");
  assert.equal(sourceMeter().channel, "5");
});

test("test_a_picked_channel_the_source_lacks_falls_back_to_the_sum", () => {
  stream({ geometry: geo(48000, 2) });
  setMeterChannel("5");
  assert.equal(sourceMeter().channel, "sum");
});

// --- range and window ----------------------------------------------------------------------------------------------

test("test_the_colour_span_is_the_picked_range", () => {
  setMeterRange("200");
  assert.equal(sourceMeter().range, 200);
});

test("test_a_timed_window_spans_its_seconds", () => {
  setApodWindow("120");
  assert.equal(sourceMeter().span, 120000);
});

test("test_the_all_window_spans_the_playback_the_history_holds", () => {
  initApodHistory();
  feed([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  setApodWindow("all");
  assert.equal(sourceMeter().span, 10000);
});

test("test_the_all_window_axis_ends_on_the_playback_since_the_track_began", () => {
  initApodHistory();
  feed([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  setApodWindow("all");
  assert.equal(sourceMeter().time.ticks.at(-1)?.value, 10);
});

test("test_a_timed_window_axis_counts_back_from_its_span_to_now", () => {
  setApodWindow("30");
  assert.deepEqual([sourceMeter().time.ticks[0]?.value, sourceMeter().time.ticks.at(-1)?.value], [-30, 0]);
});

test("test_a_window_past_two_minutes_reads_its_axis_in_minutes", () => {
  setApodWindow("300");
  assert.equal(sourceMeter().time.ticks[0]?.value, -5);
});

// --- the apodizing strip -------------------------------------------------------------------------------------------

/** @param {number} ms @param {number} n @param {number} at */
const bin = (ms, n, at) => ({ ms, n, at });

test("test_a_bins_events_land_under_the_playback_it_observed", () => {
  const bins = [bin(1000, 0, 1000), bin(1000, 2, 2000)];
  assert.deepEqual(Array.from(stripEvents(bins, 2000, 4)), [0, 0, 1, 1]);
});

test("test_the_strip_ends_on_the_newest_bin", () => {
  const bins = [bin(1000, 4, 1000), bin(1000, 0, 2000), bin(1000, 0, 3000)];
  assert.deepEqual(Array.from(stripEvents(bins, 2000, 2)), [0, 0]);
});

test("test_a_lone_event_in_a_wide_interval_still_marks_the_strip", () => {
  assert.deepEqual(Array.from(stripEvents([bin(4000, 1, 4000)], 4000, 4)), [1, 1, 1, 1]);
});

test("test_a_denser_interval_draws_hotter_than_a_sparser_one", () => {
  const strip = stripEvents([bin(1000, 2, 1000), bin(1000, 4, 2000)], 2000, 2);
  assert.ok(strip[1] > strip[0]);
});

test("test_a_burst_caps_at_the_strips_hottest_colour", () => {
  assert.deepEqual(Array.from(stripEvents([bin(1000, 100, 1000)], 1000, 2)), [3, 3]);
});

test("test_an_empty_history_draws_a_blank_strip", () => {
  assert.deepEqual(Array.from(stripEvents([], 60000, 4)), [0, 0, 0, 0]);
});

test("test_a_window_wider_than_the_history_leaves_its_head_blank", () => {
  assert.deepEqual(Array.from(stripEvents([bin(1000, 3, 1000)], 2000, 2)), [0, 3]);
});
