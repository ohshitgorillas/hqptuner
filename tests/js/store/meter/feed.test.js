// Store suite for hqptuner/static/store/meter/feed.js: initMeterFeed() holds the meter feed open while metering runs
// and closed while it is off, meterFeedOpen saying which. A `geometry` event sets meterGeometry; each `frame` event's
// base64 bins come back from takeMeterFrames() in dBFS, once, carrying the geometry they arrived under.
//
// Playback time: every queued frame carries `at`, where it starts in playback, `end`, where it ends, and `ms`, how long
// it lasts, all in ms, read from its event's `at` and `n` samples at the geometry's rate, and `break`, whether its
// event begins a break: its `at` is not the previous event's `at + n`, tested in whole samples, or it is the first
// frame after a `geometry` event or the first on a newly opened feed, since the server's `at` keeps counting across a
// change of rate and counts nothing while no page is attached. The queue's depth, for its cap, is the playback between
// its first and last frames' stamps.
//
// Metering and playback reach the store at the wire, through fresh /api/status objects on engineStatus, written by the
// poll seam (tests/js/support/apodpolls.js); the feed is the EventSource fake (tests/js/support/eventsource.js), and the
// stamps it carries come from the tables in tests/js/support/meterfeed.js. The feed's clock is the fake one
// initMeterFeed() is handed; the case on arrival times is the one that advances it.
//
// Arrival time: every queued frame carries `arrivedAt`, the wall time in ms on the feed's clock at which the page
// received its event, read once per event.
//
// Source rate: two feeds identical but for the rate, the same arrival wall times and the same playback ms in each frame,
// each frame a whole number of samples at both rates, queue frames identical in every field the playhead reads (`at`,
// `ms`, `arrivedAt` and `break`). The cases name those fields as one table in ms and hold each rate to it, so a
// per-rate offset on a stamp, or a rate reaching an arrival time, is red where a difference at one rate is not.
//
// The effects initMeterFeed() and initSpectrogram() register outlive each test, so every case first switches metering
// off, which closes any feed an earlier case left open, then starts a fresh log of opened streams and starts a new
// playing track, which switches metering on.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/feed.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { meterFeedOpen, meterGeometry, takeMeterFrames } from "../../../../hqptuner/static/store/meter/feed.js";
import { endOf } from "../../../../hqptuner/static/lib/timebase.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { lastStream } from "../../support/eventsource.js";
import { poll } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import { bootMeter } from "../../support/meter/meterrig.js";
import {
  AN_HOUR_ON_44K,
  BEFORE_A_GEOMETRY_44K,
  CONTIGUOUS_44K,
  CONTIGUOUS_AT_RATES,
  DROPPED_44K,
  FOLLOWING_ON_176K,
  FOLLOWING_ON_44K,
  ONE_SAMPLE_GAP_176K,
  ONE_SAMPLE_OVERLAP_176K,
  ONE_SECOND_APART_176K,
  ONE_SECOND_APART_44K,
  RATE_176K,
  RATE_44K,
  RATE_48K,
  geometry,
  play,
} from "../../support/meterfeed.js";

const { clock, advance } = fakeClock();

const GEO = geometry(RATE_44K);
const GEO_176K = geometry(RATE_176K);

/**
 * One feed's arrivals: the wall ms the clock moves on before the events of `rows` arrive together.
 *
 * @typedef {{ wait: number, rows: import("../../support/meterfeed.js").Stamp[] }} Arrival
 */

/**
 * The same music, a 20, a 10, a 30 and a 20 ms frame, arriving 40 ms, then 130 ms and then 17 ms after the feed
 * opened, as samples at 44.1 kHz.
 *
 * @type {Arrival[]}
 */
const SAME_MUSIC_44K = [
  { wait: 40, rows: [{ at: 0, n: 882 }] },
  {
    wait: 130,
    rows: [
      { at: 882, n: 441 },
      { at: 1323, n: 1323 },
    ],
  },
  { wait: 17, rows: [{ at: 2646, n: 882 }] },
];

/** The same music and arrivals as SAME_MUSIC_44K, as samples at 48 kHz. @type {Arrival[]} */
const SAME_MUSIC_48K = [
  { wait: 40, rows: [{ at: 0, n: 960 }] },
  {
    wait: 130,
    rows: [
      { at: 960, n: 480 },
      { at: 1440, n: 1440 },
    ],
  },
  { wait: 17, rows: [{ at: 2880, n: 960 }] },
];

/**
 * What the playhead reads of SAME_MUSIC_44K and of SAME_MUSIC_48K alike, in ms: `arrivedAt` counted from the wall time
 * the feed opened at.
 */
const SAME_MUSIC_READ = [
  { at: 0, ms: 20, arrivedAt: 40, break: true },
  { at: 20, ms: 10, arrivedAt: 170, break: false },
  { at: 30, ms: 30, arrivedAt: 170, break: false },
  { at: 60, ms: 20, arrivedAt: 187, break: false },
];

/** The index, in CONTIGUOUS_44K, of the row DROPPED_44K leaves out. */
const DROPPED_ROW = 3;

/**
 * @typedef {{ at: number, ms: number, arrivedAt: number, break: boolean, geo: unknown,
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

/**
 * Send `geo` on the stream open now, then each arrival's rows once the clock has moved its wait on, and take what the
 * store queued, each frame as the playhead reads it: `arrivedAt` counted from the wall time the feed was sent `geo` at.
 *
 * @param {ReturnType<typeof geometry>} geo
 * @param {Arrival[]} arrivals
 */
function read(geo, arrivals) {
  const opened = clock.now();
  lastStream()?.emit("geometry", geo);
  for (const { wait, rows } of arrivals) {
    advance(wait);
    play(rows);
  }
  return take().map((f) => ({ at: f.at, ms: f.ms, arrivedAt: f.arrivedAt - opened, break: f.break }));
}

beforeEach(() => {
  bootMeter(clock);
  takeMeterFrames();
});

test("test_metering_switched_off_closes_the_stream", () => {
  engineStatus.value = { metering: false };
  assert.equal(lastStream()?.closed, true);
});

test("test_meter_feed_open_is_true_while_metering_runs", () => {
  assert.equal(meterFeedOpen.value, true);
});

test("test_meter_feed_open_is_false_once_metering_is_switched_off", () => {
  engineStatus.value = { metering: false };
  assert.equal(meterFeedOpen.value, false);
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

for (const [name, index, geo] of /** @type {const} */ ([
  ["keeps_the_geometry_it_arrived_under_when_a_new_one_follows", 0, GEO],
  ["arriving_under_a_new_geometry_carries_the_new_geometry", 1, GEO_176K],
])) {
  test(`test_a_frame_${name}`, () => {
    lastStream()?.emit("geometry", GEO);
    play(CONTIGUOUS_44K.slice(0, 1));
    lastStream()?.emit("geometry", GEO_176K);
    play(ONE_SAMPLE_GAP_176K.slice(0, 1));
    assert.deepEqual(take()[index]?.geo, geo);
  });
}

for (const { rate, rows } of CONTIGUOUS_AT_RATES) {
  test(`test_in_a_contiguous_feed_at_${rate}_hz_each_frame_ends_exactly_where_the_next_one_starts`, () => {
    const frames = feed(geometry(rate), rows);
    assert.deepEqual(
      frames.slice(0, -1).map(endOf),
      frames.slice(1).map((f) => f.at),
    );
  });
}

test("test_events_one_second_of_samples_apart_start_one_second_of_playback_apart", () => {
  const [first, second] = feed(GEO, ONE_SECOND_APART_44K);
  assert.equal((second?.at ?? NaN) - (first?.at ?? NaN), 1000);
});

test("test_after_a_reconnect_at_another_rate_one_second_of_samples_is_one_second_of_playback", () => {
  feed(GEO, CONTIGUOUS_44K);
  reconnect();
  const [first, second] = feed(GEO_176K, ONE_SECOND_APART_176K);
  assert.equal((second?.at ?? NaN) - (first?.at ?? NaN), 1000);
});

test("test_a_frame_starts_at_the_same_playback_whether_or_not_an_event_before_it_was_dropped", () => {
  const whole = feed(GEO, CONTIGUOUS_44K);
  reconnect();
  const dropped = feed(GEO, DROPPED_44K);
  assert.equal(dropped.at(-1)?.at, whole.at(-1)?.at);
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

test("test_the_first_frame_after_a_change_of_metering_rate_begins_a_break_even_when_its_at_follows_on", () => {
  lastStream()?.emit("geometry", GEO);
  play(BEFORE_A_GEOMETRY_44K);
  lastStream()?.emit("geometry", GEO_176K);
  play(FOLLOWING_ON_176K);
  assert.equal(take()[BEFORE_A_GEOMETRY_44K.length]?.break, true);
});

test("test_the_first_frame_after_a_geometry_event_at_the_same_rate_begins_a_break_even_when_its_at_follows_on", () => {
  lastStream()?.emit("geometry", GEO);
  play(BEFORE_A_GEOMETRY_44K);
  lastStream()?.emit("geometry", GEO);
  play(FOLLOWING_ON_44K);
  assert.equal(take()[BEFORE_A_GEOMETRY_44K.length]?.break, true);
});

test("test_no_frame_after_the_first_under_a_new_geometry_begins_a_break", () => {
  lastStream()?.emit("geometry", GEO);
  play(BEFORE_A_GEOMETRY_44K);
  lastStream()?.emit("geometry", GEO_176K);
  play(FOLLOWING_ON_176K);
  assert.deepEqual(
    take()
      .slice(BEFORE_A_GEOMETRY_44K.length + 1)
      .map((f) => f.break),
    FOLLOWING_ON_176K.slice(1).map(() => false),
  );
});

test("test_the_first_frame_on_a_new_feed_begins_a_break_even_when_its_at_follows_on_from_the_last_feed", () => {
  feed(GEO, BEFORE_A_GEOMETRY_44K);
  reconnect();
  assert.equal(feed(GEO, FOLLOWING_ON_44K)[0]?.break, true);
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

test("test_a_queued_frame_carries_the_wall_time_at_which_the_page_received_its_event", () => {
  const FIRST_WAIT_MS = 40;
  const SECOND_WAIT_MS = 130;
  lastStream()?.emit("geometry", GEO);
  advance(FIRST_WAIT_MS);
  play(CONTIGUOUS_44K.slice(0, 1));
  const first = clock.now();
  advance(SECOND_WAIT_MS);
  play(CONTIGUOUS_44K.slice(1, 2));
  assert.deepEqual(
    take().map((f) => f.arrivedAt),
    [first, first + SECOND_WAIT_MS],
  );
});

test("test_music_arriving_at_44100_hz_queues_the_stamps_the_playhead_reads", () => {
  assert.deepEqual(read(GEO, SAME_MUSIC_44K), SAME_MUSIC_READ);
});

test("test_the_same_music_arriving_at_48000_hz_queues_the_same_stamps_the_playhead_reads", () => {
  assert.deepEqual(read(geometry(RATE_48K), SAME_MUSIC_48K), SAME_MUSIC_READ);
});

test("test_the_same_music_after_a_reconnect_at_another_rate_queues_the_same_stamps_the_playhead_reads", () => {
  read(GEO, SAME_MUSIC_44K);
  reconnect();
  assert.deepEqual(read(geometry(RATE_48K), SAME_MUSIC_48K), SAME_MUSIC_READ);
});
