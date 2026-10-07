// Store suite for hqptuner/static/store/meter/feed.js: initMeterFeed() holds the METER feed open while metering runs
// and closed while it is off, meterFeedOpen saying which, and a repeated call registers nothing further. A `geometry`
// event sets meterGeometry; each `frame` event's base64 bins come back from takeMeterFrames() in dBFS, once, carrying
// the geometry they arrived under. A frame reaches the spectrogram from the feed only by leaving the queue there: pushed
// out past 6000 ms of queued frame time, or flushed when the engine leaves playing.
//
// Metering and playback reach the store at the wire, through fresh /api/status objects on engineStatus, written by the
// poll seam (tests/js/support/apodpolls.js); the feed is the EventSource fake (tests/js/support/eventsource.js). The
// spectrogram is read through its exported cells under the 30 s window, where every frame of 25 ms or more closes a
// slice of its own, so a drawn cell's width names the frame it came from. The feed's clock is the fixed one
// initMeterFeed() is handed; the queue's cap runs on the frame time each frame carries, so no case waits on a clock.
//
// The effects initMeterFeed() and initSpectrogram() register outlive each test, so every case first switches metering
// off, which closes any feed an earlier case left open, then starts a fresh log of opened streams and starts a new
// playing track, which clears the spectrogram and switches metering on.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/feed.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  initMeterFeed,
  meterFeedOpen,
  meterGeometry,
  takeMeterFrames,
} from "../../../../hqptuner/static/store/meter/feed.js";
import { initSpectrogram, spectrogramCells } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { STOPPED, newTrack, poll } from "../../support/apodpolls.js";

const clock = () => 0;

const GEO = { nyquist: 24000, channels: 1, bins: 4 };
const GEO_96K = { nyquist: 48000, channels: 1, bins: 4 };

/**
 * One `frame` event's payload: a channel per base64 bins string, at a fixed peak and rms.
 *
 * @param {number} ms
 * @param {...string} bins
 */
const frame = (ms, ...bins) => ({ channels: bins.map((b) => ({ peak: -3.1, rms: -9.4, bins: b })), ms });

/**
 * One mono `frame` event per frame time, oldest first.
 *
 * @param {...number} times
 */
const send = (...times) => times.forEach((ms) => lastStream()?.emit("frame", frame(ms, "AQAGADwAWAI=")));

/** The frame time of each slice the spectrogram draws, oldest first. */
const drawn = () => spectrogramCells.value.map((/** @type {{ ms: number }} */ c) => c.ms);

/** The frame time of each frame takeMeterFrames() hands back, oldest first. */
const taken = () => takeMeterFrames().map((f) => f.ms);

beforeEach(() => {
  engineStatus.value = { metering: false };
  useEventSource();
  useStorage();
  setApodWindow("30");
  initApodHistory();
  initSpectrogram();
  newTrack();
  poll();
  initMeterFeed(clock);
  takeMeterFrames();
});

test("test_metering_on_holds_one_stream_open_on_the_feed", () => {
  assert.deepEqual([lastStream()?.url, lastStream()?.closed], ["/api/meter/feed", false]);
});

test("test_metering_switched_off_closes_the_stream", () => {
  engineStatus.value = { metering: false };
  assert.equal(lastStream()?.closed, true);
});

test("test_meter_feed_open_is_true_while_metering_runs_and_false_once_it_is_switched_off", () => {
  const open = meterFeedOpen.value;
  engineStatus.value = { metering: false };
  assert.deepEqual([open, meterFeedOpen.value], [true, false]);
});

test("test_a_second_init_opens_no_second_stream", () => {
  const first = lastStream();
  initMeterFeed(clock);
  assert.deepEqual([lastStream() === first, lastStream()?.closed], [true, false]);
});

test("test_a_geometry_event_sets_the_nyquist_channel_count_and_bin_count", () => {
  lastStream()?.emit("geometry", { nyquist: 96000, channels: 2, bins: 1025 });
  assert.deepEqual(meterGeometry.value, { nyquist: 96000, channels: 2, bins: 1025 });
});

test("test_a_frames_base64_bins_come_back_in_dbfs_per_channel", () => {
  lastStream()?.emit("frame", frame(21.333, "AQAGADwAWAI=", "AgAUAJABCgA="));
  assert.deepEqual(
    takeMeterFrames().map((f) => f.channels.map((c) => Array.from(c.bins))),
    [
      [
        [-0.5, -3, -30, -300],
        [-1, -10, -200, -5],
      ],
    ],
  );
});

test("test_taken_frames_are_not_taken_again", () => {
  lastStream()?.emit("frame", frame(21.333, "AQAGADwAWAI="));
  assert.deepEqual([takeMeterFrames().length, takeMeterFrames().length], [1, 0]);
});

test("test_frames_past_6000_ms_of_queued_frame_time_leave_the_queue_oldest_first", () => {
  send(2500, 1000, 3000, 2000);
  assert.deepEqual(taken(), [1000, 3000, 2000]);
});

test("test_each_taken_frame_carries_the_geometry_it_arrived_under", () => {
  lastStream()?.emit("geometry", GEO);
  send(1000);
  lastStream()?.emit("geometry", GEO_96K);
  send(1000);
  assert.deepEqual(
    takeMeterFrames().map((f) => f.geo),
    [GEO, GEO_96K],
  );
});

// --- into the spectrogram ------------------------------------------------------------------------------------------

test("test_a_frame_event_queues_its_frame_and_adds_nothing_to_the_spectrogram", () => {
  lastStream()?.emit("geometry", GEO);
  send(1000);
  assert.deepEqual([drawn(), taken()], [[], [1000]]);
});

test("test_frames_past_6000_ms_of_queued_frame_time_reach_the_spectrogram_oldest_first_once_each", () => {
  lastStream()?.emit("geometry", GEO);
  send(1000, 2000, 3000, 4000);
  assert.deepEqual(drawn(), [1000, 2000, 3000]);
});

test("test_the_engine_leaving_playing_sends_every_queued_frame_to_the_spectrogram_and_none_to_the_loop", () => {
  lastStream()?.emit("geometry", GEO);
  send(1000);
  takeMeterFrames();
  send(2000, 3000);
  poll({ state: STOPPED });
  assert.deepEqual([drawn(), taken()], [[2000, 3000], []]);
});
