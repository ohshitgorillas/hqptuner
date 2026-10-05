// Store suite for hqptuner/static/store/meter/feed.js: initMeterFeed() holds the METER feed open while metering runs
// and closed while it is off, and a repeated call registers nothing further. A `geometry` event sets meterGeometry; each
// `frame` event's base64 bins come back from takeMeterFrames() in dBFS, once, and the queue keeps the newest frames.
//
// Metering reaches the store at the wire, through fresh /api/status objects on engineStatus; the feed is the EventSource
// fake (tests/js/support/eventsource.js). The feed's clock is the fixed one initMeterFeed() is handed. The effect
// initMeterFeed() registers outlives each test, so every case first switches metering off, which closes any feed an
// earlier case left open, then starts a fresh log of opened streams and switches metering on.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/feed.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { initMeterFeed, meterGeometry, takeMeterFrames } from "../../../../hqptuner/static/store/meter/feed.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";

const clock = () => 0;

/**
 * One `frame` event's payload: a channel per base64 bins string, at a fixed peak and rms.
 *
 * @param {number} ms
 * @param {...string} bins
 */
const frame = (ms, ...bins) => ({ channels: bins.map((b) => ({ peak: -3.1, rms: -9.4, bins: b })), ms });

beforeEach(() => {
  engineStatus.value = { metering: false };
  useEventSource();
  engineStatus.value = { metering: true };
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
  lastStream()?.emit("frame", frame(21.333, "AQY8/w==", "AhTICg=="));
  assert.deepEqual(
    takeMeterFrames().map((f) => f.channels.map((c) => Array.from(c.bins))),
    [
      [
        [-0.5, -3, -30, -127.5],
        [-1, -10, -100, -5],
      ],
    ],
  );
});

test("test_taken_frames_are_not_taken_again", () => {
  lastStream()?.emit("frame", frame(21.333, "AQY8/w=="));
  assert.deepEqual([takeMeterFrames().length, takeMeterFrames().length], [1, 0]);
});

test("test_forty_queued_frames_keep_only_the_newest_thirty_two", () => {
  for (let ms = 1; ms <= 40; ms++) lastStream()?.emit("frame", frame(ms, "AQY8/w=="));
  assert.deepEqual(
    takeMeterFrames().map((f) => f.ms),
    Array.from({ length: 32 }, (_, i) => i + 9),
  );
});
