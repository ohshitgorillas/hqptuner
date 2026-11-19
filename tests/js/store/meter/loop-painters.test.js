// Store suite for the painters' side of hqptuner/static/store/meter/loop.js: every paint while the meter feed is open,
// the loop hands each painter subscribed through onMeterPaint the scene the paint shows and `dt`, the wall time since
// the paint before it, in ms.
//
// `dt` is the loop's true interval: each paint's is the wall time since the paint before
// it however long that was, and the first paint after the feed opens is handed none of the time it was closed. The
// scene folds the frames the paint shows and no other: a frame the
// delay still holds back stays out until a paint reaches it, the frames are folded alike whatever order they arrived
// in, a paint that shows no frame hands the scene as it stood, and a paint at a break starts from nothing heard and
// says it restarted. While the feed is closed no painter is called, and a painter that subscribes or unsubscribes
// during a paint costs no painter that paint.
//
// Over generated bursty feeds inside the buffer, at two delays and steady and uneven paint waits, and over the committed
// capture at its delay, every frame carrying a reading that names it: the playhead moves each paint's wall time, the
// scene is never handed as it stood for longer than a frame lasts, and no paint is handed more music than its wall time
// and one frame cover.
//
// The loop paints only while the feed is open and the engine plays (docs/superpowers/specs/meter-loop-idle-design.md,
// Modules). When either stops holding, every painter still subscribed is handed the scene once, restarted, with
// nothing heard and `dt` 0, so the meters clear, and is called no more until both hold again; then the loop starts
// afresh, its first paint handed `dt` 0 and none of the idle time. The loop starts or stops only when that two-way
// condition changes: a status poll that leaves the engine stopped calls no painter, one that leaves it playing restarts
// no scene, and neither does a signal a painter reads changing while the engine plays.
//
// The stores pace on one fake clock (tests/js/support/clock.js) whose animation frames run after the waits in
// FRAME_GAPS_MS in turn, from a 60 Hz frame to a hidden tab's second, so paints are unevenly spaced. The feed is the
// EventSource fake (tests/js/support/eventsource.js); `follow` (tests/js/support/meterfeed.js) sends its frames at the
// lengths in LENGTHS, which span 17.3 to 23.2 ms and change mid-feed, each carrying one of the two readings LOUD and
// QUIET. The delay is the spectrum offset the user types, the engine reporting no output delay.
//
// Not covered here: that a paint's work is bounded and allocates nothing beyond the scene it reuses. Neither is
// observable through the stores' public surface without measuring time or memory.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-painters.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signal } from "@preact/signals-core";

import { onMeterPaint } from "../../../../hqptuner/static/store/meter/loop.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { lastStream } from "../../support/eventsource.js";
import { STOPPED, poll } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import { MONO_BINS, RATE_44K, follow, geometry } from "../../support/meterfeed.js";
import {
  BINS,
  LENGTHS,
  SILENT,
  STEREO,
  bootMeter,
  capturedFeed,
  frameTimes,
  generatedLandings,
  setDelays,
} from "../../support/meter/meterrig.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene} MeterScene */
/** @typedef {import("../../support/meter/meterrig.js").Landing} Landing */
/** @typedef {import("../../support/meter/meterrig.js").Delays} Delays */

/** Wall time, ms, from one animation frame being asked for to its running, in turn. */
const FRAME_GAPS_MS = [16, 33, 17, 250, 41, 1000, 16.7];

/** The waits the clock runs animation frames after, in turn: FRAME_GAPS_MS unless a case sets its own. */
let frameGaps = FRAME_GAPS_MS;

/** Wall time, ms, one settle runs the clock on: several animation frames, however long each waits. */
const SETTLE_MS = 2500;

/** Wall time, ms, a closed feed stays closed. */
const CLOSED_MS = 60000;

/** The delay the cases run at unless they set none, in seconds: shorter than a run of LENGTHS sent three times. */
const DELAY_S = 0.25;

/** The delay, s, the held-back cases run at: past what one settle covers, so the playhead cannot reach the newest frame. */
const HELD_BACK_S = 3.5;

/** How many times LENGTHS is sent ahead of the held-back frame: music enough that the delay's playhead starts inside it. */
const AHEAD = 40;

/** An hour of samples at 44.1 kHz: where the frame that breaks from every run sent here starts. */
const AN_HOUR_ON = 158760000;

/** One channel's reading, loud. */
const LOUD = { peak: -1.5, rms: -6.25, bins: MONO_BINS };

/** One channel's reading, quiet. */
const QUIET = { peak: -24.5, rms: -33.75, bins: MONO_BINS };

const fake = fakeClock();

/** Wall time, ms on the clock, of every animation frame the clock has run since the case began. @type {number[]} */
let framesRun = [];
let gapAt = 0;

/** @type {Clock} */
const clock = {
  ...fake.clock,
  requestAnimationFrame: (fn) => {
    const wait = frameGaps[gapAt % frameGaps.length];
    gapAt += 1;
    return fake.clock.setTimeout(() => {
      const now = fake.clock.now();
      framesRun.push(now);
      fn(now);
    }, wait);
  },
};

/** Run the clock on far enough for several paints. */
const settle = () => fake.advance(SETTLE_MS);

/**
 * Send LENGTHS `times` over on the stream open now, every frame carrying `reading` on each of `channels` channels.
 *
 * @param {typeof LOUD} reading
 * @param {number} times
 * @param {number} [channels]
 */
function run(reading, times, channels = 1) {
  const all = Array.from({ length: channels }, () => reading);
  for (let i = 0; i < times; i++) for (const n of LENGTHS) follow(all, n);
}

/** Send one frame carrying QUIET an hour of samples on, a break from every run sent before it. */
function jump() {
  lastStream()?.emit("frame", { channels: [QUIET], at: AN_HOUR_ON, n: LENGTHS[2] });
}

/**
 * One paint as a painter saw it.
 *
 * @typedef {object} Painted
 * @property {number} now  wall time, ms on the clock, when the painter was called
 * @property {number} dt  wall time, ms, the loop handed it
 * @property {number} peak  dBFS: the scene's first channel; NaN when it has none
 * @property {number} rms  dBFS: the scene's first channel; NaN when it has none
 * @property {boolean} restart
 * @property {number | null} head  playback, ms: the playhead signal when the painter was called
 * @property {Array<{ peak: number, rms: number, bins: number[] }>} channels  every channel of the scene: dBFS, bins
 *   copied when the painter was called
 */

/** The unsubscribers of every painter a case subscribed. @type {Array<() => void>} */
const subscribed = [];

/**
 * Subscribe a painter that writes down every paint it is handed.
 *
 * @returns {Painted[]}
 */
function subscribe() {
  /** @type {Painted[]} */
  const into = [];
  const unsubscribe = onMeterPaint((/** @type {MeterScene} */ scene, /** @type {number} */ dt) => {
    const ch = scene.channels[0];
    const channels = scene.channels.map((c) => ({ peak: c.peak, rms: c.rms, bins: Array.from(c.bins) }));
    into.push({
      now: clock.now(),
      dt,
      peak: ch ? ch.peak : NaN,
      rms: ch ? ch.rms : NaN,
      restart: scene.restart,
      head: playhead.value,
      channels,
    });
  });
  subscribed.push(unsubscribe);
  return into;
}

beforeEach(() => {
  bootMeter(clock, { delayS: DELAY_S, loop: true });
  settle();
  lastStream()?.emit("geometry", geometry(RATE_44K));
  framesRun = [];
  frameGaps = FRAME_GAPS_MS;
});

afterEach(() => {
  for (const unsubscribe of subscribed) unsubscribe();
  subscribed.length = 0;
});

test("test_each_paint_hands_its_painters_the_wall_time_since_the_paint_before_it_in_ms", () => {
  const paints = subscribe();
  for (const reading of [QUIET, LOUD, QUIET]) {
    run(reading, 1);
    settle();
  }
  const gaps = framesRun.slice(1).map((t, i) => t - framesRun[i]);
  assert.deepEqual(
    paints.slice(1).map((p) => p.dt),
    gaps,
  );
});

test("test_the_paints_after_the_feed_reopens_are_handed_none_of_the_time_it_was_closed", () => {
  const paints = subscribe();
  run(QUIET, 1);
  settle();
  engineStatus.value = { metering: false };
  fake.advance(CLOSED_MS);
  const reopened = clock.now();
  poll();
  lastStream()?.emit("geometry", geometry(RATE_44K));
  run(LOUD, 1);
  settle();
  const after = paints.filter((p) => p.now >= reopened);
  const handed = after.reduce((sum, p) => sum + p.dt, 0);
  assert.equal(handed, (after.at(-1)?.now ?? NaN) - (after[0]?.now ?? NaN));
});

test("test_while_the_feed_is_closed_no_painter_is_called", () => {
  const paints = subscribe();
  run(QUIET, 1);
  settle();
  engineStatus.value = { metering: false };
  const closed = clock.now();
  fake.advance(CLOSED_MS);
  assert.ok((paints.at(-1)?.now ?? Infinity) <= closed);
});

test("test_a_frame_the_delay_still_holds_back_stays_out_of_the_scene", () => {
  setSpectrumOffset(String(HELD_BACK_S));
  const paints = subscribe();
  run(QUIET, AHEAD);
  follow([LOUD], LENGTHS[0]);
  settle();
  assert.equal(Math.max(...paints.map((p) => p.peak)), QUIET.peak);
});

test("test_a_held_back_frame_reaches_the_scene_once_a_paint_reaches_it", () => {
  setSpectrumOffset(String(HELD_BACK_S));
  const paints = subscribe();
  run(QUIET, AHEAD);
  follow([LOUD], LENGTHS[0]);
  settle();
  const mark = paints.length;
  run(QUIET, 3);
  settle();
  assert.equal(Math.max(...paints.slice(mark).map((p) => p.peak)), LOUD.peak);
});

test("test_a_scene_folds_the_frames_a_paint_shows_alike_whatever_order_they_arrived_in", () => {
  setSpectrumOffset("0");
  const paints = subscribe();
  follow([LOUD], LENGTHS[0]);
  follow([QUIET], LENGTHS[2]);
  settle();
  const mark = paints.length;
  // The second pair is a break, so the paint that restarts at it shows both frames at once.
  const stream = lastStream();
  stream?.emit("frame", { channels: [QUIET], at: AN_HOUR_ON, n: LENGTHS[4] });
  stream?.emit("frame", { channels: [LOUD], at: AN_HOUR_ON + LENGTHS[4], n: LENGTHS[6] });
  settle();
  const shown = (/** @type {Painted | undefined} */ p, /** @type {string} */ none) => (p ? [p.peak, p.rms] : none);
  assert.deepEqual(shown(paints[0], "no paint after the first pair"), shown(paints[mark], "no paint after the second"));
});

test("test_a_paint_that_shows_no_frame_hands_the_scene_as_it_stood", () => {
  setSpectrumOffset("0");
  const paints = subscribe();
  run(QUIET, 1);
  follow([LOUD], LENGTHS[0]);
  settle();
  assert.deepEqual([...new Set(paints.slice(1).map((p) => p.peak))], [LOUD.peak]);
});

test("test_a_paint_at_a_break_starts_its_scene_from_nothing_heard", () => {
  const paints = subscribe();
  run(LOUD, 3);
  settle();
  const mark = paints.length;
  jump();
  settle();
  assert.ok((paints[mark]?.peak ?? NaN) < QUIET.peak);
});

test("test_the_scene_says_it_restarted_at_each_break_the_feed_sent_and_at_no_other_paint", () => {
  const paints = subscribe();
  run(QUIET, 3);
  settle();
  run(QUIET, 3);
  settle();
  jump();
  settle();
  assert.equal(paints.filter((p) => p.restart).length, 2);
});

test("test_a_painter_that_unsubscribes_during_a_paint_costs_the_painter_after_it_no_paint", () => {
  const leave = onMeterPaint(() => leave());
  /** @type {number[]} */
  const after = [];
  subscribed.push(onMeterPaint(() => void after.push(clock.now())));
  run(QUIET, 1);
  settle();
  assert.deepEqual(after, framesRun);
});

test("test_a_painter_that_unsubscribes_is_not_called_again", () => {
  let calls = 0;
  const leave = onMeterPaint(() => {
    calls += 1;
    leave();
  });
  run(QUIET, 1);
  settle();
  assert.equal(calls, 1);
});

test("test_a_painter_subscribed_during_a_paint_is_called_at_every_paint_after_it", () => {
  /** @type {number[]} */
  const joined = [];
  let at = NaN;
  subscribed.push(
    onMeterPaint(() => {
      if (!Number.isNaN(at)) return;
      at = clock.now();
      subscribed.push(onMeterPaint(() => void joined.push(clock.now())));
    }),
  );
  run(QUIET, 1);
  settle();
  const later = framesRun.slice(framesRun.indexOf(at) + 1);
  assert.deepEqual(joined.slice(-later.length), later);
});

/** The scene a painter is handed when the loop stops: restarted, nothing heard on any channel, no time passed. */
const CLEARED = {
  dt: 0,
  peak: -Infinity,
  rms: -Infinity,
  restart: true,
  channels: Array.from({ length: STEREO }, () => SILENT),
};

/**
 * What a painter was handed, without when.
 *
 * @param {Painted[]} paints
 */
const handed = (paints) => paints.map(({ dt, peak, rms, restart, channels }) => ({ dt, peak, rms, restart, channels }));

/**
 * Two painters subscribed and a loud stereo run painted, then `stop` and a long wait: what each painter was handed
 * from `stop` on.
 *
 * @param {() => void} stop
 */
function afterStopping(stop) {
  const first = subscribe();
  const second = subscribe();
  lastStream()?.emit("geometry", geometry(RATE_44K, STEREO, BINS));
  run(LOUD, 3, STEREO);
  settle();
  const marks = [first.length, second.length];
  stop();
  fake.advance(CLOSED_MS);
  return [handed(first.slice(marks[0])), handed(second.slice(marks[1]))];
}

test("test_when_the_engine_stops_playing_each_painter_is_handed_one_cleared_scene_and_no_paint_after_it", () => {
  assert.deepEqual(
    afterStopping(() => poll({ state: STOPPED })),
    [[CLEARED], [CLEARED]],
  );
});

test("test_when_the_feed_closes_each_painter_is_handed_one_cleared_scene_and_no_paint_after_it", () => {
  assert.deepEqual(
    afterStopping(() => {
      engineStatus.value = { ...engineStatus.value, metering: false };
    }),
    [[CLEARED], [CLEARED]],
  );
});

/**
 * A painter subscribed through a quiet run, the engine stopped for a long wait, then playing again with a loud run:
 * the paints from the moment it plays again on.
 *
 * @returns {Painted[]}
 */
function afterPlayingAgain() {
  const paints = subscribe();
  run(QUIET, 1);
  settle();
  poll({ state: STOPPED });
  fake.advance(CLOSED_MS);
  const resumed = clock.now();
  poll();
  run(LOUD, 1);
  settle();
  return paints.filter((p) => p.now >= resumed);
}

test("test_the_first_paint_after_the_engine_plays_again_is_handed_dt_0", () => {
  assert.equal(afterPlayingAgain()[0]?.dt, 0);
});

test("test_the_paints_after_the_engine_plays_again_are_handed_none_of_the_time_it_was_stopped", () => {
  const after = afterPlayingAgain();
  const total = after.reduce((sum, p) => sum + p.dt, 0);
  assert.equal(total, (after.at(-1)?.now ?? NaN) - (after[0]?.now ?? NaN));
});

test("test_a_status_poll_that_leaves_the_engine_stopped_calls_no_painter", () => {
  const paints = subscribe();
  run(QUIET, 1);
  settle();
  poll({ state: STOPPED });
  fake.advance(CLOSED_MS);
  const mark = paints.length;
  for (let i = 0; i < 3; i++) {
    poll({ state: STOPPED });
    fake.advance(CLOSED_MS);
  }
  assert.deepEqual(handed(paints.slice(mark)), []);
});

test("test_a_status_poll_that_leaves_the_engine_playing_restarts_no_scene", () => {
  const paints = subscribe();
  run(QUIET, 1);
  settle();
  const mark = paints.length;
  for (let i = 0; i < 3; i++) {
    poll();
    run(QUIET, 1);
    settle();
  }
  assert.deepEqual(
    paints.slice(mark).filter((p) => p.restart || p.dt === 0),
    [],
  );
});

test("test_a_signal_a_painter_reads_changing_while_the_engine_plays_again_restarts_no_scene", () => {
  const shade = signal(0);
  /** @type {Array<{ dt: number, restart: boolean }>} */
  const calls = [];
  subscribed.push(
    onMeterPaint((/** @type {MeterScene} */ scene, /** @type {number} */ dt) => {
      void shade.value;
      calls.push({ dt, restart: scene.restart });
    }),
  );
  run(QUIET, 1);
  settle();
  poll({ state: STOPPED });
  fake.advance(CLOSED_MS);
  poll();
  run(QUIET, 1);
  settle();
  const mark = calls.length;
  for (let i = 1; i <= 3; i++) {
    shade.value = i;
    run(QUIET, 1);
    settle();
  }
  assert.deepEqual(
    calls.slice(mark).filter((c) => c.restart || c.dt === 0),
    [],
  );
});

/** The reading the first frame sent carries, dBFS: each frame after it carries STEP_DB more, so a scene names the newest frame it shows. */
const FIRST_DB = -90;
const STEP_DB = 0.25;

/** Burst sizes in turn. */
const BURST_SIZES = { short: [3, 5, 2, 4], long: [5, 7, 4, 6] };

/** Paint waits, wall ms, in turn: steady at 60 Hz, then uneven with late paints. */
const PAINTS = { steady: [16], uneven: [16, 33, 17, 41, 16.7] };

/**
 * A feed of the generated bursts of `sizes` frames in turn at 44.1 kHz.
 *
 * @param {number[]} sizes
 * @returns {{ rate: number, landings: Landing[] }}
 */
const generatedFeed = (sizes) => ({ rate: RATE_44K, landings: generatedLandings(sizes) });

/**
 * Send `feed` on the stream open now, each landing at its wall time on the clock, and run the clock on to the last.
 *
 * @param {{ rate: number, landings: Landing[] }} feed
 * @returns {{ paints: Painted[], starts: number[], longest: number }}  the paints the painter was handed until the last
 *   landing was sent; where each frame starts and how long the longest is, playback ms
 */
function replay(feed) {
  const paints = subscribe();
  const t0 = fake.clock.now();
  const { starts, lengths } = frameTimes(feed.landings, feed.rate);
  lastStream()?.emit("geometry", geometry(feed.rate));
  let i = 0;
  for (const { wall, frames } of feed.landings) {
    fake.advance(Math.max(0, t0 + wall - fake.clock.now()));
    for (const { at, n } of frames) {
      const reading = { peak: FIRST_DB + STEP_DB * i++, rms: QUIET.rms, bins: MONO_BINS };
      lastStream()?.emit("frame", { channels: [reading], at, n });
    }
  }
  const last = fake.clock.now();
  return { paints: paints.filter((p) => p.now <= last), starts, longest: Math.max(...lengths) };
}

/**
 * Which frame of the feed a paint's scene names: the newest one it folded; NaN when the scene holds none.
 *
 * @param {Painted} p
 */
const frameOf = (p) => Math.round((p.peak - FIRST_DB) / STEP_DB);

/** @type {Array<{ name: string, delays: Delays, gaps: number[], feed: { rate: number, landings: Landing[] } }>} */
const FEEDS = [];
for (const [length, sizes] of Object.entries(BURST_SIZES)) {
  for (const [rate, gaps] of Object.entries(PAINTS)) {
    FEEDS.push({
      name: `${length}_bursts_at_${rate}_paints`,
      delays: { offsetS: length === "short" ? 0.3 : 0.6 },
      gaps,
      feed: generatedFeed(sizes),
    });
  }
}
const CAPTURE = capturedFeed();
FEEDS.push({ name: "the_capture_at_60_hz", delays: CAPTURE.delays, gaps: CAPTURE.gaps, feed: CAPTURE });

for (const { name, delays, gaps, feed } of FEEDS) {
  /** Replay the feed at its delay and paint waits. */
  const played = () => {
    setDelays(delays);
    frameGaps = gaps;
    gapAt = 0;
    return replay(feed);
  };

  test(`test_${name}_moves_the_playhead_exactly_its_wall_time_at_every_paint`, () => {
    const { paints } = played();
    const moves = paints.flatMap((p, i) => {
      const before = i > 0 ? paints[i - 1].head : null;
      return p.head !== null && before !== null ? [{ by: p.head - before, wall: p.dt }] : [];
    });
    const off = moves.filter((m) => Math.abs(m.by - m.wall) > 1e-6);
    assert.deepEqual({ some: moves.length > 0, off: off.length }, { some: true, off: 0 });
  });

  test(`test_${name}_never_hands_the_scene_as_it_stood_for_longer_than_a_frame_lasts`, () => {
    const { paints, longest } = played();
    const shown = paints.filter((p) => Number.isFinite(p.peak));
    const stuck = shown.filter((p, i) => {
      let first = i;
      while (first > 0 && frameOf(shown[first - 1]) === frameOf(p)) first--;
      return p.now - shown[first].now > longest;
    });
    assert.deepEqual({ some: shown.length > 0, stuck: stuck.length }, { some: true, stuck: 0 });
  });

  test(`test_${name}_never_hands_a_paint_more_music_than_its_wall_time_and_one_frame_cover`, () => {
    const { paints, starts, longest } = played();
    const shown = paints.filter((p) => Number.isFinite(p.peak));
    const burst = shown.filter((p, i) => i > 0 && starts[frameOf(p)] - starts[frameOf(shown[i - 1])] >= p.dt + longest);
    assert.deepEqual({ some: shown.length > 0, burst: burst.length }, { some: true, burst: 0 });
  });
}
