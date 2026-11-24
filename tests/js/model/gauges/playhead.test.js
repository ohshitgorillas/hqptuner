// Timing suite for hqptuner/static/model/gauges/playhead.js: the one pacing decision a paint makes. Each paint shows
// the playback from where the last one ended up to the playhead, with no gap and no overlap. Where the playhead stands
// on the music's line is held by the tables (playhead-lag, playhead-motion, playhead-scroll and playhead-line); this
// suite holds what the paints do with the queue over a feed. The playhead never passes the newest queued frame's end.
// Every frame a paint passes is shown once, in full, across the paints that cross it, and leaves the queue once passed;
// a break restarts the paint at the break frame's stamp and leaves the frames before it behind.
//
// The test plays the store's part on a wall-time schedule it writes. `bursts` sends BURST frames every GAP_MS, a feed
// whose music arrives slower than wall time, so its queue runs down and the playhead stands at the newest end. The
// generated feeds send bursts of varied music at varied gaps, later bursts landing early and late against one another,
// at the delays in FEEDS: inside the buffer, the delay outlasts a burst's music, its landing off schedule and a late
// paint; past it, a gap outlasts the delay's queued music. The capture is the committed real feed, every frame that
// arrived by a paint taken at that paint. Paints run at steady and at uneven intervals, with a late and a dropped paint,
// one long stall and runs of slow paints. The owner's Safari capture (tests/support/fixtures/safari_paint_schedule.json)
// is one more feed, its frames at their own arrival times and its paints at their own times. After each paint the test
// drops the frames the decision consumed and hands the paint's end, playhead and delay to the next one, with whether the
// frame left at the front of the queue was queued when that paint decided. Each frame the decision is handed carries
// the wall time its own arrival landed at, and each paint its own wall time, both from the schedule: no clock is read,
// and the schedule is the order of arrivals and paints.
//
// Frame lengths are playback ms inside the measured feed event range, 17.3 to 23.2 ms, and change mid-feed. Every
// length and delay of the hand-written feeds is a whole number of eighths of a ms, so every stamp and span is exact.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { endOf, samplesToMs, secondsToMs, startOf, usToMs } from "../../../../hqptuner/static/lib/timebase.js";
import { pacePaint } from "../../../../hqptuner/static/model/gauges/playhead.js";
import { CAPTURE_FILE, PAINT_60HZ_MS } from "../../support/meter/capture.js";
import { seeded } from "../../support/meter/seeded.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").PaintDecision} PaintDecision */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").PaintInput} PaintInput */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").LeadState} LeadState */
/**
 * What a paint is handed beyond the queue and what the paint before it left: the paint's wall time, ms on the clock the
 * frames' `arrivedAt` is read on; whether any frame was queued since the paint before it; and the line's carried state,
 * null when no paint has run.
 *
 * @typedef {PaintInput & { now: number, arrived: boolean, line: LeadState | null }} Input
 */
/**
 * One step of a schedule: frames arrive at wall time `wall` (ms from the schedule's start), the delay becomes `delay`
 * (playback, ms), or a paint runs `paint` wall ms after the one before it.
 *
 * @typedef {{ arrive: MeterFrame[], wall: number } | { delay: number } | { paint: number }} Step
 */
/**
 * One paint as the test saw it: the queue handed in, the decision, whether any frame arrived since the paint before
 * it, and whether a break frame did; the delay it ran at and the delay the paint before it ran at (playback, ms; null
 * on the first), the playhead the paint before it left (null on the first), its `dt` (wall, ms) and the wall time it
 * ran at (ms from the schedule's start).
 *
 * @typedef {{ queue: MeterFrame[], d: PaintDecision, arrived: boolean, broke: boolean, delay: number,
 *   ran: number | null, before: number | null, dt: number, wall: number }} Paint
 */
/**
 * One paint that carried on from the playhead the paint before it left: where it left the playhead and the newest
 * queued frame's end (playback, ms; the end of the last paint when the queue is empty).
 *
 * @typedef {{ after: number, newest: number }} Move
 */
/**
 * Frames landing together: the wall time they land at (ms from the schedule's start) and the frames.
 *
 * @typedef {{ wall: number, frames: MeterFrame[] }} Arrival
 */
/**
 * A feed as a schedule can send it: its frames and when they land, and the wall time its last arrival lands at.
 *
 * @typedef {{ arrivals: Arrival[], last: number }} Feed
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
//: A raise that jumps the playhead back past all the music a paint has shown, playback ms.
const PAST_ALL = 1000;
//: Where a seek lands, playback ms: back before the feed's start, and forward past its end.
const SEEKS = [500, 9000];
//: How far before the first half's end a reconnect's first frame starts, playback ms: inside that frame's length.
const REJOIN_BACK = 10;
//: Wall ms the paints keep running after a generated feed's last arrival.
const TAIL_MS = 300;
//: Paint intervals in turn, wall ms: 60 Hz, 30 Hz, and uneven with late paints and one dropped.
const PATTERNS = {
  steady_60hz: [PAINT_MS],
  steady_30hz: [SLOWER_PAINT_MS],
  uneven: [16, 16, 48, 16, 33],
  a_long_stall: [...Array(40).fill(PAINT_MS), 640],
  runs_of_slow_paints: [...Array(25).fill(PAINT_MS), ...Array(7).fill(72)],
};
//: The capture rows that begin a break: its first frame, the only one whose stamp does not follow the one before it.
const CAPTURE_BREAKS = [0];

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
    while (next < groups.length && next * GAP_MS + ARRIVE_MS <= wall) {
      out.push({ arrive: groups[next], wall: next * GAP_MS + ARRIVE_MS });
      next++;
    }
    out.push({ paint: dt });
  }
  return out;
}

/**
 * The steps of `arrivals` painted at `intervals` in turn (wall ms) until the paints have run past wall time `until`;
 * an arrival is seen by the first paint at or after it.
 *
 * @param {Arrival[]} arrivals
 * @param {number[]} intervals
 * @param {number} until  wall, ms
 * @returns {Step[]}
 */
function scheduled(arrivals, intervals, until) {
  /** @type {Step[]} */
  const out = [];
  let next = 0;
  let wall = 0;
  for (let i = 0; wall < until; i++) {
    const paint = intervals[i % intervals.length];
    wall += paint;
    while (next < arrivals.length && arrivals[next].wall <= wall) {
      out.push({ arrive: arrivals[next].frames, wall: arrivals[next].wall });
      next++;
    }
    out.push({ paint });
  }
  return out;
}

/**
 * `steps` with the delay becoming `delay` just before arrival number `burst` lands.
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

/**
 * A bursty feed: `count` bursts, each carrying between `lo` and `hi` playback ms of music in frames that change length
 * from one to the next, one burst landing where the music before it would have ended on the wall plus or minus
 * `jitter` wall ms, so later bursts land early and late against one another.
 *
 * @param {{ seed: number, count: number, burst: number[], jitter: number }} spec  burst: the least and the most music a burst
 * holds, playback ms
 * @returns {Feed}
 */
function generated({ seed, count, burst: [lo, hi], jitter }) {
  const rand = seeded(seed);
  /** @type {Arrival[]} */
  const arrivals = [];
  let at = START;
  let music = 0;
  let wall = ARRIVE_MS;
  for (let k = 0; k < count; k++) {
    const want = lo + rand() * (hi - lo);
    /** @type {MeterFrame[]} */
    const group = [];
    let held = 0;
    while (held < want) {
      const ms = (139 + Math.floor(rand() * 47)) / 8;
      group.push({ channels: [], at, ms, break: k === 0 && group.length === 0 });
      at += ms;
      held += ms;
    }
    if (k > 0) wall = Math.max(wall, music + (rand() * 2 - 1) * jitter);
    arrivals.push({ wall, frames: group });
    music += held;
  }
  return { arrivals, last: wall };
}

/**
 * The committed capture as a feed: each frame at its own arrival time, its stamp in ms at the geometry's rate.
 *
 * @returns {Feed & { delay: number }}  delay: the engine's output delay plus the owner's offset, playback, ms
 */
function capture() {
  const raw = JSON.parse(readFileSync(CAPTURE_FILE, "utf8"));
  const rate = JSON.parse(raw.events.find((/** @type {{ event: string }} */ ev) => ev.event === "geometry").data).rate;
  /** @type {Arrival[]} */
  const arrivals = [];
  const rows = raw.events.filter((/** @type {{ event: string }} */ ev) => ev.event === "frame");
  rows.forEach((/** @type {{ data: string, t_ms: number }} */ e, /** @type {number} */ i) => {
    const { at, n } = JSON.parse(e.data);
    const frame = {
      channels: [],
      at: samplesToMs(at, rate),
      end: samplesToMs(at + n, rate),
      ms: samplesToMs(n, rate),
      break: CAPTURE_BREAKS.includes(i),
    };
    arrivals.push({ wall: e.t_ms, frames: [frame] });
  });
  const delay = usToMs(Number(raw.engine_output_delay)) + secondsToMs(raw.owner_spectrum_offset_s);
  return { arrivals, last: arrivals[arrivals.length - 1].wall, delay };
}

//: The owner's Safari capture of paint and arrival times, read, never written, and the lengths its frames take in turn.
const SAFARI_FILE = new URL("../../../support/fixtures/safari_paint_schedule.json", import.meta.url);
const SAFARI_LENGTHS = [20, 64 / 3, 68 / 3];

/**
 * The Safari capture as a feed painted at its own paint times from the paint its first frame reaches: each frame at its
 * own arrival time, laid end to end in lengths that change from one frame to the next.
 *
 * @returns {Feed & { delay: number, intervals: number[] }}  delay: the owner's spectrum offset, playback, ms
 */
function safari() {
  const raw = JSON.parse(readFileSync(SAFARI_FILE, "utf8"));
  const first = raw.raf.findIndex((/** @type {number} */ t) => t >= raw.feed[0]);
  const start = raw.raf[first - 1];
  let at = START;
  const arrivals = raw.feed.map((/** @type {number} */ t, /** @type {number} */ i) => {
    const ms = SAFARI_LENGTHS[i % SAFARI_LENGTHS.length];
    const frame = { channels: [], at, ms, break: i === 0 };
    at += ms;
    return { wall: t - start, frames: [frame] };
  });
  const paints = raw.raf.slice(first - 1);
  return {
    arrivals,
    last: arrivals[arrivals.length - 1].wall,
    delay: secondsToMs(Number(raw.store["hqptuner.spectrumOffset"])),
    intervals: paints.slice(1).map((/** @type {number} */ t, /** @type {number} */ i) => t - paints[i]),
  };
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
 * paint's end, playhead and delay, and whether the frame at the queue's front was queued when the last paint decided,
 * drop what it consumed. The decision is handed a copy of each queued frame with `arrivedAt` set to the wall time its
 * own arrival landed at; the paints record the frames themselves, so the shared feeds are never changed and a case
 * compares the frames it means.
 *
 * @param {Step[]} steps
 * @param {number} delay  playback, ms
 * @returns {{ paints: Paint[], queue: MeterFrame[] }}
 */
function play(steps, delay) {
  /** @type {MeterFrame[]} */
  let queue = [];
  /** @type {MeterFrame[]} */
  let stamped = [];
  /** @type {number | null} */
  let end = null;
  /** @type {number | null} */
  let before = null;
  /** @type {number | null} */
  let ran = null;
  let started = false;
  let arrived = false;
  let broke = false;
  let wall = 0;
  let now = delay;
  /** @type {LeadState | null} */
  let line = null;
  /** @type {Paint[]} */
  const paints = [];
  for (const step of steps) {
    if ("delay" in step) {
      now = step.delay;
    } else if ("arrive" in step) {
      queue = [...queue, ...step.arrive];
      stamped = [...stamped, ...step.arrive.map((f) => ({ ...f, arrivedAt: step.wall }))];
      arrived = true;
      broke = broke || step.arrive.some((f) => f.break);
    } else {
      wall += step.paint;
      /** @type {Input} */
      const input = {
        end,
        playhead: before,
        delayed: ran,
        started,
        frames: stamped,
        delay: now,
        dt: step.paint,
        now: wall,
        arrived,
        line,
      };
      const d = pacePaint(input);
      line = d.line;
      paints.push({ queue, d, arrived, broke, delay: now, ran, before, dt: step.paint, wall });
      queue = queue.slice(d.consumed);
      stamped = stamped.slice(d.consumed);
      end = d.to;
      before = Number.isNaN(d.playhead) ? null : d.playhead;
      ran = now;
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
const inside = (f, { from, to }) => Math.max(0, Math.min(endOf(f), to) - Math.max(startOf(f), from));

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
    assert.deepEqual(joined(paints), [{ from: START, to: paints[paints.length - 1].d.playhead }]);
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

  test(`test_the_queue_after_the_feed_at_a_${delay}_ms_delay_holds_exactly_the_frames_ending_past_the_playhead`, () => {
    const { paints, queue } = play(bursts(FEED), delay);
    const head = paints[paints.length - 1].d.playhead;
    assert.deepEqual(
      queue.map((f) => f.at),
      FEED.filter((f) => endOf(f) > head).map((f) => f.at),
    );
  });
}

test("test_the_playhead_at_a_0_ms_delay_stands_that_far_behind_the_newest_frames_end", () => {
  const { paints } = play(bursts(FEED), 0);
  assert.equal(paints[paints.length - 1].d.playhead, EDGE);
});

//: A 0 ms delay stands the playhead at the newest end, so there it moves only at a paint a frame arrived before.
for (const delay of DELAYS.filter((d) => d > 0)) {
  test(`test_the_playhead_at_a_${delay}_ms_delay_moves_at_a_paint_no_frame_arrived_before`, () => {
    const { paints } = play(bursts(FEED), delay);
    assert.equal(
      paints.some((p) => !p.arrived && p.before !== null && p.d.playhead !== p.before),
      true,
    );
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

/**
 * A run the movement tests read: the name that says what was fed, and its paints.
 *
 * @typedef {{ name: string, paints: Paint[] }} Run
 */

//: The generated feeds: the delay each runs at (playback, ms), the music a burst holds and how far it lands off its
//: schedule. Inside the buffer, the delay outlasts a burst's music, its landing off schedule and a late paint; past it,
//: a gap outlasts the delay.
const FEEDS = [
  {
    name: "inside_a_short_delay",
    delay: 300,
    spec: { seed: 1, count: 30, burst: [40, 120], jitter: 30 },
  },
  {
    name: "inside_a_long_delay",
    delay: 600,
    spec: { seed: 2, count: 24, burst: [150, 260], jitter: 60 },
  },
  {
    name: "inside_the_captures_delay",
    delay: 1247.682,
    spec: { seed: 3, count: 20, burst: [100, 262], jitter: 80 },
  },
  { name: "past_no_delay", delay: 0, spec: { seed: 4, count: 24, burst: [60, 200], jitter: 50 } },
  {
    name: "past_a_short_delay",
    delay: 120,
    spec: { seed: 5, count: 24, burst: [200, 300], jitter: 50 },
  },
].map((f) => ({ ...f, feed: generated(f.spec) }));
//: The generated feed claims that read arrivals and delay changes run on: inside the buffer, a long delay.
const LONG_ONE = FEEDS[1];

/** @type {Run[]} */
const RUNS = [];
for (const dt of [PAINT_MS, SLOWER_PAINT_MS]) {
  for (const delay of DELAYS) {
    RUNS.push({
      name: `a_${delay}_ms_delay_at_${dt}_ms_paints`,
      paints: play(bursts(FEED, dt), delay).paints,
    });
  }
  const lowered = delayedAt(bursts(FEED, dt), HALF, 0);
  RUNS.push({ name: `a_delay_lowered_mid_feed_at_${dt}_ms_paints`, paints: play(lowered, 250).paints });
  const raised = delayedAt(bursts(FEED, dt), HALF, 250);
  RUNS.push({ name: `a_delay_raised_mid_feed_at_${dt}_ms_paints`, paints: play(raised, 0).paints });
  const deeper = delayedAt(bursts(FEED, dt), HALF, PAST_ALL);
  RUNS.push({
    name: `a_delay_raised_past_all_music_shown_at_${dt}_ms_paints`,
    paints: play(deeper, 0).paints,
  });
}
for (const { name, delay, feed } of FEEDS) {
  for (const [rate, intervals] of Object.entries(PATTERNS)) {
    const steps = scheduled(feed.arrivals, intervals, feed.last + TAIL_MS);
    RUNS.push({ name: `${name}_at_${rate}`, paints: play(steps, delay).paints });
  }
}
for (const [rate, intervals] of Object.entries(PATTERNS)) {
  const steps = scheduled(LONG_ONE.feed.arrivals, intervals, LONG_ONE.feed.last + TAIL_MS);
  const to = (/** @type {number} */ delay) => delayedAt(steps, 8, delay);
  RUNS.push({
    name: `a_long_delay_lowered_mid_feed_at_${rate}`,
    paints: play(to(150), LONG_ONE.delay).paints,
  });
  RUNS.push({
    name: `a_long_delay_raised_mid_feed_at_${rate}`,
    paints: play(to(1500), LONG_ONE.delay).paints,
  });
}
const CAPTURE = capture();
const SAFARI = safari();
RUNS.push({
  name: "the_safari_capture_at_its_own_paints",
  paints: play(scheduled(SAFARI.arrivals, SAFARI.intervals, SAFARI.last + TAIL_MS), SAFARI.delay).paints,
});
RUNS.push({
  name: "the_capture_at_its_delay_at_60_hz",
  paints: play(scheduled(CAPTURE.arrivals, [PAINT_60HZ_MS], CAPTURE.last), CAPTURE.delay).paints,
});

/**
 * The moves `paints` made from a playhead the paint before left, without the restarts.
 *
 * @param {Paint[]} paints
 * @returns {Move[]}
 */
function movesOf(paints) {
  return paints.flatMap((p) => {
    const newest = p.queue.length ? endOf(p.queue[p.queue.length - 1]) : p.d.to;
    if (Number.isNaN(newest) || p.d.restart || p.before === null || p.ran === null) return [];
    return [{ after: p.d.playhead, newest }];
  });
}

//: What each run's moves must never do, as the move that does it.
const BREACHES = {
  moves_past_the_newest_queued_end: (/** @type {Move} */ m) => m.after > m.newest,
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

for (const run of RUNS) {
  test(`test_in_${run.name}_the_lead_frame_is_the_one_frame_covering_most_of_each_paints_span`, () => {
    const off = run.paints.filter(({ queue, d }) => {
      if (d.last === d.first) return false;
      const leads = d.lead >= d.first && d.lead < d.last;
      const mine = leads ? inside(queue[d.lead], d) : Infinity;
      return !leads || queue.slice(d.first, d.last).some((f) => inside(f, d) > mine);
    });
    assert.deepEqual({ shown: run.paints.some((p) => p.d.last > p.d.first), off: off.length }, { shown: true, off: 0 });
  });
}

test("test_a_delay_lowered_mid_feed_leaves_the_playhead_at_the_new_target_once_the_feed_has_gone_on", () => {
  const { paints } = play(delayedAt(bursts(FEED), HALF, 0), 250);
  assert.equal(paints[paints.length - 1].d.playhead, EDGE);
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
  test(`test_two_paint_rates_at_a_${delay}_ms_delay_stand_at_the_same_playhead_once_both_stand_at_the_newest_end`, () => {
    const faster = play(bursts(FEED, PAINT_MS), delay).paints;
    const slower = play(bursts(FEED, SLOWER_PAINT_MS), delay).paints;
    const end = walls(GAP_MS).slice(-1);
    assert.deepEqual(playheadsAt(faster, end), playheadsAt(slower, end));
  });

  test(`test_two_paint_rates_at_a_${delay}_ms_delay_never_differ_by_more_than_the_slower_ones_interval_of_movement`, () => {
    const faster = play(bursts(FEED, PAINT_MS), delay).paints;
    const slower = play(bursts(FEED, SLOWER_PAINT_MS), delay).paints;
    const both = walls(SLOWER_PAINT_MS);
    const a = playheadsAt(faster, both);
    const b = playheadsAt(slower, both);
    assert.deepEqual(
      both.filter((_, i) => Math.abs((a[i] ?? NaN) - (b[i] ?? NaN)) > SLOWER_PAINT_MS),
      [],
    );
  });
}

test("test_the_same_wall_time_moves_the_playhead_the_same_distance_whatever_the_paint_rate_short_of_the_newest_end", () => {
  const to = (/** @type {number[]} */ paints) =>
    play(
      [
        { arrive: FEED.slice(0, BURST), wall: ARRIVE_MS },
        { paint: PAINT_MS },
        { arrive: FEED.slice(BURST, 2 * BURST), wall: PAINT_MS + ARRIVE_MS },
        ...paints.map((paint) => ({ paint })),
      ],
      250,
    ).paints.at(-1)?.d.playhead ?? NaN;
  assert.equal(to([PAINT_MS, PAINT_MS]), to([SLOWER_PAINT_MS]));
});
