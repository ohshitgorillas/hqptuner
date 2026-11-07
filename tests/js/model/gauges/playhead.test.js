// Timing suite for hqptuner/static/model/gauges/playhead.js: the one pacing decision a paint makes. Each paint shows
// the playback from where the last one ended up to the playhead, with no gap and no overlap; the playhead's target is
// the newest queued frame's end less the delay, and the playhead moves toward it on the paint's `dt`: faster than wall
// time while behind it, slower while ahead of it, never past it from behind, never backward outside a break; every
// frame a paint passes is shown once, in full, across the paints that cross it, and leaves the queue once passed; a
// break restarts the paint at the break frame's stamp, the playhead at the target, and leaves the frames before it
// behind.
//
// The test plays the store's part on a wall-time schedule it writes: frames arrive in bursts of BURST, the measured
// clump, every GAP_MS, and paints run every `dt` ms between them, as at a 60 Hz or 30 Hz paint rate through the measured
// gaps; an arrival is seen by the first paint after it. After each paint the test drops the frames the decision
// consumed and hands the paint's end and playhead to the next one, with whether the frame left at the front of the
// queue was queued when that paint decided. No clock is read: the schedule is the order of arrivals and paints, and
// the `dt` each paint is handed is the only time there is.
//
// Frame lengths are playback ms inside the measured feed event range, 17.3 to 23.2 ms: the first half of every feed
// cycles through SHORT and the second half runs at LONG, a change of length mid-feed. Every length and delay is a
// whole number of eighths of a ms, so every stamp and span is exact. The delay changes mid-feed in two runs.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { CATCH_UP_MS, pacePaint } from "../../../../hqptuner/static/model/gauges/playhead.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").PaintDecision} PaintDecision */
/**
 * One step of a schedule: frames arrive, the delay becomes `delay` (playback, ms), or a paint runs `paint` wall ms
 * after the one before it.
 *
 * @typedef {{ arrive: MeterFrame[] } | { delay: number } | { paint: number }} Step
 */
/**
 * One paint as the test saw it: the queue handed in, the decision, whether any frame arrived since the paint before
 * it, and whether a break frame did; the delay it ran at (playback, ms), the playhead the paint before it left (null
 * on the first), its `dt` (wall, ms) and the wall time it ran at (ms from the schedule's start).
 *
 * @typedef {{ queue: MeterFrame[], d: PaintDecision, arrived: boolean, broke: boolean, delay: number,
 *   before: number | null, dt: number, wall: number }} Paint
 */
/**
 * One paint that carried on from the playhead the paint before it left, with the target it moved toward: the newest
 * queued frame's end less the delay, all playback ms.
 *
 * @typedef {{ before: number, after: number, target: number, newest: number, dt: number }} Move
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
//: Wall ms between two arrivals, and the wall ms after the schedule's start the first one lands at: a time no paint
//: rate here paints at, so every paint rate sees an arrival at its next paint.
const GAP_MS = 128;
const ARRIVE_MS = 5;
//: The paint intervals the tests run at, wall ms: 60 Hz, then a slower paint that holds two of the faster one.
const PAINT_MS = 16;
const SLOWER_PAINT_MS = 32;
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
 * `list` in bursts of BURST, one every GAP_MS of wall time, with a paint every `dt` ms through one GAP_MS more than the
 * last burst needs.
 *
 * @param {MeterFrame[]} list
 * @param {number} [dt]  wall, ms
 * @returns {Step[]}
 */
function bursts(list, dt = PAINT_MS) {
  /** @type {MeterFrame[][]} */
  const groups = [];
  for (let i = 0; i < list.length; i += BURST) groups.push(list.slice(i, i + BURST));
  /** @type {Step[]} */
  const out = [];
  let next = 0;
  for (let wall = dt; wall <= (groups.length + 1) * GAP_MS; wall += dt) {
    while (next < groups.length && next * GAP_MS + ARRIVE_MS <= wall) out.push({ arrive: groups[next++] });
    out.push({ paint: dt });
  }
  return out;
}

/**
 * `steps` with the delay becoming `delay` just before burst number `burst` arrives.
 *
 * @param {Step[]} steps
 * @param {number} burst
 * @param {number} delay  playback, ms
 * @returns {Step[]}
 */
function delayedAt(steps, burst, delay) {
  let seen = 0;
  return steps.flatMap((step) => ("arrive" in step && seen++ === burst ? [{ delay }, step] : [step]));
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
 * Run `steps` against the decision from `delay`, playing the store: queue arrivals, hand each paint the queue, the last
 * paint's end and playhead and whether the frame at the queue's front was queued when the last paint decided, drop
 * what it consumed.
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
  /** @type {number | null} */
  let before = null;
  let started = false;
  let arrived = false;
  let broke = false;
  let wall = 0;
  let now = delay;
  /** @type {Paint[]} */
  const paints = [];
  for (const step of steps) {
    if ("delay" in step) {
      now = step.delay;
    } else if ("arrive" in step) {
      queue = [...queue, ...step.arrive];
      arrived = true;
      broke = broke || step.arrive.some((f) => f.break);
    } else {
      wall += step.paint;
      const d = pacePaint({ end, playhead: before, started, frames: queue, delay: now, dt: step.paint });
      paints.push({ queue, d, arrived, broke, delay: now, before, dt: step.paint, wall });
      queue = queue.slice(d.consumed);
      end = d.to;
      before = Number.isNaN(d.playhead) ? null : d.playhead;
      started = queue.length > 0;
      arrived = false;
      broke = false;
    }
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

  test(`test_the_playhead_at_a_${delay}_ms_delay_moves_at_a_paint_no_frame_arrived_before`, () => {
    const { paints } = play(bursts(FEED), delay);
    assert.equal(
      paints.some((p) => !p.arrived && p.before !== null && p.d.playhead !== p.before),
      true,
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

  test(`test_the_paint_after_a_seek_to_${seek}_ms_stands_the_playhead_the_delay_behind_the_newest_end`, () => {
    const { list, brk } = seeked(seek);
    const { paints } = play(bursts(list), 250);
    const first = paints.find((p) => p.queue.includes(brk));
    assert.equal((first?.d.playhead ?? NaN) + 250, endOf(first?.queue.at(-1) ?? brk));
  });
}

/**
 * A run the movement tests read: its paints, and the name that says what was fed.
 *
 * @typedef {{ name: string, paints: Paint[] }} Run
 */

/** @type {Run[]} */
const RUNS = [];
for (const dt of [PAINT_MS, SLOWER_PAINT_MS]) {
  for (const delay of DELAYS) {
    RUNS.push({ name: `a_${delay}_ms_delay_at_${dt}_ms_paints`, paints: play(bursts(FEED, dt), delay).paints });
  }
  const lowered = delayedAt(bursts(FEED, dt), HALF, 0);
  RUNS.push({ name: `a_delay_lowered_mid_feed_at_${dt}_ms_paints`, paints: play(lowered, 250).paints });
  const raised = delayedAt(bursts(FEED, dt), HALF, 250);
  RUNS.push({ name: `a_delay_raised_mid_feed_at_${dt}_ms_paints`, paints: play(raised, 0).paints });
  const deeper = delayedAt(bursts(FEED, dt), HALF, 2 * CATCH_UP_MS);
  RUNS.push({ name: `a_delay_raised_past_the_time_constant_at_${dt}_ms_paints`, paints: play(deeper, 0).paints });
}

/**
 * The moves `paints` made from a playhead the paint before left, without the restarts.
 *
 * @param {Paint[]} paints
 * @returns {Move[]}
 */
function movesOf(paints) {
  return paints.flatMap((p) => {
    const newest = p.queue.length ? endOf(p.queue[p.queue.length - 1]) : NaN;
    if (Number.isNaN(newest) || p.d.restart || p.before === null) return [];
    return [{ before: p.before, after: p.d.playhead, target: newest - p.delay, newest, dt: p.dt }];
  });
}

//: What each run's moves must never do, as the move that does it.
const BREACHES = {
  stands_still_at_a_paint_while_behind_the_target: (/** @type {Move} */ m) =>
    m.before < m.target && m.dt > 0 && m.after === m.before,
  moves_at_wall_time_or_slower_while_behind_the_target_and_short_of_it: (/** @type {Move} */ m) =>
    m.before < m.target && m.after < m.target && m.after - m.before <= m.dt,
  moves_past_the_target_from_at_or_behind_it: (/** @type {Move} */ m) => m.before <= m.target && m.after > m.target,
  moves_backward: (/** @type {Move} */ m) => m.after < m.before,
  jumps_further_than_its_speed_allows: (/** @type {Move} */ m) =>
    m.after - m.before > m.dt * (1 + Math.max(0, m.target - m.before) / CATCH_UP_MS) + 1e-9,
  moves_past_the_newest_queued_end: (/** @type {Move} */ m) => m.after > m.newest,
  moves_faster_than_wall_time_while_ahead_of_the_target: (/** @type {Move} */ m) =>
    m.before > m.target && m.after - m.before > m.dt + 1e-9,
  moves_while_a_whole_time_constant_or_more_ahead_of_the_target: (/** @type {Move} */ m) =>
    m.before - m.target >= CATCH_UP_MS && m.after !== m.before,
};

for (const run of RUNS) {
  for (const [breach, happens] of Object.entries(BREACHES)) {
    test(`test_in_${run.name}_the_playhead_never_${breach}`, () => {
      assert.deepEqual(movesOf(run.paints).filter(happens), []);
    });
  }

  test(`test_in_${run.name}_no_paint_after_the_first_restarts`, () => {
    assert.deepEqual(
      run.paints.slice(1).filter((p) => p.d.restart),
      [],
    );
  });
}

test("test_a_delay_lowered_mid_feed_leaves_the_playhead_at_the_new_target_once_the_feed_has_gone_on", () => {
  const { paints } = play(delayedAt(bursts(FEED), HALF, 0), 250);
  assert.equal(paints[paints.length - 1].d.playhead, EDGE);
});

test("test_a_delay_raised_mid_feed_leaves_the_playhead_at_the_new_target_once_the_feed_has_gone_on", () => {
  const { paints } = play(delayedAt(bursts(FEED), 1, 100), 0);
  assert.equal(paints[paints.length - 1].d.playhead, EDGE - 100);
});

/**
 * The playheads of the paints that ran at the wall times `walls` (ms), in order.
 *
 * @param {Paint[]} paints
 * @param {number[]} walls
 */
const playheadsAt = (paints, walls) => walls.map((w) => paints.find((p) => p.wall === w)?.d.playhead);

/**
 * Wall times, ms, every `every` ms from `every` to the end of the schedule bursts() writes for FEED.
 *
 * @param {number} every
 */
const walls = (every) =>
  Array.from({ length: Math.round(((FEED.length / BURST + 1) * GAP_MS) / every) }, (_, i) => (i + 1) * every);

for (const delay of DELAYS) {
  test(`test_two_paint_rates_at_a_${delay}_ms_delay_stand_at_the_same_playhead_at_the_end_of_every_gap`, () => {
    const faster = play(bursts(FEED, PAINT_MS), delay).paints;
    const slower = play(bursts(FEED, SLOWER_PAINT_MS), delay).paints;
    const ends = walls(GAP_MS);
    assert.deepEqual(playheadsAt(faster, ends), playheadsAt(slower, ends));
  });

  test(`test_two_paint_rates_at_a_${delay}_ms_delay_never_differ_by_more_than_the_slower_ones_interval_of_movement`, () => {
    const faster = play(bursts(FEED, PAINT_MS), delay).paints;
    const slower = play(bursts(FEED, SLOWER_PAINT_MS), delay).paints;
    const both = walls(SLOWER_PAINT_MS);
    const a = playheadsAt(faster, both);
    const b = playheadsAt(slower, both);
    const bound = SLOWER_PAINT_MS * (1 + (BURST * LONG) / CATCH_UP_MS);
    assert.deepEqual(
      both.filter((_, i) => Math.abs((a[i] ?? NaN) - (b[i] ?? NaN)) > bound),
      [],
    );
  });
}

test("test_the_same_wall_time_moves_the_playhead_the_same_distance_whatever_the_paint_rate_while_the_target_stands", () => {
  const to = (/** @type {number[]} */ paints) =>
    play(
      [
        { arrive: FEED.slice(0, BURST) },
        { paint: PAINT_MS },
        { arrive: FEED.slice(BURST, 2 * BURST) },
        ...paints.map((paint) => ({ paint })),
      ],
      250,
    ).paints.at(-1)?.d.playhead ?? NaN;
  assert.equal(Math.abs(to([PAINT_MS, PAINT_MS]) - to([SLOWER_PAINT_MS])) < 1e-9, true);
});
