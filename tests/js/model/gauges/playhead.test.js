// Timing suite for hqptuner/static/model/gauges/playhead.js: the one pacing decision a paint makes. Each paint shows
// the playback from where the last one ended up to the playhead, with no gap and no overlap; the playhead stands the
// delay behind the newest queued frame's end, moves only when frames arrive and stands still between arrivals; every
// frame a paint passes is shown once, in full, across the paints that cross it, and leaves the queue once passed; a
// break restarts the paint at the break frame's stamp and leaves the frames before it behind.
//
// The test plays the store's part on a schedule it writes: frames arrive in bursts of BURST, the measured clump, and
// QUIET paints run between bursts with nothing arriving, as at a 30 Hz paint rate through the measured gaps. After
// each paint the test drops the frames the decision consumed and hands the paint's end to the next one, with whether
// the frame left at the front of the queue was queued when that paint decided. No clock is read: the schedule is the
// order of arrivals and paints, and nothing else moves time.
//
// Frame lengths are playback ms inside the measured feed event range, 17.3 to 23.2 ms: the first half of every feed
// cycles through SHORT and the second half runs at LONG, a change of length mid-feed. Every length and delay is a
// whole number of eighths of a ms, so every stamp and span is exact.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pacePaint } from "../../../../hqptuner/static/model/gauges/playhead.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").PaintDecision} PaintDecision */
/** @typedef {{ arrive: MeterFrame[] } | { paint: true }} Step */
/**
 * One paint as the test saw it: the queue handed in, the decision, whether any frame arrived since the paint before
 * it, and whether a break frame did.
 *
 * @typedef {{ queue: MeterFrame[], d: PaintDecision, arrived: boolean, broke: boolean }} Paint
 */

//: Where every feed's first frame starts, playback ms.
const START = 1000;
//: Frame lengths in the first half of a feed, playback ms.
const SHORT = [17.375, 19.25, 21.5];
//: The frame length in the second half of a feed, playback ms.
const LONG = 23.125;
//: Frames per arrival.
const BURST = 5;
//: Bursts per feed half.
const HALF = 4;
//: Paints between two arrivals.
const QUIET = 7;
//: A delay that leaves the playhead inside a LONG frame after a burst of them, playback ms.
const SPLIT = (BURST - 1) * LONG + 10;
//: The delays the feed tests run at, playback ms: none, a frame split, and the default.
const DELAYS = [0, SPLIT, 250];
//: A delay deeper than any feed here holds, playback ms.
const DEEP = 5000;
//: Where a seek lands, playback ms: back before the feed's start, and forward past its end.
const SEEKS = [500, 9000];
//: How far before the first half's end a reconnect's first frame starts, playback ms: inside that frame's length.
const REJOIN_BACK = 10;

/**
 * `count` frames laid end to end from `at`, each `lengths[i % lengths.length]` long, the first marked as a break when
 * `brk` is set.
 *
 * @param {number} at  playback, ms
 * @param {number} count
 * @param {number[]} lengths  playback, ms
 * @param {boolean} brk
 * @returns {MeterFrame[]}
 */
function frames(at, count, lengths, brk) {
  /** @type {MeterFrame[]} */
  const out = [];
  let next = at;
  for (let i = 0; i < count; i++) {
    const ms = lengths[i % lengths.length];
    out.push({ channels: [], at: next, ms, break: brk && i === 0 });
    next += ms;
  }
  return out;
}

/**
 * Where `f` ends, playback ms.
 *
 * @param {MeterFrame} f
 */
const endOf = (f) => (f.at ?? NaN) + f.ms;

/**
 * `list` in bursts of BURST, each followed by QUIET paints.
 *
 * @param {MeterFrame[]} list
 * @returns {Step[]}
 */
function bursts(list) {
  /** @type {Step[]} */
  const out = [];
  for (let i = 0; i < list.length; i += BURST) {
    out.push({ arrive: list.slice(i, i + BURST) });
    for (let p = 0; p < QUIET; p++) out.push({ paint: true });
  }
  return out;
}

//: One unbroken feed: HALF bursts of SHORT frames, then HALF of LONG ones.
const FEED = (() => {
  const short = frames(START, HALF * BURST, SHORT, true);
  return [...short, ...frames(endOf(short[short.length - 1]), HALF * BURST, [LONG], false)];
})();
//: Where FEED's newest frame ends, playback ms.
const EDGE = endOf(FEED[FEED.length - 1]);
//: Where a reconnect lands, playback ms: its first frame holds where FEED's first half ends.
const REJOIN = endOf(FEED[HALF * BURST - 1]) - REJOIN_BACK;

/**
 * FEED's first half, then a break to `seek` and HALF bursts of LONG frames from there.
 *
 * @param {number} seek  playback, ms
 * @returns {{ list: MeterFrame[], brk: MeterFrame }}
 */
function seeked(seek) {
  const after = frames(seek, HALF * BURST, [LONG], true);
  return { list: [...FEED.slice(0, HALF * BURST), ...after], brk: after[0] };
}

/**
 * Run `steps` against the decision at `delay`, playing the store: queue arrivals, hand each paint the queue, the
 * last paint's end and whether the frame at the queue's front was queued when the last paint decided, drop what it
 * consumed.
 *
 * @param {Step[]} steps
 * @param {number} delay  playback, ms
 * @returns {{ paints: Paint[], queue: MeterFrame[] }}
 */
function play(steps, delay) {
  /** @type {MeterFrame[]} */
  let queue = [];
  /** @type {number | null} */
  let end = null;
  let started = false;
  let arrived = false;
  let broke = false;
  /** @type {Paint[]} */
  const paints = [];
  for (const step of steps) {
    if ("arrive" in step) {
      queue = [...queue, ...step.arrive];
      arrived = true;
      broke = broke || step.arrive.some((f) => f.break);
      continue;
    }
    const d = pacePaint({ end, started, frames: queue, delay });
    paints.push({ queue, d, arrived, broke });
    queue = queue.slice(d.consumed);
    end = d.to;
    started = queue.length > 0;
    arrived = false;
    broke = false;
  }
  return { paints, queue };
}

/**
 * The spans `paints` showed, joined where one starts exactly where the one before it ended.
 *
 * @param {Paint[]} paints
 * @returns {{ from: number, to: number }[]}
 */
function joined(paints) {
  /** @type {{ from: number, to: number }[]} */
  const out = [];
  for (const { d } of paints) {
    const last = out[out.length - 1];
    if (last && last.to === d.from) last.to = d.to;
    else out.push({ from: d.from, to: d.to });
  }
  return out;
}

/**
 * The playback ms of `f` inside the span `[from, to)`, 0 when the span holds none of it.
 *
 * @param {MeterFrame} f
 * @param {{ from: number, to: number }} span  both playback, ms
 */
const inside = (f, { from, to }) => Math.max(0, Math.min(endOf(f), to) - Math.max(f.at ?? NaN, from));

/**
 * The playback ms of each frame `paints` showed, summed over every paint.
 *
 * @param {Paint[]} paints
 * @returns {Map<MeterFrame, number>}
 */
function shown(paints) {
  /** @type {Map<MeterFrame, number>} */
  const out = new Map();
  for (const { queue, d } of paints) {
    for (let i = d.first; i < d.last; i++) out.set(queue[i], (out.get(queue[i]) ?? 0) + inside(queue[i], d));
  }
  return out;
}

for (const delay of DELAYS) {
  test(`test_the_paints_at_a_${delay}_ms_delay_show_one_unbroken_span_from_the_feeds_start_to_the_playhead`, () => {
    const { paints } = play(bursts(FEED), delay);
    assert.deepEqual(joined(paints), [{ from: START, to: EDGE - delay }]);
  });

  test(`test_every_frame_passed_at_a_${delay}_ms_delay_is_shown_for_its_own_length`, () => {
    const { paints } = play(bursts(FEED), delay);
    const passed = FEED.filter((f) => endOf(f) <= EDGE - delay);
    const got = shown(paints);
    assert.deepEqual(
      passed.map((f) => got.get(f)),
      passed.map((f) => f.ms),
    );
  });

  test(`test_the_playhead_at_a_${delay}_ms_delay_moves_at_each_paint_after_an_arrival_and_at_no_other`, () => {
    const { paints } = play(bursts(FEED), delay);
    const moved = paints.slice(1).map((p, i) => p.d.playhead !== paints[i].d.playhead);
    assert.deepEqual(
      moved,
      paints.slice(1).map((p) => p.arrived),
    );
  });

  test(`test_the_queue_after_the_feed_at_a_${delay}_ms_delay_holds_exactly_the_frames_ending_past_the_playhead`, () => {
    const { queue } = play(bursts(FEED), delay);
    assert.deepEqual(
      queue.map((f) => f.at),
      FEED.filter((f) => endOf(f) > EDGE - delay).map((f) => f.at),
    );
  });
}

for (const delay of [...DELAYS, DEEP]) {
  test(`test_the_playhead_at_a_${delay}_ms_delay_stands_that_far_behind_the_newest_frames_end`, () => {
    const { paints } = play(bursts(FEED), delay);
    assert.equal(paints[paints.length - 1].d.playhead + delay, EDGE);
  });
}

for (const seek of [...SEEKS, REJOIN]) {
  for (const delay of [0, SPLIT, 250]) {
    test(`test_at_a_seek_to_${seek}_ms_and_a_${delay}_ms_delay_the_paints_restart_exactly_where_a_break_arrived`, () => {
      const { paints } = play(bursts(seeked(seek).list), delay);
      assert.deepEqual(
        paints.map((p) => p.d.restart),
        paints.map((p) => p.broke),
      );
    });
  }

  test(`test_the_paint_after_a_seek_to_${seek}_ms_shows_from_the_break_frames_stamp`, () => {
    const { list, brk } = seeked(seek);
    const { paints } = play(bursts(list), 250);
    const first = paints.find((p) => p.queue.includes(brk));
    assert.equal(first?.d.from, brk.at);
  });

  test(`test_the_paint_after_a_seek_to_${seek}_ms_leaves_the_break_frame_oldest_in_the_queue`, () => {
    const { list, brk } = seeked(seek);
    const { paints } = play(bursts(list), 250);
    const first = paints.find((p) => p.queue.includes(brk));
    assert.equal(first?.queue.slice(first.d.consumed)[0], brk);
  });
}
