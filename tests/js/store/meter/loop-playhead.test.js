// Store suite for the playhead hqptuner/static/store/meter/loop.js publishes on hqptuner/static/store/meter/playhead.js:
// where the meters stand in playback, ms, null while the loop is idle. The daemon sends feed events in bursts; the
// playhead moves on the wall time between paints, so a burst arriving at once is shown at its own positions rather than
// in a rush. Within a run it never steps backward, and a break in the feed's stamps starts it again where the break
// does.
//
// Feed events arrive through openMeterFeed() on the EventSource fake (tests/js/support/eventsource.js), as the payloads
// /api/meter/feed sends, in bursts of five; animation frames through the fake Clock of tests/js/support/clock.js, which
// runs one every 16 ms, so the loop paints on every second one. Every case runs at a 0.1 s offset and no reported output
// delay. Event lengths are taken in turn from LENGTHS_N, so they span the measured range and change from one event to
// the next. The playhead is read by a painter on every paint, after the loop has moved it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-playhead.test.js

import test, { afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { BEFORE_A_GEOMETRY_44K, MONO_BINS, RATE_44K, follow, geometry, play } from "../../support/meterfeed.js";
import { useStorage } from "../../support/storage.js";
import { near } from "../../support/near.js";
import { fakeClock } from "../../support/clock.js";

//: One paint: the fake clock runs an animation frame every 16 ms, and the loop paints on every second one.
const PAINT_MS = 32;
//: Long enough after a painter registers for the loop to have painted on the fresh geometry.
const SETTLE_MS = 2 * PAINT_MS;
//: The offset the meters run behind the feed, s.
const OFFSET_S = 0.1;
//: Event lengths, samples at RATE_44K, taken in turn: 22.7, 17.3, 19.3 and 23.1 ms.
const LENGTHS_N = [1000, 765, 850, 1020];
//: Events in one burst, as the daemon sends them.
const BURST = 5;
//: Paints in each of the two windows the equal-motion case compares.
const WINDOW_PAINTS = 5;
//: How far the playhead's advance over one window may differ from its advance over another of the same wall time, as a
//: share of it: room for a slow clock trim, far less than one event a window.
const SAME_SHARE = 0.05;

const { clock, advance } = fakeClock();

const PLAYING = { status: { state: "2" } };
const STOPPED = { status: { state: "0" } };

/** How many events `burst` has sent this case: the next one's length is LENGTHS_N's at this count. */
let sent = 0;

/**
 * Send `bursts` bursts of BURST events at once, each contiguous with the one before it.
 *
 * @param {number} bursts
 */
function burst(bursts) {
  for (let k = 0; k < bursts * BURST; k++) {
    follow([{ peak: -10, rms: -16, bins: MONO_BINS }], LENGTHS_N[sent % LENGTHS_N.length] ?? NaN);
    sent += 1;
  }
}

/**
 * Run `paints` paints and return the playhead each one left, oldest first.
 *
 * @param {number} paints
 * @returns {Array<number | null>}
 */
function run(paints) {
  const from = seen.length;
  advance(paints * PAINT_MS);
  return seen.slice(from);
}

/**
 * How far the playhead moved across `paints` paints, playback ms, from where the last paint before them left it.
 *
 * @param {number} paints
 */
function moved(paints) {
  const was = seen.at(-1) ?? NaN;
  return (run(paints).at(-1) ?? NaN) - was;
}

/**
 * [ok, message] for one assert.ok: whether every reading is a number at or after the one before it.
 *
 * @param {Array<number | null>} readings
 * @returns {[boolean, string]}
 */
const forward = (readings) => [
  readings.every((v, i) => typeof v === "number" && (i === 0 || v >= (readings[i - 1] ?? Infinity))),
  `expected a playhead that only moves forward, got ${readings.join(", ")}`,
];

/** @type {Array<number | null>} */
let seen = [];
let unpaint = () => {};

before(() => {
  startMeterLoop(clock);
});

beforeEach(() => {
  useStorage();
  setSpectrumOffset(OFFSET_S);
  engineStatus.value = { ...PLAYING };
  useEventSource();
  openMeterFeed(clock);
  lastStream()?.emit("geometry", geometry(RATE_44K));
  sent = 0;
  unpaint = onMeterPaint(() => seen.push(playhead.value));
  advance(SETTLE_MS);
  seen = [];
});

afterEach(() => {
  unpaint();
});

test("test_a_burst_arriving_mid_window_moves_the_playhead_no_further_than_a_window_without_one", () => {
  burst(4);
  run(1);
  const quiet = moved(WINDOW_PAINTS);
  burst(1);
  const bursting = moved(WINDOW_PAINTS);
  assert.ok(...near(bursting / quiet, 1, SAME_SHARE));
});

test("test_the_playhead_never_steps_backward_through_bursts_and_an_underrun", () => {
  burst(2);
  const readings = run(3);
  for (let k = 0; k < 6; k++) {
    burst(1);
    readings.push(...run(4));
  }
  assert.ok(...forward(readings));
});

test("test_a_break_back_to_an_earlier_position_takes_the_playhead_back", () => {
  burst(3);
  const earlier = run(4).at(-1) ?? NaN;
  play(BEFORE_A_GEOMETRY_44K);
  const after = run(1).at(-1) ?? NaN;
  assert.ok(after < earlier, `expected the playhead back from ${earlier}, got ${after}`);
});

test("test_the_playhead_reads_a_position_while_playing_and_null_once_playback_stops", () => {
  burst(3);
  const playing = run(4).at(-1);
  engineStatus.value = { ...STOPPED };
  assert.deepEqual([typeof playing, playhead.value], ["number", null]);
});
