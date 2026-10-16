// The meters' playhead: where in the queued feed playback has reached. The daemon sends metering frames in clumps, with
// gaps of up to a quarter second between them; played as they arrive, a meter freezes through each gap and then jumps.
// The playhead stays `delay` ms behind the feed's edge and moves, per step, as much playback time as real time has
// passed, so the meters move at the music's pace `delay` behind it. A slow trim of at most 2% holds the average depth
// ahead of it at the delay, so the browser's clock and the daemon's never drift apart. A step later than RESUME_MS is a
// page coming back from hidden, whose queue ran past what the trim can bring back: the playhead skips to the delay and
// moves no further, so the meters land on the delay at once rather than at the feed's edge.
//
// Pure, and blind to what the frames hold: the caller hands in how much playback is queued ahead of the playhead and
// the real time elapsed, and moves through its own queue (model/gauges/timeline.js) as far as it is told.

import { clamp } from "../../lib/coerce.js";

/**
 * @typedef {object} PlayheadState
 * @property {boolean} primed  whether the playhead moves; false until the queue first holds the delay
 * @property {number} avg  the depth ahead of the playhead averaged over AVG_MS, ms
 * @property {number} delay  the delay the playhead last moved at, ms
 */
/**
 * One step of the playhead: skip `skip` ms of playback unshown, then cross `cross` ms of it, shown.
 *
 * @typedef {{ state: PlayheadState, skip: number, cross: number }} PlayheadMove
 */

/** @type {PlayheadState} */
export const PLAYHEAD_IDLE = { primed: false, avg: 0, delay: 0 };

// How far past the delay the queue may run before the playhead skips to it, ms.
const CATCHUP_MS = 1000;
// A step later than this, ms, starts the playhead again at the delay.
const RESUME_MS = 500;
// The span the depth is averaged over, ms.
const AVG_MS = 2000;
// The depth excess, ms, at which the trim reaches its full TRIM.
const TRIM_SPAN_MS = 5000;
const TRIM = 0.02;

/**
 * The playback to skip unshown: down to the delay when the step resumed after a gap, the delay shortened, or the queue
 * ran CATCHUP_MS past the delay; none otherwise.
 *
 * @param {PlayheadState} state
 * @param {number} ahead  ms
 * @param {{ dt: number, delay: number }} step  both ms
 * @returns {number}  ms
 */
function skipFor(state, ahead, { dt, delay }) {
  const cut = dt > RESUME_MS || delay < state.delay || ahead > delay + CATCHUP_MS;
  return cut && ahead > delay ? ahead - delay : 0;
}

/**
 * Move the playhead for `dt` ms of real time with `ahead` ms of playback queued in front of it, keeping it `delay` ms
 * behind the feed's edge. Playback the queue does not hold is not owed later, so an underrun never turns into a burst.
 * A `dt` past RESUME_MS skips to the delay and crosses nothing.
 *
 * @param {PlayheadState} state
 * @param {number} ahead  ms
 * @param {{ dt: number, delay: number }} step  both ms
 * @returns {PlayheadMove}
 */
export function movePlayhead(state, ahead, step) {
  const { dt, delay } = step;
  const resumed = dt > RESUME_MS;
  const skip = skipFor(state, ahead, step);
  const buffered = skip ? delay : ahead;
  const primed = state.primed && delay <= state.delay && !resumed;
  if (!primed && buffered < delay) {
    return { state: { primed: false, avg: state.avg, delay }, skip, cross: 0 };
  }
  const from = primed ? state.avg : buffered;
  const avg = from + (buffered - from) * Math.min(1, dt / AVG_MS);
  const trim = 1 + clamp((avg - delay) / TRIM_SPAN_MS, -TRIM, TRIM);
  return { state: { primed: true, avg, delay }, skip, cross: resumed ? 0 : dt * trim };
}
