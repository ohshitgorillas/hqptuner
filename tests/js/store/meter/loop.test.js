// Store suite for hqptuner/static/store/meter/loop.js: the meter loop paces the frames the feed queues out to the
// one playhead and the spectrogram's history, one paint per animation frame of the Clock it is handed.
//
// The playhead stands at the end of the newest frame the feed has queued, less the effective delay, when the feed opens
// and at a break, moves on the paint's wall time at every paint after that, never passes the feed's edge, jumps by a
// changed delay (a spectrum offset typed while frames are queued), and is null while the feed is closed. The loop runs, asking for animation frames, only while the feed is open
// and the engine plays: while the engine is stopped it asks for none, and the playhead is null
// (docs/superpowers/specs/meter-loop-idle-design.md, Modules). Every frame reaches the spectrogram's history once and in order, and the
// frames a restart leaves behind go before the break frame, so the history runs from the break on.
//
// Metering and playback reach the stores at the wire, through fresh /api/status objects on engineStatus written by
// the poll seam (tests/js/support/apodpolls.js); the feed is the EventSource fake (tests/js/support/eventsource.js),
// its stamps the tables in tests/js/support/meterfeed.js, whose event lengths span 17.3 to 23.2 ms and change
// mid-feed. The delay is the spectrum offset the user types, the engine reporting no output delay. Both stores pace
// on one fake clock; a paint runs only when the case advances it, and each settle covers several paints.
//
// The effects the stores register outlive each test, so every case first switches metering off, which closes any feed
// an earlier case left open, then starts a fresh log of opened streams and a new playing track, which opens a feed.
//
// Not covered here: that a late paint costs no more than an on-time one, and that a paint allocates nothing in
// proportion to the queue. Neither is observable through the stores' public surface without measuring time or memory.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint } from "../../../../hqptuner/static/store/meter/loop.js";
import { feedEdge } from "../../../../hqptuner/static/store/meter/feed.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { spectrogramRange } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { endOf } from "../../../../hqptuner/static/lib/timebase.js";
import { lastStream } from "../../support/eventsource.js";
import { STOPPED, poll } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import { CONTIGUOUS_44K, DROPPED_44K, RATE_44K, geometry, play } from "../../support/meterfeed.js";
import { bootMeter } from "../../support/meter/meterrig.js";

const fake = fakeClock();
const advance = fake.advance;

/** How many animation frames the loop has asked the clock for since a case last set it to 0. */
let asked = 0;

/** @type {import("../../../../hqptuner/static/lib/clock.js").Clock} */
const clock = {
  ...fake.clock,
  requestAnimationFrame: (fn) => {
    asked += 1;
    return fake.clock.requestAnimationFrame(fn);
  },
};

/** Wall time, ms, a stopped engine stays stopped: far more than several animation frames. */
const IDLE_MS = 60000;

/** Wall time, ms, one settle runs the fake clock on: several animation frames. */
const SETTLE_MS = 100;

/** The two delays the playhead is held to: one shorter than a feed's run of frames, one longer, in seconds as the user types them and in ms. */
const DELAYS = [
  { s: 0.25, ms: 250 },
  { s: 1.5, ms: 1500 },
];

/** The delay the cases that are not about the delay run at, in seconds. */
const DELAY_S = 0.25;

/** Where the row of DROPPED_44K that begins a break starts, playback ms: the one after the row it leaves out, sample 3530 at 44.1 kHz. */
const BREAK_START_MS = 80.0453514739229;

/** Run the fake clock on far enough for several paints. */
const settle = () => advance(SETTLE_MS);

/**
 * Send the 44.1 kHz geometry, then one frame per row, on the stream open now.
 *
 * @param {import("../../support/meterfeed.js").Stamp[]} rows
 */
function feed(rows) {
  lastStream()?.emit("geometry", geometry(RATE_44K));
  play(rows);
}

/** Switch metering off and on again, so the feed store opens a fresh feed. */
function reconnect() {
  engineStatus.value = { metering: false };
  poll();
}

/**
 * Where the spectrogram's history starts and ends, and how many of its slices do not start where the one before ended.
 *
 * @returns {{ from: number, to: number, joins: number }}  from and to playback, ms; NaN when the history is empty
 */
function history() {
  /** @type {Array<{ at: number, ms: number, end?: number }>} playback, ms */
  const slices = spectrogramRange.value.slices;
  const last = slices[slices.length - 1];
  const joins = slices.filter((s, i) => i > 0 && s.at !== endOf(slices[i - 1])).length;
  return { from: slices[0]?.at ?? NaN, to: last ? endOf(last) : NaN, joins };
}

beforeEach(() => {
  bootMeter(clock, { delayS: DELAY_S, loop: true });
  settle();
});

/** Wall time, ms, of one animation frame on the fake clock. */
const PAINT_MS = 16;

/** How many paints the playhead is read over after a burst arrives: far more than it needs to reach its target. */
const PAINTS = 12;

/**
 * Feed the first burst of CONTIGUOUS_44K, let the loop paint it, feed the rest, then read the playhead and its target
 * (the feed's edge less `delay.ms`) after each paint, none of which has a frame arrive.
 *
 * @param {{ s: number, ms: number }} delay  the offset the user types, s, and the playback it holds the playhead behind the edge, ms
 * @returns {Array<{ at: number | null, target: number }>}  playback, ms
 */
function afterABurst(delay) {
  setSpectrumOffset(String(delay.s));
  feed(CONTIGUOUS_44K.slice(0, 5));
  settle();
  play(CONTIGUOUS_44K.slice(5));
  return Array.from({ length: PAINTS }, () => {
    advance(PAINT_MS);
    return { at: playhead.value, target: (feedEdge() ?? NaN) - delay.ms };
  });
}

for (const delay of DELAYS) {
  test(`test_the_playhead_moves_at_every_paint_that_finds_it_behind_the_feed_edge_less_a_${delay.s}_s_delay`, () => {
    const seen = afterABurst(delay);
    assert.deepEqual(
      seen.filter((s, i) => i > 0 && (seen[i - 1].at ?? NaN) < s.target && s.at === seen[i - 1].at),
      [],
    );
  });

  test(`test_the_playhead_moves_at_a_paint_no_frame_arrived_before_when_the_feed_edge_less_a_${delay.s}_s_delay_is_ahead`, () => {
    const seen = afterABurst(delay);
    assert.equal(
      seen.slice(1).some((s, i) => s.at !== seen[i].at),
      true,
    );
  });

  test(`test_after_a_burst_each_paint_moves_the_playhead_its_wall_time_at_a_${delay.s}_s_delay`, () => {
    const seen = afterABurst(delay);
    assert.deepEqual(
      seen.filter((s, i) => i > 0 && s.at !== (seen[i - 1].at ?? NaN) + PAINT_MS),
      [],
    );
  });
}

/** Spectrum offsets, s, a typed change runs from and to, and the playback it adds to the playhead's move, ms: a drop, then a raise, each larger than a paint. */
const CHANGES = [
  { from: 0.3, to: 0.15, jumpMs: 150 },
  { from: 0.15, to: 0.3, jumpMs: -150 },
];

for (const { from, to, jumpMs } of CHANGES) {
  test(`test_a_spectrum_offset_changed_from_${from}_s_to_${to}_s_moves_the_playhead_its_wall_time_and_the_change`, () => {
    setSpectrumOffset(String(from));
    feed(CONTIGUOUS_44K.slice(0, 5));
    settle();
    const before = playhead.value ?? NaN;
    setSpectrumOffset(String(to));
    advance(PAINT_MS);
    const want = Math.min(before + PAINT_MS + jumpMs, feedEdge() ?? NaN);
    assert.equal(playhead.value, want);
  });
}

test("test_closing_the_feed_leaves_the_playhead_null", () => {
  feed(CONTIGUOUS_44K);
  settle();
  const before = playhead.value;
  engineStatus.value = { ...engineStatus.value, metering: false };
  settle();
  assert.deepEqual([before !== null, playhead.value], [true, null]);
});

test("test_a_feed_opened_after_one_closed_moves_the_playhead_again", () => {
  feed(CONTIGUOUS_44K.slice(0, 4));
  settle();
  reconnect();
  settle();
  feed(CONTIGUOUS_44K);
  settle();
  assert.equal(playhead.value === null, false);
});

test("test_every_frame_reaches_the_spectrogram_history_once_and_in_order", () => {
  setSpectrumOffset("0");
  feed(CONTIGUOUS_44K.slice(0, 5));
  settle();
  play(CONTIGUOUS_44K.slice(5));
  settle();
  assert.deepEqual(history(), { from: 0, to: feedEdge() ?? NaN, joins: 0 });
});

test("test_after_a_break_the_spectrogram_history_runs_from_the_break_frame_on", () => {
  setSpectrumOffset("0");
  feed(DROPPED_44K.slice(0, 2));
  settle();
  play(DROPPED_44K.slice(2));
  settle();
  assert.deepEqual(history(), { from: BREAK_START_MS, to: feedEdge() ?? NaN, joins: 0 });
});

test("test_while_the_engine_is_not_playing_the_loop_asks_for_no_animation_frame", () => {
  feed(CONTIGUOUS_44K);
  settle();
  poll({ state: STOPPED });
  asked = 0;
  advance(IDLE_MS);
  assert.equal(asked, 0);
});

test("test_a_status_poll_that_leaves_the_engine_stopped_asks_for_no_animation_frame", () => {
  feed(CONTIGUOUS_44K);
  settle();
  poll({ state: STOPPED });
  settle();
  asked = 0;
  for (let i = 0; i < 3; i++) {
    poll({ state: STOPPED });
    advance(IDLE_MS);
  }
  assert.equal(asked, 0);
});

test("test_when_the_engine_stops_playing_the_playhead_goes_null", () => {
  feed(CONTIGUOUS_44K);
  settle();
  const before = playhead.value;
  poll({ state: STOPPED });
  settle();
  assert.deepEqual([before !== null, playhead.value], [true, null]);
});

/** The delay, in seconds, the cases about a feed that has not yet covered it run at. */
const SHORT_DELAY_S = 0.1;

/**
 * The finite peaks, dBFS, a painter subscribed through onMeterPaint is handed over the one paint after `rows` arrive at
 * a SHORT_DELAY_S delay; a scene that shows nothing heard contributes none.
 *
 * @param {import("../../support/meterfeed.js").Stamp[]} rows
 * @returns {number[]}
 */
function heardAtFirstPaint(rows) {
  setSpectrumOffset(String(SHORT_DELAY_S));
  /** @type {number[]} */
  const heard = [];
  const off = onMeterPaint((scene) => heard.push(...scene.channels.map((c) => c.peak).filter(Number.isFinite)));
  feed(rows);
  advance(PAINT_MS);
  off();
  return heard;
}

test("test_a_paint_before_the_feed_covers_the_delay_hands_the_painters_a_scene_with_nothing_heard", () => {
  assert.deepEqual(heardAtFirstPaint(CONTIGUOUS_44K.slice(0, 4)), []);
});

test("test_a_paint_once_the_feed_covers_the_delay_hands_the_painters_the_peak_it_heard", () => {
  assert.deepEqual(heardAtFirstPaint(CONTIGUOUS_44K), [-3.1]);
});
