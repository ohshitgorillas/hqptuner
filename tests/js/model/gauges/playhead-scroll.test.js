// Steady spectrogram, the edge's move at a paint (hqptuner/static/model/gauges/playhead.js, pacePaint): the spectrogram
// scrolls at a constant rate in playback time, with no stall and no catch-up burst. Its right edge is the playhead, the
// decision's `to`, and its scroll is the edge's move through scrollPlan, which tests/js/lib/spectroraster.test.js pins
// for a given move; so each word is a fact of the edge's move at one paint, the decision's `to` less its `from`.
//
// Constant rate: on a line that holds, the edge moves by the music heard over the paint. No stall: while music is
// queued past the playhead, the edge moves, the line having fallen included. No catch-up burst: after the playhead
// stood at the newest end, the paint that takes the next arrival does not move the edge at once to the line, and it does
// move it on toward the line, so the edge is neither stalled nor jumped.
//
// What the other tables hold is not written again: where the playhead stands is held by playhead-lag.test.js and
// playhead-motion.test.js, and never backward by playhead-motion.test.js. The cases here read the edge, which those do
// not. How far the edge moves toward a line it stands short of is the line's bounded share of wall speed, held by
// playhead-line.test.js; a case here that named the figure would be that test again.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-scroll.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pacePaint } from "../../../../hqptuner/static/model/gauges/playhead.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").PaintInput} PaintInput */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").LeadState} LeadState */
/**
 * What the approved rule reads beyond today's PaintInput: the paint's wall time, ms on the clock `arrivedAt` is read
 * on; whether the paint took arrivals; and the line's carried state, null when no paint has run.
 *
 * @typedef {PaintInput & { now: number, arrived: boolean, line: LeadState | null }} Paint
 */

/**
 * `count` frames 20 ms long end to end from `at` playback ms, all received at wall time `arrivedAt`.
 *
 * @param {number} at
 * @param {number} count
 * @param {number} arrivedAt
 */
const queue = (at, count, arrivedAt) =>
  Array(count)
    .fill(0)
    .map((_, i) => ({ channels: [], at: at + 20 * i, ms: 20, arrivedAt, break: false }));

/**
 * The edge's move at the paint, playback ms.
 *
 * @param {Paint} paint
 */
function moved(paint) {
  const { from, to } = pacePaint(paint);
  return to - from;
}

/**
 * The playhead stood at 40000 at wall 39600 on a line held at 600; the paint 16 ms later. Aim 40016.
 *
 * @type {Paint}
 */
const LINE_HOLDS = {
  end: 40000,
  playhead: 40000,
  delayed: 200,
  started: true,
  frames: queue(39990, 11, 39610),
  delay: 200,
  dt: 16,
  now: 39616,
  arrived: true,
  line: { peak: 600, prior: 600, age: 100, since: 3000, ceiling: 600 },
};

/**
 * The same paint on a line that has fallen to 540: the aim, 39956, is under where wall speed carries the playhead.
 *
 * @type {Paint}
 */
const LINE_HAS_FALLEN = {
  ...LINE_HOLDS,
  frames: queue(39990, 8, 39610),
  line: { peak: 540, prior: 540, age: 100, since: 3000, ceiling: 540 },
};

/**
 * The playhead stood at the newest end, 39600, while no arrival came. An arrival of 20 frames, ending at 40000 after
 * a wait of 400 ms, takes the paint 16 ms later: the line holds at 600, the aim is 39816 and wall speed carries the
 * playhead to 39616.
 *
 * @type {Paint}
 */
const AFTER_A_STAND = {
  end: 39600,
  playhead: 39600,
  delayed: 200,
  started: true,
  frames: queue(39600, 20, 39400),
  delay: 200,
  dt: 16,
  now: 39416,
  arrived: true,
  line: { peak: 600, prior: 600, age: 100, since: 3000, ceiling: 600 },
};

test("test_on_a_line_that_holds_the_edge_moves_by_the_music_heard_over_the_paint", () => {
  assert.equal(moved(LINE_HOLDS), 16);
});

test("test_with_music_queued_past_the_playhead_the_edge_moves_though_the_line_has_fallen", () => {
  assert.ok(moved(LINE_HAS_FALLEN) > 0);
});

test("test_after_a_stand_the_edge_does_not_move_at_once_to_the_line", () => {
  assert.ok(pacePaint(AFTER_A_STAND).to < 39816);
});

test("test_after_a_stand_the_edge_moves_on_toward_the_line", () => {
  assert.ok(pacePaint(AFTER_A_STAND).to > 39616);
});
