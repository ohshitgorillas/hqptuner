// Store suite for hqptuner/static/store/meter/feed.js: initMeterFeed() holds the meter feed open while metering runs
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
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";

const { clock } = fakeClock();

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

test("test_metering_switched_off_closes_the_stream", () => {
  engineStatus.value = { metering: false };
  assert.equal(lastStream()?.closed, true);
});

test("test_meter_feed_open_is_true_while_metering_runs", () => {
  assert.equal(meterFeedOpen.value, true);
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
  takeMeterFrames();
  assert.deepEqual(takeMeterFrames(), []);
});

test("test_a_frame_keeps_the_geometry_it_arrived_under_when_a_new_one_follows", () => {
  lastStream()?.emit("geometry", GEO);
  send(1000);
  lastStream()?.emit("geometry", GEO_96K);
  send(1000);
  assert.deepEqual(takeMeterFrames().map((f) => f.geo)[0], GEO);
});

test("test_a_frame_arriving_under_a_new_geometry_carries_the_new_geometry", () => {
  lastStream()?.emit("geometry", GEO);
  send(1000);
  lastStream()?.emit("geometry", GEO_96K);
  send(1000);
  assert.deepEqual(takeMeterFrames().map((f) => f.geo)[1], GEO_96K);
});
