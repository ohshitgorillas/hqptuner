// The one pacing decision a paint makes: which playback the paint shows, and where the playhead stands. The playhead
// takes its place from the frames' stamps, so frames that arrive together are shown at their own positions over the
// paints that reach them.
//
// The playhead's target is a stamp: the newest queued frame's end, less the delay. The playhead moves toward the target
// on the paint's `dt`, wall time since the last paint. Its speed, in playback ms per wall ms, is one plus the lag
// behind the target over CATCH_UP_MS, and never below zero: at the target it moves at wall time, behind it faster in
// proportion to the lag, ahead of it slower, standing still once it is CATCH_UP_MS or more ahead. The motion is
// integrated over `dt` in closed form, so the same wall time moves it the same distance whatever the paint rate. From
// at or behind the target it stops at the target; from ahead of it, after a delay grown mid-feed, it never moves
// backward and never passes the newest queued frame's end. It never jumps, and it moves backward only at a break.
// Each paint shows the playback from where the last paint ended up to the playhead, so the paints lay end to end with
// no gap and no overlap; a paint whose playhead has not passed where the last one ended shows nothing and consumes
// nothing. A frame leaves the queue once a paint has shown all of it; a frame the playhead stands inside stays queued,
// and the next paint shows the rest of it.
//
// A break restarts: when the queue holds a frame marked `break` that no paint has started in, the paint shows
// from that frame's `at` whatever the last paint ended at, says so in `restart`, stands the playhead at the target, and
// consumes every frame before it, which belong to playback the music has left. A break frame at the front of the queue
// that the caller marks `started` was queued when the last paint decided, so that paint restarted at it or carried on
// in it, and it does not restart again; no position is compared across a break.
//
// Pure: it reads no clock and takes `dt` from its caller, and it has no skip. The caller owns the queue and applies the
// decision: it folds frames[first, last), drops the `consumed` oldest frames, and hands `to` back as the next paint's
// `end` and `playhead` back as the next paint's `playhead`, with `started` set when `consumed` left any of those
// frames queued. The decision walks the queue once and allocates nothing in proportion to it.

/** @typedef {import("./meter/meter.js").MeterFrame} MeterFrame */
/**
 * What one paint decides from.
 *
 * @typedef {object} PaintInput
 * @property {number | null} end  playback, ms: where the last paint ended, its `to`; null when no paint has run since
 *   the queue began
 * @property {number | null} playhead  playback, ms: where the last paint's playhead stood, its decision's `playhead`;
 *   null when no paint has run since the queue began
 * @property {boolean} started  whether `frames[0]` was queued when the last paint decided: the last decision's
 *   `consumed` was less than the frames it was handed; false when no paint has run or the last one emptied the queue
 * @property {MeterFrame[]} frames  the frames queued, in arrival order, each with `at` and `ms` in playback ms and
 *   `break` as the feed store marks them; read, never changed
 * @property {number} delay  playback, ms: how far the playhead's target stands behind the newest queued frame's end
 * @property {number} dt  wall time, ms, since the last paint: the loop's, 0 on the first paint since the queue began
 */
/**
 * What one paint shows, and where the playhead stands.
 *
 * @typedef {object} PaintDecision
 * @property {number} from  playback, ms: where the paint's span starts, the last paint's `to` unless it restarted
 * @property {number} to  playback, ms: where the paint's span ends, the playhead or `from` when the playhead has not
 *   passed it; the span `[from, to)` is empty when they are equal. Handed back as the next paint's `end`.
 * @property {number} playhead  playback, ms: where the playhead stands after this paint, at or short of the newest
 *   queued frame's end less the delay unless a grown delay leaves it ahead; the input's `playhead` when the queue is
 *   empty, NaN when it is empty and no paint has run
 * @property {number} first  index into `frames` of the oldest frame the span shows any of
 * @property {number} last  index into `frames` one past the newest frame the span shows any of; equal to `first`
 *   when the span is empty
 * @property {number} consumed  how many of the oldest `frames` leave the queue: every frame before a restart, and
 *   every frame the span ends at or past
 * @property {boolean} restart  whether the paint starts again at a break, or at the queue's first frame when no paint
 *   has run, so every view of playback starts again
 */

/**
 * The playhead's catch-up time constant, wall ms: the lag behind the target, over this, is how much faster than wall
 * time the playhead moves. A display target, not a measurement.
 */
export const CATCH_UP_MS = 500;

/**
 * Where `f` starts, playback ms.
 *
 * @param {MeterFrame} f
 */
const startOf = (f) => f.at ?? NaN;

/**
 * Where `f` ends, playback ms.
 *
 * @param {MeterFrame} f
 */
const endOf = (f) => startOf(f) + f.ms;

/**
 * The index the paint starts from: the newest break frame no paint has started in, or the first frame when no paint
 * has run; -1 when the paint carries on from `end`.
 *
 * @param {MeterFrame[]} frames  at least one
 * @param {number | null} end  playback, ms
 * @param {boolean} started  whether `frames[0]` was queued when the last paint decided
 */
function restartAt(frames, end, started) {
  let brk = -1;
  for (let i = frames.length - 1; i >= 0 && brk < 0; i--) if (frames[i].break) brk = i;
  if (end === null) return Math.max(brk, 0);
  return brk === 0 && started ? -1 : brk;
}

/**
 * Decide what one paint shows from the queued frames, where the last paint ended and its playhead stood, the delay, and
 * the wall time the paint covers (ms, as the loop's `dt` is).
 *
 * @param {PaintInput} input
 * @returns {PaintDecision}
 */
export function pacePaint({ end, playhead, started, frames, delay, dt }) {
  if (!frames.length) {
    const at = end ?? NaN;
    return { from: at, to: at, playhead: playhead ?? NaN, first: 0, last: 0, consumed: 0, restart: false };
  }
  const newest = endOf(frames[frames.length - 1]);
  const target = newest - delay;
  const re = restartAt(frames, end, started);
  const start = Math.max(re, 0);
  const from = end !== null && re < 0 ? end : startOf(frames[start]);
  const head = re >= 0 ? target : approach(playhead ?? from, { target, newest }, dt);
  const to = Math.max(from, head);
  return { from, to, playhead: head, ...walk(frames, start, { from, to }), restart: re >= 0 };
}

/**
 * Where a playhead standing at `head` stands `dt` wall ms on. Its speed is one plus the lag behind the target over
 * CATCH_UP_MS and never below zero, integrated over `dt` in closed form: the lag plus CATCH_UP_MS falls by the same
 * factor over the same wall time, so the distance moved does not depend on how `dt` is split into paints. From at or
 * behind the target it stops there; from ahead of it, it stops at `newest`.
 *
 * @param {number} head  playback, ms
 * @param {{ target: number, newest: number }} stamps  the target, and the newest queued frame's end, playback, ms
 * @param {number} dt  wall, ms
 */
function approach(head, { target, newest }, dt) {
  const lag = target - head;
  if (lag <= -CATCH_UP_MS) return head;
  const moved = head + (lag + CATCH_UP_MS) * -Math.expm1(-dt / CATCH_UP_MS);
  return Math.min(moved, lag >= 0 ? target : newest);
}

/**
 * The frames from `start` the span `[from, to)` shows any of, as `[first, last)`, and how many of the oldest frames
 * leave the queue: all before `start`, and every one ending by `to`.
 *
 * @param {MeterFrame[]} frames
 * @param {number} start
 * @param {{ from: number, to: number }} span  both playback, ms
 * @returns {{ first: number, last: number, consumed: number }}
 */
function walk(frames, start, { from, to }) {
  let first = start;
  while (first < frames.length && endOf(frames[first]) <= from) first++;
  let last = first;
  while (to > from && last < frames.length && startOf(frames[last]) < to) last++;
  let consumed = first;
  while (consumed < frames.length && endOf(frames[consumed]) <= to) consumed++;
  return { first, last, consumed };
}
