// Meter frames paced on their own frame time. The daemon sends metering frames in clumps, with gaps of up to a quarter
// second between them; played as they arrive, a meter freezes through each gap and then jumps. pace() keeps the frames
// in a queue `delay` ms deep and hands out, per call, as much frame time as real time has passed, so the meters move at
// the music's pace `delay` behind it. A slow trim of at most 2% holds the average depth at the delay, so the browser's
// clock and the daemon's never drift apart. A step later than RESUME_MS is a page coming back from hidden, whose queue
// ran past what the trim can bring back: it cuts the queue to the delay and hands out nothing, so the meters land on
// the delay at once rather than at the feed's edge.
//
// Pure: the caller owns the queue and the clock, and hands in the real time elapsed.

/** @typedef {import("./meter.js").MeterFrame} MeterFrame */
/**
 * @typedef {object} PaceState
 * @property {boolean} primed  whether frames are being handed out; false until the queue first holds the delay
 * @property {number} budget  frame time owed and not yet handed out, ms
 * @property {number} avg  the queue's depth averaged over AVG_MS, ms
 * @property {number} delay  the delay the state was last paced at, ms
 */
/** @typedef {{ state: PaceState, out: MeterFrame[], dropped: MeterFrame[], rest: MeterFrame[] }} Paced */

/** @type {PaceState} */
export const PACE_IDLE = { primed: false, budget: 0, avg: 0, delay: 0 };

// How far past the delay the queue may run before its oldest frames are dropped, ms.
const CATCHUP_MS = 1000;
// A step later than this, ms, starts the pacing again at the delay.
const RESUME_MS = 500;
// The span the depth is averaged over, ms.
const AVG_MS = 2000;
// The depth excess, ms, at which the trim reaches its full TRIM.
const TRIM_SPAN_MS = 5000;
const TRIM = 0.02;

/** @param {MeterFrame[]} frames */
const depth = (frames) => frames.reduce((sum, f) => sum + f.ms, 0);

/**
 * Move the oldest of `rest` to `dropped` while what stays queued still holds `delay`; hand back what stays queued.
 *
 * @param {MeterFrame[]} rest  oldest first; shortened in place
 * @param {MeterFrame[]} dropped  appended to
 * @param {number} delay  ms
 * @returns {number}
 */
function dropTo(rest, dropped, delay) {
  let buffered = depth(rest);
  while (rest.length && buffered - rest[0].ms >= delay) {
    buffered -= rest[0].ms;
    dropped.push(/** @type {MeterFrame} */ (rest.shift()));
  }
  return buffered;
}

/**
 * Move frames from the front of `rest` to a list while `budget` covers them; hand back the list and the budget left.
 *
 * @param {MeterFrame[]} rest  oldest first; shortened in place
 * @param {number} budget  ms
 * @returns {{ out: MeterFrame[], budget: number }}
 */
function spend(rest, budget) {
  /** @type {MeterFrame[]} */
  const out = [];
  let left = budget;
  while (rest.length && rest[0].ms <= left) {
    left -= rest[0].ms;
    out.push(/** @type {MeterFrame} */ (rest.shift()));
  }
  return { out, budget: rest.length ? left : 0 };
}

/**
 * Hand out the frame time `dt` ms of real time is worth from `queue`, oldest first, keeping it `delay` ms deep. An
 * emptied queue forgets the budget, so an underrun never turns into a burst later. A `dt` past RESUME_MS cuts the
 * queue to the delay and hands out nothing.
 *
 * @param {PaceState} state
 * @param {MeterFrame[]} queue  oldest first; left untouched
 * @param {{ dt: number, delay: number }} step  both ms
 * @returns {Paced}
 */
export function pace(state, queue, { dt, delay }) {
  const rest = queue.slice();
  /** @type {MeterFrame[]} */
  const dropped = [];
  const full = depth(rest);
  const resumed = dt > RESUME_MS;
  const cut = resumed || delay < state.delay || full > delay + CATCHUP_MS;
  const buffered = cut ? dropTo(rest, dropped, delay) : full;
  const primed = state.primed && delay <= state.delay && !resumed;
  if (!primed && buffered < delay) {
    return { state: { primed: false, budget: 0, avg: state.avg, delay }, out: [], dropped, rest };
  }
  const start = primed ? state : { budget: 0, avg: buffered };
  const avg = start.avg + (buffered - start.avg) * Math.min(1, dt / AVG_MS);
  const trim = 1 + Math.max(-TRIM, Math.min(TRIM, (avg - delay) / TRIM_SPAN_MS));
  const { out, budget } = spend(rest, resumed ? 0 : start.budget + dt * trim);
  return { state: { primed: true, budget, avg, delay }, out, dropped, rest };
}
