// Timing suite for hqptuner/static/model/gauges/playhead.js: the one pacing decision a paint makes. Each paint shows
// the playback from where the last one ended up to the playhead, with no gap and no overlap. The playhead moves at wall
// speed, the paint's `dt`: it never passes the newest queued frame's end, stands there until the next arrival, and no
// arrival changes its speed. A delay change is the one exception: at the first paint at a changed delay the playhead
// jumps by the change, forward for a lowered delay and back for a raised one. It never moves backward outside a break
// or a raised delay. Every frame a paint passes is shown once, in full, across the paints that cross it, and leaves the
// queue once passed; a break restarts the paint at the break frame's stamp, the playhead one delay behind the newest
// end, and leaves the frames before it behind.
//
// The test plays the store's part on a wall-time schedule it writes. `bursts` sends BURST frames every GAP_MS, a feed
// whose music arrives slower than wall time, so its queue runs down and the playhead stands at the newest end. The
// generated feeds send bursts of varied music at varied gaps, later bursts landing early and late against one another,
// at the delays in FEEDS: inside the buffer, a playhead at wall speed never reaches the newest end on them; past it, a
// gap outlasts the delay's queued music. The capture is the committed real feed, every frame that arrived by a paint
// taken at that paint. Paints run at steady and at uneven intervals, with a late and a dropped paint. After each paint
// the test drops the frames the decision consumed and hands the paint's end, playhead and delay to the next one, with
// whether the frame left at the front of the queue was queued when that paint decided. No clock is read: the schedule
// is the order of arrivals and paints, and the `dt` each paint is handed is the only time there is.
//
// Frame lengths are playback ms inside the measured feed event range, 17.3 to 23.2 ms, and change mid-feed. Every
// length and delay of the hand-written feeds is a whole number of eighths of a ms, so every stamp and span is exact.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pacePaint } from "../../../../hqptuner/static/model/gauges/playhead.js";

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
 * it, and whether a break frame did; the delay it ran at and the delay the paint before it ran at (playback, ms; null
 * on the first), the playhead the paint before it left (null on the first), its `dt` (wall, ms) and the wall time it
 * ran at (ms from the schedule's start).
 *
 * @typedef {{ queue: MeterFrame[], d: PaintDecision, arrived: boolean, broke: boolean, delay: number,
 *   ran: number | null, before: number | null, dt: number, wall: number }} Paint
 */
/**
 * One paint that carried on from the playhead the paint before it left: the newest queued frame's end (playback, ms;
 * the end of the last paint when the queue is empty), how far the delay fell since the paint before it (playback, ms;
 * negative for a raise), and the wall time it ran at.
 *
 * @typedef {{ before: number, after: number, newest: number, dt: number, jump: number, wall: number }} Move
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
//: The most a float sum of wall times may differ from the whole, ms.
const EPS = 1e-9;
//: Paint intervals in turn, wall ms: 60 Hz, 30 Hz, and uneven with late paints and one dropped.
const PATTERNS = { steady_60hz: [PAINT_MS], steady_30hz: [SLOWER_PAINT_MS], uneven: [16, 16, 48, 16, 33] };
//: How far later bursts land against the schedule they were generated on, wall ms, in turn: early and late.
const SHIFTS = [-40, 55, -15, 35, 60, -30];
//: The committed capture of the dev container's feed, read, never written.
const CAPTURE_FILE = new URL("../../../support/fixtures/meter_feed_capture.json", import.meta.url);
//: The capture's paint interval, wall ms: 60 Hz.
const CAPTURE_PAINT_MS = 1000 / 60;
const MS_PER_S = 1000;
const US_PER_MS = 1000;

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
    while (next < arrivals.length && arrivals[next].wall <= wall) out.push({ arrive: arrivals[next++].frames });
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
 * A deterministic stream of numbers in [0, 1) from `seed`.
 *
 * @param {number} seed
 * @returns {() => number}
 */
function random(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  const rand = random(seed);
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
  let ends = NaN;
  for (const e of raw.events.filter((/** @type {{ event: string }} */ ev) => ev.event === "frame")) {
    const { at, n } = JSON.parse(e.data);
    const frame = { channels: [], at: (at * MS_PER_S) / rate, ms: (n * MS_PER_S) / rate, break: at !== ends };
    ends = at + n;
    arrivals.push({ wall: e.t_ms, frames: [frame] });
  }
  const delay = Number(raw.engine_output_delay) / US_PER_MS + raw.owner_spectrum_offset_s * MS_PER_S;
  return { arrivals, last: arrivals[arrivals.length - 1].wall, delay };
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
 * drop what it consumed.
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
  /** @type {number | null} */
  let ran = null;
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
      const d = pacePaint({ end, playhead: before, delayed: ran, started, frames: queue, delay: now, dt: step.paint });
      paints.push({ queue, d, arrived, broke, delay: now, ran, before, dt: step.paint, wall });
      queue = queue.slice(d.consumed);
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

  test(`test_the_playhead_at_a_${delay}_ms_delay_moves_at_a_paint_no_frame_arrived_before`, () => {
    const { paints } = play(bursts(FEED), delay);
    assert.equal(
      paints.some((p) => !p.arrived && p.before !== null && p.d.playhead !== p.before),
      true,
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
 * A run the movement tests read: the name that says what was fed, its paints, and the wall time (ms) until which the
 * feed stays inside the buffer, null when it does not.
 *
 * @typedef {{ name: string, paints: Paint[], until: number | null }} Run
 */

//: The generated feeds: the delay each runs at (playback, ms), the music a burst holds and how far it lands off its
//: schedule. Inside the buffer, the delay outlasts a burst's music, its landing off schedule and a late paint; past it,
//: a gap outlasts the delay.
const FEEDS = [
  {
    name: "inside_a_short_delay",
    delay: 300,
    inside: true,
    spec: { seed: 1, count: 30, burst: [40, 120], jitter: 30 },
  },
  {
    name: "inside_a_long_delay",
    delay: 600,
    inside: true,
    spec: { seed: 2, count: 24, burst: [150, 260], jitter: 60 },
  },
  {
    name: "inside_the_captures_delay",
    delay: 1247.682,
    inside: true,
    spec: { seed: 3, count: 20, burst: [100, 262], jitter: 80 },
  },
  { name: "past_no_delay", delay: 0, inside: false, spec: { seed: 4, count: 24, burst: [60, 200], jitter: 50 } },
  {
    name: "past_a_short_delay",
    delay: 120,
    inside: false,
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
      until: null,
    });
  }
  const lowered = delayedAt(bursts(FEED, dt), HALF, 0);
  RUNS.push({ name: `a_delay_lowered_mid_feed_at_${dt}_ms_paints`, paints: play(lowered, 250).paints, until: null });
  const raised = delayedAt(bursts(FEED, dt), HALF, 250);
  RUNS.push({ name: `a_delay_raised_mid_feed_at_${dt}_ms_paints`, paints: play(raised, 0).paints, until: null });
  const deeper = delayedAt(bursts(FEED, dt), HALF, PAST_ALL);
  RUNS.push({
    name: `a_delay_raised_past_all_music_shown_at_${dt}_ms_paints`,
    paints: play(deeper, 0).paints,
    until: null,
  });
}
for (const { name, delay, inside: within, feed } of FEEDS) {
  for (const [rate, intervals] of Object.entries(PATTERNS)) {
    const steps = scheduled(feed.arrivals, intervals, feed.last + TAIL_MS);
    RUNS.push({ name: `${name}_at_${rate}`, paints: play(steps, delay).paints, until: within ? feed.last : null });
  }
}
for (const [rate, intervals] of Object.entries(PATTERNS)) {
  const steps = scheduled(LONG_ONE.feed.arrivals, intervals, LONG_ONE.feed.last + TAIL_MS);
  const to = (/** @type {number} */ delay) => delayedAt(steps, 8, delay);
  RUNS.push({
    name: `a_long_delay_lowered_mid_feed_at_${rate}`,
    paints: play(to(150), LONG_ONE.delay).paints,
    until: null,
  });
  RUNS.push({
    name: `a_long_delay_raised_mid_feed_at_${rate}`,
    paints: play(to(1500), LONG_ONE.delay).paints,
    until: null,
  });
}
const CAPTURE = capture();
RUNS.push({
  name: "the_capture_at_its_delay_at_60_hz",
  paints: play(scheduled(CAPTURE.arrivals, [CAPTURE_PAINT_MS], CAPTURE.last), CAPTURE.delay).paints,
  until: CAPTURE.last,
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
    return [{ before: p.before, after: p.d.playhead, newest, dt: p.dt, jump: p.ran - p.delay, wall: p.wall }];
  });
}

//: What each run's moves must never do, as the move that does it.
const BREACHES = {
  moves_other_than_its_wall_time_at_an_unchanged_delay_short_of_the_newest_end: (/** @type {Move} */ m) =>
    m.jump === 0 && m.after < m.newest && Math.abs(m.after - m.before - m.dt) > EPS,
  jumps_further_than_its_wall_time_at_an_unchanged_delay: (/** @type {Move} */ m) =>
    m.jump === 0 && m.after - m.before > m.dt + EPS,
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

for (const run of RUNS.filter((r) => r.until !== null)) {
  test(`test_in_${run.name}_the_playhead_moves_exactly_its_wall_time_at_every_paint_while_the_feed_lands`, () => {
    const until = run.until ?? NaN;
    assert.deepEqual(
      movesOf(run.paints).filter((m) => m.wall <= until && Math.abs(m.after - m.before - m.dt) > EPS),
      [],
    );
  });
}

/**
 * The moves of every run that lowered the delay (jump > 0) or raised it (jump < 0).
 *
 * @param {(jump: number) => boolean} changed
 */
const jumpsOf = (changed) => RUNS.flatMap((r) => movesOf(r.paints)).filter((m) => changed(m.jump));

test("test_at_the_first_paint_at_a_lowered_delay_the_playhead_jumps_forward_by_the_drop_or_stands_at_the_newest_end", () => {
  const moves = jumpsOf((j) => j > 0);
  assert.deepEqual(
    { some: moves.length > 0, after: moves.map((m) => m.after) },
    { some: true, after: moves.map((m) => Math.min(m.before + m.dt + m.jump, m.newest)) },
  );
});

test("test_at_the_first_paint_at_a_raised_delay_the_playhead_jumps_back_by_the_raise", () => {
  const moves = jumpsOf((j) => j < 0);
  assert.deepEqual(
    { some: moves.length > 0, after: moves.map((m) => m.after) },
    { some: true, after: moves.map((m) => m.before + m.dt + m.jump) },
  );
});

test("test_a_delay_lowered_mid_feed_leaves_the_playhead_at_the_new_target_once_the_feed_has_gone_on", () => {
  const { paints } = play(delayedAt(bursts(FEED), HALF, 0), 250);
  assert.equal(paints[paints.length - 1].d.playhead, EDGE);
});

/**
 * The playheads of `arrivals` painted at a steady 60 Hz through wall time `until`, keyed by the wall time they ran at,
 * for the paints that left the playhead short of the newest end.
 *
 * @param {Arrival[]} arrivals
 * @param {number} delay  playback, ms
 * @param {number} until  wall, ms
 */
function standing(arrivals, delay, until) {
  const moves = movesOf(play(scheduled(arrivals, [PAINT_MS], until), delay).paints);
  return new Map(moves.filter((m) => m.after < m.newest).map((m) => [m.wall, m.after]));
}

test("test_a_burst_landing_early_or_late_leaves_the_playhead_where_it_was_at_every_paint_short_of_the_newest_end", () => {
  const { feed, delay } = LONG_ONE;
  let landed = 0;
  const retimed = feed.arrivals.map((a, i) => {
    landed = Math.max(landed, i ? a.wall + SHIFTS[i % SHIFTS.length] : a.wall);
    return { wall: landed, frames: a.frames };
  });
  const until = feed.last + TAIL_MS;
  const on = standing(feed.arrivals, delay, until);
  const off = standing(retimed, delay, until);
  const both = [...on.keys()].filter((wall) => off.has(wall));
  assert.deepEqual(
    {
      some: both.length > 0,
      apart: both.filter((wall) => Math.abs((on.get(wall) ?? NaN) - (off.get(wall) ?? NaN)) > EPS),
    },
    { some: true, apart: [] },
  );
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
        { arrive: FEED.slice(0, BURST) },
        { paint: PAINT_MS },
        { arrive: FEED.slice(BURST, 2 * BURST) },
        ...paints.map((paint) => ({ paint })),
      ],
      250,
    ).paints.at(-1)?.d.playhead ?? NaN;
  assert.equal(Math.abs(to([PAINT_MS, PAINT_MS]) - to([SLOWER_PAINT_MS])) < 1e-9, true);
});
