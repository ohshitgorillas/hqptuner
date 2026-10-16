// The one pacing decision a paint makes (docs/spec/timing.md, rule 5): which playback the paint shows, and where the
// playhead stands after it. The daemon sends metering frames in clumps, with gaps of up to a quarter second between
// them; played as they arrive, a meter freezes through each gap and then jumps. The playhead stays `delay` behind the
// feed's edge, the end of the newest queued frame, and moves per paint as much playback as wall time passed, so the
// meters move at the music's pace `delay` behind it. Each paint shows the playback from where the last one ended.
//
// Every position is read off the frames' stamps: the playhead starts at a frame's `at`, the edge is the last frame's
// `at + ms`, and a skip lands at the edge less the delay. Nothing sums lengths into a position.
//
// The skip and catch-up rules live here and nowhere else. A slow trim of at most 2% holds the average depth ahead of
// the playhead at the delay, so the browser's clock and the daemon's never drift apart. A paint later than RESUME_MS is
// a page coming back from hidden: the playhead lands at the delay behind the edge and shows nothing that paint. A
// shortened delay, or a queue run CATCHUP_MS past the delay, skips the playhead to the delay. Playback the queue does
// not hold is not owed later, so an underrun never turns into a burst. A break (rule 3) restarts the playhead at the
// first frame after it, and every frame before it is left behind.
//
// Pure, and blind to what the frames hold. The caller owns the queue and applies the decision: it folds the pieces
// crossed (meter.js foldCrossed), drops the `left` oldest frames, and lays newly arrived frames on after the rest
// before the next paint. Work per paint walks only the frames the playhead crosses or skips and the frames that
// arrived since the last paint; nothing is copied in proportion to the queue.

import { clamp } from "../../lib/coerce.js";

/** @typedef {import("./meter/meter.js").MeterFrame} MeterFrame */
/**
 * The playhead between two paints.
 *
 * @typedef {object} PlayheadState
 * @property {number | null} at  playback, ms: where the playhead stands; null until it has stood anywhere
 * @property {boolean} primed  whether the playhead moves; false until the queue first holds the delay after a start
 * @property {number} avg  playback, ms: the depth queued ahead of the playhead, averaged over AVG_MS of wall time
 * @property {number} delay  playback, ms: the delay the playhead last moved at
 * @property {number} seen  how many frames at the front of the queue, once the last decision's `left` are dropped,
 *   were already searched for a break
 */
/**
 * One frame the paint crossed, with the playback of it crossed.
 *
 * @typedef {{ frame: MeterFrame, ms: number }} Piece
 */
/**
 * What one paint shows. `from` and `to` are playback ms: the span `[from, to)` the paint shows, empty when it shows
 * nothing, NaN while the playhead has never stood anywhere. `pieces` are the frames that span touches, oldest first,
 * each with the playback ms of it inside the span. `left` is how many of the oldest frames the playhead has left
 * behind, skipped or passed. `state` is the playhead after the paint, standing at `to`.
 *
 * @typedef {{ from: number, to: number, pieces: Piece[], left: number, state: PlayheadState }} PaintDecision
 */
/**
 * One paint's inputs besides the queue.
 *
 * @typedef {object} PaintStep
 * @property {number} dt  wall, ms: the time since the last paint
 * @property {number} delay  playback, ms: how far behind the feed's edge the playhead runs
 */

/** @type {PlayheadState} */
export const PLAYHEAD_START = { at: null, primed: false, avg: 0, delay: 0, seen: 0 };

// How far past the delay the queue may run before the playhead skips to it, playback ms.
const CATCHUP_MS = 1000;
// A paint later than this, wall ms, lands the playhead at the delay.
const RESUME_MS = 500;
// The wall time the depth is averaged over, ms.
const AVG_MS = 2000;
// The depth excess, playback ms, at which the trim reaches its full TRIM.
const TRIM_SPAN_MS = 5000;
const TRIM = 0.02;
// What is left of a frame, playback ms, below which the playhead counts as past its end.
const END_MS = 1e-6;

/**
 * The frame's end, playback ms.
 *
 * @param {MeterFrame} f
 */
const endOf = (f) => (f.at ?? NaN) + f.ms;

/**
 * The index of the newest frame at or after `from` that begins a break; -1 when none does.
 *
 * @param {MeterFrame[]} frames
 * @param {number} from
 */
function lastBreak(frames, from) {
  for (let i = frames.length - 1; i >= from; i--) if (frames[i].break) return i;
  return -1;
}

/**
 * Where the playhead starts this paint: at the first frame after the newest unseen break, or where it stood, or at the
 * first frame when it never stood anywhere. `first` is the index of the frame it starts in or before.
 *
 * @param {MeterFrame[]} frames  at least one
 * @param {PlayheadState} state
 * @returns {{ first: number, state: PlayheadState }}
 */
function start(frames, state) {
  const brk = lastBreak(frames, state.seen);
  if (brk < 0 && state.at !== null) return { first: 0, state };
  const first = Math.max(brk, 0);
  return { first, state: { at: frames[first].at ?? NaN, primed: false, avg: 0, delay: state.delay, seen: 0 } };
}

/**
 * Where the paint shows from, playback ms: the delay behind `edge` when the paint resumed after a long gap, the delay
 * shortened, or the queue ran CATCHUP_MS past the delay, and the queue holds more than the delay; `head` otherwise.
 *
 * @param {PlayheadState} state
 * @param {{ head: number, edge: number }} at  both playback, ms
 * @param {PaintStep} step
 */
function skipTo(state, { head, edge }, { dt, delay }) {
  const ahead = edge - head;
  const cut = dt > RESUME_MS || delay < state.delay || ahead > delay + CATCHUP_MS;
  return cut && ahead > delay ? edge - delay : head;
}

/**
 * The playhead's move: where it shows from and to, and its averaged depth, from `head` with the feed's edge at `edge`.
 *
 * @param {PlayheadState} state
 * @param {{ head: number, edge: number }} at  both playback, ms
 * @param {PaintStep} step
 * @returns {{ from: number, to: number, primed: boolean, avg: number }}
 */
function move(state, at, step) {
  const { dt, delay } = step;
  const resumed = dt > RESUME_MS;
  const edge = at.edge;
  const from = skipTo(state, at, step);
  const buffered = edge - from;
  const primed = state.primed && delay <= state.delay && !resumed;
  if (!primed && buffered < delay) return { from, to: from, primed: false, avg: state.avg };
  const was = primed ? state.avg : buffered;
  const avg = was + (buffered - was) * Math.min(1, dt / AVG_MS);
  const trim = 1 + clamp((avg - delay) / TRIM_SPAN_MS, -TRIM, TRIM);
  const to = resumed ? from : Math.min(from + dt * trim, edge);
  return { from, to, primed: true, avg };
}

/**
 * The frames from `first` the span `[from, to)` touches, each with the playback of it inside the span, and how many
 * frames from the front end at or before `to`.
 *
 * @param {MeterFrame[]} frames
 * @param {number} first
 * @param {{ from: number, to: number }} span  both playback, ms
 * @returns {{ pieces: Piece[], left: number }}
 */
function crossed(frames, first, { from, to }) {
  /** @type {Piece[]} */
  const pieces = [];
  let left = first;
  for (let i = first; i < frames.length && (frames[i].at ?? NaN) < to; i++) {
    const f = frames[i];
    const ms = Math.min(endOf(f), to) - Math.max(f.at ?? NaN, from);
    if (ms > 0) pieces.push({ frame: f, ms });
    if (endOf(f) - to < END_MS) left = i + 1;
  }
  return { pieces, left };
}

/**
 * Decide what one paint shows from the queued `frames`, oldest first, with the playhead at `state`, `step.dt` of wall
 * time after the last paint, `step.delay` behind the feed's edge.
 *
 * @param {MeterFrame[]} frames
 * @param {PlayheadState} state
 * @param {PaintStep} step
 * @returns {PaintDecision}
 */
export function pacePaint(frames, state, step) {
  if (!frames.length) {
    const at = state.at ?? NaN;
    return { from: at, to: at, pieces: [], left: 0, state: { ...state, seen: 0 } };
  }
  const begun = start(frames, state);
  const head = begun.state.at ?? NaN;
  const m = move(begun.state, { head, edge: endOf(frames[frames.length - 1]) }, step);
  const { pieces, left } = crossed(frames, begun.first, m);
  const next = { at: m.to, primed: m.primed, avg: m.avg, delay: step.delay, seen: frames.length - left };
  return { from: m.from, to: m.to, pieces, left, state: next };
}
