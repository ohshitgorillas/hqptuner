// The one pacing decision a paint makes: which playback the paint shows, and where the playhead stands. The playhead
// takes its place from the frames' stamps, so frames that arrive together are shown at their own positions over the
// paints that reach them.
//
// The playhead stands on the music's line: the stamps' lead over wall time, a frame's end less the wall time it arrived
// at, held as the greatest lead seen over a short span of recent wall time (settledLead). It stands one delay behind
// the line, moves at wall speed, the paint's `dt`, and follows the line by a bounded share of wall speed, up or down
// (followLine). It never passes the newest queued frame's end, a stamp, and if it reaches it, it stands there until the
// next arrival, then returns to the line at the bounded share. When the delay changes, it jumps by the change at the
// first paint at the new delay: back for a raised delay, forward for a lowered one, never past the newest queued frame's
// end. It moves backward only at a break or a raised delay. The delay's worth of queued music is what carries it through
// a gap between arrivals. At a break it restarts one delay behind the line, carried on at wall speed from the time the
// newest frame arrived, and through the opening span after the restart it takes each rise of the line at once.
// Each paint shows the playback from where the last paint ended up to the playhead, so the paints lay end to end with
// no gap and no overlap. Of the frames a paint shows, the decision names the lead, the one that covers most of the
// paint's span, the earlier of two that cover it equally; a paint whose playhead has not passed where the last one ended shows nothing and consumes
// nothing. A frame leaves the queue once a paint has shown all of it; a frame the playhead stands inside stays queued,
// and the next paint shows the rest of it.
//
// A break restarts: when the queue holds a frame marked `break` that no paint has started in, the paint shows
// from that frame's `at` whatever the last paint ended at, says so in `restart`, stands the playhead one delay behind
// the line, and consumes every frame before it, which belong to playback the music has left. A
// break frame at the front of the queue that the caller marks `started` was queued when the last paint decided, so that
// paint restarted at it or carried on in it, and it does not restart again; no position is compared across a break.
//
// Pure: it reads no clock and takes `now` and `dt` from its caller, and it has no skip. The caller owns the queue and
// applies the decision: it folds frames[first, last), drops the `consumed` oldest frames, and hands `to` back as the
// next paint's `end`, `playhead` back as the next paint's `playhead`, `line` back as the next paint's `line` and the
// delay it handed in back as the next paint's `delayed`, with `started` set when `consumed` left any of those frames
// queued. The decision walks the queue once and allocates nothing in proportion to it.

import { endOf, startOf } from "../../lib/timebase.js";

/** @typedef {import("./meter/meter.js").MeterFrame} MeterFrame */
/**
 * What one paint decides from.
 *
 * @typedef {object} PaintInput
 * @property {number | null} end  playback, ms: where the last paint ended, its `to`; null when no paint has run since
 *   the queue began
 * @property {number | null} playhead  playback, ms: where the last paint's playhead stood, its decision's `playhead`;
 *   null when no paint has run since the queue began
 * @property {number | null} delayed  playback, ms: the delay the last paint ran at; null when no paint has run since
 *   the queue began
 * @property {boolean} started  whether `frames[0]` was queued when the last paint decided: the last decision's
 *   `consumed` was less than the frames it was handed; false when no paint has run or the last one emptied the queue
 * @property {MeterFrame[]} frames  the frames queued, in arrival order, each with `at` and `ms` in playback ms,
 *   `arrivedAt` in wall ms, and `break` as the feed store marks them; read, never changed
 * @property {number} delay  playback, ms: how far behind the line the playhead stands
 * @property {number} dt  wall time, ms, since the last paint: the loop's, 0 on the first paint since the queue began
 * @property {number} now  wall time, ms, on the clock `arrivedAt` is read on: when this paint runs
 * @property {boolean} arrived  whether this paint took frames onto the queue since the last paint
 * @property {LeadState | null} line  what the paints have seen of the line, the last decision's `line`; null when no
 *   paint has run since the queue began
 */
/**
 * What one paint shows, and where the playhead stands.
 *
 * @typedef {object} PaintDecision
 * @property {number} from  playback, ms: where the paint's span starts, the last paint's `to` unless it restarted
 * @property {number} to  playback, ms: where the paint's span ends, the playhead or `from` when the playhead has not
 *   passed it; the span `[from, to)` is empty when they are equal. Handed back as the next paint's `end`.
 * @property {number} playhead  playback, ms: where the playhead stands after this paint, at or short of the newest
 *   queued frame's end (the last paint's `to` when the queue is empty); NaN when the queue is empty and no paint has run
 * @property {number} first  index into `frames` of the oldest frame the span shows any of
 * @property {number} last  index into `frames` one past the newest frame the span shows any of; equal to `first`
 *   when the span is empty
 * @property {number} lead  index into `frames` of the frame that covers most of the span, the earlier of two that cover
 *   it equally; `first` when the span is empty
 * @property {number} consumed  how many of the oldest `frames` leave the queue: every frame before a restart, and
 *   every frame the span ends at or past
 * @property {boolean} restart  whether the paint starts again at a break, or at the queue's first frame when no paint
 *   has run, so every view of playback starts again
 * @property {LeadState | null} line  what the paints have seen of the line, handed back as the next paint's `line`
 */

/**
 * How much of the span `[from, to)` frame `f` covers, playback ms.
 *
 * @param {MeterFrame} f
 * @param {number} from
 * @param {number} to
 */
const coverage = (f, from, to) => Math.min(endOf(f), to) - Math.max(startOf(f), from);

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
 * The lead a queued frame's arrival shows: its end less the wall time it arrived at, playback ms less wall ms.
 *
 * @param {MeterFrame} f  a frame the feed stamped when it arrived
 */
const leadOf = (f) => endOf(f) - /** @type {number} */ (f.arrivedAt);

/**
 * Where the playhead stands after one paint and what the paints have seen of the line. A paint that took arrivals has
 * seen a lead, its newest queued frame's; a restart reads it from the newest queued frame whatever the paint took. The
 * playhead is placed on the aim, `now` plus the line's lead less the delay, at a restart; otherwise a changed delay
 * moves it by the change and it follows the aim from there. It never passes the newest queued frame's end.
 *
 * @param {PaintInput} input
 * @param {{ restart: boolean, from: number }} at  whether the paint restarts, and where its span starts, playback ms
 * @returns {{ head: number, line: LeadState }}
 */
function standOnLine({ playhead, delayed, frames, delay, dt, now, arrived, line }, { restart, from }) {
  const newest = frames.length ? frames[frames.length - 1] : null;
  const seen = newest && (restart || arrived) ? leadOf(newest) : null;
  const settled = settledLead({ line, seen, dt, restart });
  const aim = now + settled.ceiling - delay;
  const jumped = (playhead ?? from) + ((delayed ?? delay) - delay);
  const head = restart ? aim : followLine({ head: jumped, aim, dt, since: settled.since });
  return { head: Math.min(head, newest ? endOf(newest) : from), line: settled };
}

/**
 * Decide what one paint shows from the queued frames, where the last paint ended and its playhead stood, the delay it
 * ran at and the delay now, the wall time the paint covers (ms, as the loop's `dt` is), its own wall time, and the
 * line the paints have seen.
 *
 * @param {PaintInput} input
 * @returns {PaintDecision}
 */
export function pacePaint(input) {
  const { end, started, frames, line } = input;
  if (end === null && !frames.length) {
    return { from: NaN, to: NaN, playhead: NaN, first: 0, last: 0, lead: 0, consumed: 0, restart: false, line };
  }
  const re = frames.length ? restartAt(frames, end, started) : -1;
  const start = Math.max(re, 0);
  const from = end !== null && re < 0 ? end : startOf(frames[start]);
  const { head, line: settled } = standOnLine(input, { restart: re >= 0, from });
  const to = Math.max(from, head);
  return { from, to, playhead: head, ...walk(frames, start, { from, to }), restart: re >= 0, line: settled };
}

/**
 * The frames from `start` the span `[from, to)` shows any of, as `[first, last)`, the one of them that covers most of
 * the span, and how many of the oldest frames leave the queue: all before `start`, and every one ending by `to`.
 *
 * @param {MeterFrame[]} frames
 * @param {number} start
 * @param {{ from: number, to: number }} span  both playback, ms
 * @returns {{ first: number, last: number, lead: number, consumed: number }}
 */
function walk(frames, start, { from, to }) {
  let first = start;
  while (first < frames.length && endOf(frames[first]) <= from) first++;
  let last = first;
  while (to > from && last < frames.length && startOf(frames[last]) < to) last++;
  let lead = first;
  for (let i = first + 1; i < last; i++) if (coverage(frames[i], from, to) > coverage(frames[lead], from, to)) lead = i;
  let consumed = first;
  while (consumed < frames.length && endOf(frames[consumed]) <= to) consumed++;
  return { first, last, lead, consumed };
}

//: The span of recent wall time the line's lead is the greatest lead over, ms: above the 262 ms longest wait between
//: bursts of the steady feed, so a span holds an arrival. Held as two half-spans.
const LINE_SPAN_MS = 500;
const HALF_SPAN_MS = LINE_SPAN_MS / 2;
//: What a half-span that saw no lead holds, so any lead seen raises it.
const NONE = -Infinity;

/**
 * What the paints have seen of the line's lead, playback ms less wall ms.
 *
 * @typedef {object} LeadState
 * @property {number} peak  the greatest lead seen in the half-span being filled; -Infinity when it has seen none
 * @property {number} prior  the greatest lead seen in the half-span before it; -Infinity when it saw none
 * @property {number} age  wall ms, how much of the half-span being filled has run
 * @property {number} since  wall ms, since the last restart
 * @property {number} ceiling  the line's lead: the greatest of `peak` and `prior`, or what it was when neither holds one
 */

/**
 * The line's lead after one paint: the greatest lead seen over the last span of wall time, a paint that saw none
 * leaving it where it was, and a paint that restarts starting it again from the lead it saw.
 *
 * @param {object} input
 * @param {LeadState | null} input.line  where the last paint left it; null when no paint has run, then `restart` holds
 * @param {number | null} input.seen  the lead this paint saw, playback ms less wall ms; null when it took no arrival
 * @param {number} input.dt  wall time, ms, since the last paint
 * @param {boolean} input.restart  whether the paint restarts, so what came before is discarded
 * @returns {LeadState}
 */
export function settledLead({ line, seen, dt, restart }) {
  const got = seen ?? NONE;
  if (restart || line === null) return { peak: got, prior: NONE, age: 0, since: 0, ceiling: got };
  let { peak, prior, age } = line;
  age += dt;
  if (age >= LINE_SPAN_MS) [peak, prior, age] = [NONE, NONE, 0];
  else if (age >= HALF_SPAN_MS) [peak, prior, age] = [NONE, peak, age - HALF_SPAN_MS];
  peak = Math.max(peak, got);
  const held = Math.max(peak, prior);
  return { peak, prior, age, since: line.since + dt, ceiling: held === NONE ? line.ceiling : held };
}

//: The wall time after a restart through which a rise of the aim is taken at once, ms: above the 572 ms a rush can last
//: after a serial change (217 ms until frames resume, 355 ms to settle).
const OPENING_SPAN_MS = 1000;
//: The most of its wall speed the playhead gains or gives up following the aim: above the measured drift of 0.3 percent.
const FOLLOW_SHARE = 0.2;

/**
 * Where the playhead stands after following its aim: it moves its wall time, `dt`, and from there toward `aim` by no
 * more than FOLLOW_SHARE of `dt`, up or down, so it never moves backward. Through OPENING_SPAN_MS after a restart a
 * rise of the aim above where wall speed carries it is taken at once.
 *
 * @param {object} input
 * @param {number} input.head  playback, ms: where the playhead stood after the last paint, or after a changed delay's jump
 * @param {number} input.aim  playback, ms: where the line stands for this paint
 * @param {number} input.dt  wall time, ms, since the last paint
 * @param {number} input.since  wall time, ms, since the last restart
 * @returns {number}  playback, ms
 */
export function followLine({ head, aim, dt, since }) {
  const carried = head + dt;
  if (aim > carried && since < OPENING_SPAN_MS) return aim;
  const share = FOLLOW_SHARE * dt;
  return carried + Math.max(-share, Math.min(share, aim - carried));
}
