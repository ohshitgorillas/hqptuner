// Store suite for hqptuner/static/store/meter/feed.js: initMeterFeed() holds the meter feed open while metering runs
// and closed while it is off, meterFeedOpen saying which. A `geometry` event sets meterGeometry; each `frame` event's
// base64 bins come back from takeMeterFrames() in dBFS, once, carrying the geometry they arrived under.
//
// Playback time (docs/spec/timing.md): every queued frame carries `at`, where it starts in playback, and `ms`, how long
// it lasts, both in ms, read from its event's `at` and `n` samples at the geometry's rate, and `break`, whether its
// event begins a break: its `at` is not the previous event's `at + n`, tested in whole samples. The queue's depth, for
// its cap, is the playback between its first and last frames' stamps.
//
// Metering and playback reach the store at the wire, through fresh /api/status objects on engineStatus, written by the
// poll seam (tests/js/support/apodpolls.js); the feed is the EventSource fake (tests/js/support/eventsource.js), and the
// stamps it carries come from the tables in tests/js/support/meterfeed.js. The feed's clock is the fake one
// initMeterFeed() is handed, and no case advances it.
//
// The effects initMeterFeed() and initSpectrogram() register outlive each test, so every case first switches metering
// off, which closes any feed an earlier case left open, then starts a fresh log of opened streams and starts a new
// playing track, which switches metering on.
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
import { near } from "../../support/near.js";
import {
  AN_HOUR_ON_44K,
  CONTIGUOUS_44K,
  DROPPED_44K,
  ONE_SAMPLE_GAP_176K,
  ONE_SAMPLE_OVERLAP_176K,
  ONE_SECOND_APART_176K,
  ONE_SECOND_APART_44K,
  RATE_176K,
  RATE_44K,
  geometry,
  play,
} from "../../support/meterfeed.js";

const { clock } = fakeClock();

const GEO = geometry(RATE_44K);
const GEO_176K = geometry(RATE_176K);

/** One second of playback, in ms. */
const SECOND_MS = 1000;

/** How far two playback times in ms may differ and still be the same time: far under one sample at any rate. */
const SAME_MS = 1e-6;

/** The index, in CONTIGUOUS_44K, of the row DROPPED_44K leaves out. */
const DROPPED_ROW = 3;

/**
 * @typedef {{ at: number, ms: number, break: boolean, geo: unknown,
 *   channels: Array<{ bins: Float32Array }> }} QueuedFrame
 */

/** @returns {QueuedFrame[]} */
const take = () => /** @type {QueuedFrame[]} */ (/** @type {unknown} */ (takeMeterFrames()));

/** Switch metering off and on again, so the store opens a fresh feed. */
function reconnect() {
  engineStatus.value = { metering: false };
  poll();
}

/**
 * Send `geo`, then one frame per row, on the stream open now, and take what the store queued.
 *
 * @param {ReturnType<typeof geometry>} geo
 * @param {import("../../support/meterfeed.js").Stamp[]} rows
 */
function feed(geo, rows) {
  lastStream()?.emit("geometry", geo);
  play(rows);
  return take();
}

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
  lastStream()?.emit("geometry", { rate: 192000, nyquist: 96000, channels: 2, bins: 1025 });
  const geo = meterGeometry.value;
  assert.deepEqual(
    { nyquist: geo?.nyquist, channels: geo?.channels, bins: geo?.bins },
    { nyquist: 96000, channels: 2, bins: 1025 },
  );
});

test("test_a_frames_base64_bins_come_back_in_dbfs_per_channel", () => {
  lastStream()?.emit("geometry", geometry(RATE_44K, 2));
  lastStream()?.emit("frame", {
    channels: [
      { peak: -3.1, rms: -9.4, bins: "AQAGADwAWAI=" },
      { peak: -3.1, rms: -9.4, bins: "AgAUAJABCgA=" },
    ],
    at: 0,
    n: 1000,
  });
  assert.deepEqual(
    take().map((f) => f.channels.map((c) => Array.from(c.bins))),
    [
      [
        [-0.5, -3, -30, -300],
        [-1, -10, -200, -5],
      ],
    ],
  );
});

test("test_taken_frames_are_not_taken_again", () => {
  feed(GEO, CONTIGUOUS_44K);
  assert.deepEqual(take(), []);
});

test("test_a_frame_keeps_the_geometry_it_arrived_under_when_a_new_one_follows", () => {
  lastStream()?.emit("geometry", GEO);
  play(CONTIGUOUS_44K.slice(0, 1));
  lastStream()?.emit("geometry", GEO_176K);
  play(ONE_SAMPLE_GAP_176K.slice(0, 1));
  assert.deepEqual(take()[0]?.geo, GEO);
});

test("test_a_frame_arriving_under_a_new_geometry_carries_the_new_geometry", () => {
  lastStream()?.emit("geometry", GEO);
  play(CONTIGUOUS_44K.slice(0, 1));
  lastStream()?.emit("geometry", GEO_176K);
  play(ONE_SAMPLE_GAP_176K.slice(0, 1));
  assert.deepEqual(take()[1]?.geo, GEO_176K);
});

test("test_in_a_contiguous_feed_each_frame_starts_where_the_one_before_it_ends", () => {
  const frames = feed(GEO, CONTIGUOUS_44K);
  const worst = Math.max(...frames.slice(1).map((f, i) => Math.abs(f.at - (frames[i].at + frames[i].ms))));
  assert.ok(...near(worst, 0, SAME_MS));
});

test("test_events_one_second_of_samples_apart_start_one_second_of_playback_apart", () => {
  const [first, second] = feed(GEO, ONE_SECOND_APART_44K);
  assert.ok(...near((second?.at ?? NaN) - (first?.at ?? NaN), SECOND_MS, SAME_MS));
});

test("test_after_a_reconnect_at_another_rate_one_second_of_samples_is_one_second_of_playback", () => {
  feed(GEO, CONTIGUOUS_44K);
  reconnect();
  const [first, second] = feed(GEO_176K, ONE_SECOND_APART_176K);
  assert.ok(...near((second?.at ?? NaN) - (first?.at ?? NaN), SECOND_MS, SAME_MS));
});

test("test_a_frame_starts_at_the_same_playback_whether_or_not_an_event_before_it_was_dropped", () => {
  const whole = feed(GEO, CONTIGUOUS_44K);
  reconnect();
  const dropped = feed(GEO, DROPPED_44K);
  assert.ok(...near(dropped.at(-1)?.at ?? NaN, whole.at(-1)?.at ?? NaN, SAME_MS));
});

test("test_no_frame_after_the_first_of_a_contiguous_feed_begins_a_break", () => {
  const frames = feed(GEO, CONTIGUOUS_44K);
  assert.deepEqual(
    frames.slice(1).map((f) => f.break),
    CONTIGUOUS_44K.slice(1).map(() => false),
  );
});

test("test_the_frame_after_a_dropped_event_begins_a_break", () => {
  const frames = feed(GEO, DROPPED_44K);
  assert.equal(frames[DROPPED_ROW]?.break, true);
});

test("test_the_first_frame_after_a_reconnect_begins_a_break", () => {
  feed(GEO, CONTIGUOUS_44K);
  reconnect();
  assert.equal(feed(GEO, CONTIGUOUS_44K)[0]?.break, true);
});

test("test_the_frame_after_a_geometry_change_that_dropped_a_partial_stride_begins_a_break", () => {
  lastStream()?.emit("geometry", GEO);
  play(DROPPED_44K.slice(0, DROPPED_ROW));
  lastStream()?.emit("geometry", geometry(RATE_44K, 2));
  play(DROPPED_44K.slice(DROPPED_ROW), 2);
  assert.equal(take()[DROPPED_ROW]?.break, true);
});

test("test_an_event_starting_one_sample_late_begins_a_break", () => {
  assert.equal(feed(GEO_176K, ONE_SAMPLE_GAP_176K)[1]?.break, true);
});

test("test_an_event_starting_one_sample_early_begins_a_break", () => {
  assert.equal(feed(GEO_176K, ONE_SAMPLE_OVERLAP_176K)[1]?.break, true);
});

test("test_a_queue_whose_stamps_span_an_hour_keeps_only_its_newest_frame", () => {
  assert.equal(feed(GEO, AN_HOUR_ON_44K).length, 1);
});
