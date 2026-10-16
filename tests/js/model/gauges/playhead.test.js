// Timing suite for hqptuner/static/model/gauges/playhead.js: the one decision of what playback each paint shows. Each
// paint picks up where the last one ended, moves as much playback as wall time passed, stays the delay behind the
// feed's edge, restarts at a break, catches a queue run far past the delay up to it, lands on the delay after a long gap,
// and never shows playback the queue does not hold, now or later.
//
// Every queue is feed frames as the feed store hands them over: stamps in playback ms, converted from whole samples at
// 44.1 kHz, events 17.3 to 23.1 ms long and changing length mid-queue. Between two paints the test applies the decision
// as the meter loop does: the frames it left behind leave the queue, and the frames that arrived since join its end.
// Wall time is the `dt` the test hands each paint; nothing reads a clock.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { PLAYHEAD_START, pacePaint } from "../../../../hqptuner/static/model/gauges/playhead.js";
import { near } from "../../support/near.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").PaintDecision} PaintDecision */

//: The metering rate the stamps count samples at, Hz.
const RATE = 44100;
//: Wall time between two paints at 30 Hz, ms.
const PAINT_MS = 1000 / 30;
//: Wall time a hidden page went without a paint, ms.
const HIDDEN_MS = 2000;
//: Wall time of one late paint that outruns what the queue holds, ms.
const LATE_MS = 300;
//: The delay the playhead runs behind the feed's edge, playback ms.
const DELAY = 60;
//: Tolerance on a playback position the decision derives from stamps, ms.
const EPS = 1e-9;
//: One event of each length in the measured range, in samples: 17.3, 19.3, 22.7 and 23.1 ms.
const RUN = [765, 850, 1000, 1020];

/**
 * Frames laid end to end from sample `start`, one per length in `lengths` (samples), the first marked as beginning a
 * break when `brk`.
 *
 * @param {number} start
 * @param {number[]} lengths
 * @param {boolean} [brk]
 * @returns {MeterFrame[]}
 */
function laid(start, lengths, brk = false) {
  /** @type {MeterFrame[]} */
  const out = [];
  let at = start;
  for (const n of lengths) {
    out.push({ channels: [], at: (at * 1000) / RATE, ms: (n * 1000) / RATE, break: brk && at === start });
    at += n;
  }
  return out;
}

/**
 * Where the queue's playback ends, playback ms.
 *
 * @param {MeterFrame[]} queue
 */
const edgeOf = (queue) => {
  const last = queue[queue.length - 1];
  return (last.at ?? NaN) + last.ms;
};

/**
 * The queue after a paint: the frames it left behind gone, `arrived` laid on after the rest.
 *
 * @param {MeterFrame[]} queue
 * @param {PaintDecision} decision
 * @param {MeterFrame[]} arrived
 */
const after = (queue, decision, arrived) => queue.slice(decision.left).concat(arrived);

//: The queue the playhead starts on: from sample 2000 to 6380, 99.3 ms deep.
const FIRST = laid(2000, [1000, 1000, 765, 765, 850]);

/** The first paint over FIRST from a fresh playhead. */
const firstPaint = () => pacePaint(FIRST, PLAYHEAD_START, { dt: PAINT_MS, delay: DELAY });

/**
 * The second paint: `arrived` joins the queue the first paint left, and `dt` of wall time passes.
 *
 * @param {MeterFrame[]} arrived
 * @param {number} dt
 */
function secondPaint(arrived, dt) {
  const first = firstPaint();
  const queue = after(FIRST, first, arrived);
  return { first, queue, second: pacePaint(queue, first.state, { dt, delay: DELAY }) };
}

test("test_a_paint_after_a_burst_starts_where_the_paint_before_it_ended", () => {
  const { first, second } = secondPaint(laid(6380, [850, 1020, 1020, 765, 765]), PAINT_MS);
  assert.equal(second.from, first.to);
});

// Each queue holds exactly the delay, so the drift trim has nothing to trim.
/** @type {Array<[string, number[]]>} */
const DEPTHS = [
  ["short", [765, 765, 765, 765]],
  ["long", [1020, 1020, 1020]],
  ["changing", [765, 765, 1020, 1020]],
];
for (const [name, lengths] of DEPTHS) {
  test(`test_a_paint_moves_as_much_playback_as_wall_time_passed_over_${name}_events`, () => {
    const queue = laid(2000, lengths);
    const depth = edgeOf(queue) - (queue[0].at ?? NaN);
    const d = pacePaint(queue, PLAYHEAD_START, { dt: PAINT_MS, delay: depth });
    assert.ok(...near(d.to - d.from, PAINT_MS, EPS));
  });
}

test("test_a_paint_weights_each_frame_by_the_playback_of_it_crossed", () => {
  const queue = laid(2000, [765, 1020, 850, 1000]);
  const depth = edgeOf(queue) - (queue[0].at ?? NaN);
  const d = pacePaint(queue, PLAYHEAD_START, { dt: PAINT_MS, delay: depth });
  const crossed = d.pieces.reduce((sum, p) => sum + p.ms, 0);
  assert.ok(...near(crossed, PAINT_MS, EPS));
});

//: Two events contiguous with FIRST, then a break: four events from sample 900000, 82.4 ms deep.
const BROKEN = [...laid(6380, [1000, 765]), ...laid(900000, [1020, 765, 850, 1000], true)];

test("test_a_break_restarts_the_playhead_at_the_first_frame_after_it", () => {
  const { second } = secondPaint(BROKEN, PAINT_MS);
  assert.equal(second.from, BROKEN[2].at);
});

//: BROKEN with only 40.7 ms after its break, short of the delay, so the playhead waits at the break's first frame.
const SHALLOW_BROKEN = [...laid(6380, [1000, 765]), ...laid(900000, [1020, 765], true)];

test("test_a_break_leaves_every_frame_before_it_behind", () => {
  const { queue, second } = secondPaint(SHALLOW_BROKEN, PAINT_MS);
  assert.equal(queue[second.left], SHALLOW_BROKEN[2]);
});

test("test_a_queue_run_far_past_the_delay_is_caught_up_to_the_delay", () => {
  const { queue, second } = secondPaint(laid(6380, Array(15).fill(RUN).flat()), PAINT_MS);
  assert.ok(...near(edgeOf(queue) - second.from, DELAY, EPS));
});

test("test_a_paint_after_a_hidden_page_lands_the_playhead_the_delay_behind_the_edge", () => {
  const { queue, second } = secondPaint(laid(6380, Array(3).fill(RUN).flat()), HIDDEN_MS);
  assert.ok(...near(edgeOf(queue) - second.to, DELAY, EPS));
});

test("test_a_paint_that_outruns_the_queue_stops_at_the_feeds_edge", () => {
  const { queue, second } = secondPaint([], LATE_MS);
  assert.ok(...near(second.to, edgeOf(queue), EPS));
});

// The paint after the queue ran dry moves its own wall time's worth, give or take the drift trim, and owes nothing.
test("test_playback_an_underrun_missed_is_not_shown_later", () => {
  const { queue, second } = secondPaint([], LATE_MS);
  const refilled = after(queue, second, laid(6380, [1000, 765, 850, 1020, 765, 1000]));
  const third = pacePaint(refilled, second.state, { dt: PAINT_MS, delay: DELAY });
  assert.ok(...near(third.to - third.from, PAINT_MS, PAINT_MS / 10));
});
