// Store suite for the painters' side of hqptuner/static/store/meter/loop.js: every paint while the meter feed is open,
// the loop hands each painter subscribed through onMeterPaint the scene the paint shows and `dt`, the wall time since
// the paint before it, in seconds.
//
// `dt` (docs/spec/timing.md, rule 7) is the loop's true interval: each paint's is the wall time since the paint before
// it however long that was, and the first paint after the feed opens is handed none of the time it was closed. The
// scene (rules 5 and 6, docs/spec/architecture.md §8.3) folds the frames the paint shows and no other: a frame the
// delay still holds back stays out until a paint reaches it, the frames are folded alike whatever order they arrived
// in, a paint that shows no frame hands the scene as it stood, and a paint at a break starts from nothing heard and
// says it restarted. While the feed is closed no painter is called, and a painter that subscribes or unsubscribes
// during a paint costs no painter that paint.
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

import { initMeterLoop, onMeterPaint } from "../../../../hqptuner/static/store/meter/loop.js";
import { initMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import { MONO_BINS, RATE_44K, follow, geometry } from "../../support/meterfeed.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene} MeterScene */

/** Wall time, ms, from one animation frame being asked for to its running, in turn. */
const FRAME_GAPS_MS = [16, 33, 17, 250, 41, 1000, 16.7];

/** Wall time, ms, one settle runs the clock on: several animation frames, however long each waits. */
const SETTLE_MS = 2500;

/** Wall time, ms, a closed feed stays closed. */
const CLOSED_MS = 60000;

/** One second, in ms. */
const SECOND_MS = 1000;

/** The delay the cases run at unless they set none, in seconds: shorter than a run of LENGTHS sent three times. */
const DELAY_S = 0.25;

/** Event lengths, samples at 44.1 kHz, in turn: 22.7, 17.3, 19.3 and 23.1 ms, two of each. */
const LENGTHS = [1000, 1000, 765, 765, 850, 850, 1020, 1020];

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
    const wait = FRAME_GAPS_MS[gapAt % FRAME_GAPS_MS.length];
    gapAt += 1;
    return fake.clock.setTimeout(() => {
      const now = fake.clock.now();
      framesRun.push(now);
      fn(now);
    }, wait);
  },
};

/** Wall times in ms rounded to a millionth of a ms. */
const same = (/** @type {number} */ ms) => Math.round(ms * 1e6) / 1e6;

/** Run the clock on far enough for several paints. */
const settle = () => fake.advance(SETTLE_MS);

/**
 * Send LENGTHS `times` over on the stream open now, every frame carrying `reading`.
 *
 * @param {typeof LOUD} reading
 * @param {number} times
 */
function run(reading, times) {
  for (let i = 0; i < times; i++) for (const n of LENGTHS) follow([reading], n);
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
 * @property {number} dt  wall time, s, the loop handed it
 * @property {number} peak  dBFS: the scene's first channel; NaN when it has none
 * @property {number} rms  dBFS: the scene's first channel; NaN when it has none
 * @property {boolean} restart
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
    into.push({ now: clock.now(), dt, peak: ch ? ch.peak : NaN, rms: ch ? ch.rms : NaN, restart: scene.restart });
  });
  subscribed.push(unsubscribe);
  return into;
}

beforeEach(() => {
  engineStatus.value = { metering: false };
  useEventSource();
  useStorage();
  setApodWindow("30");
  setSpectrumOffset(String(DELAY_S));
  initApodHistory();
  initSpectrogram();
  newTrack();
  poll();
  initMeterFeed(clock);
  initMeterLoop(clock);
  settle();
  lastStream()?.emit("geometry", geometry(RATE_44K));
  framesRun = [];
});

afterEach(() => {
  for (const unsubscribe of subscribed) unsubscribe();
  subscribed.length = 0;
});

test("test_each_paint_hands_its_painters_the_wall_time_since_the_paint_before_it_in_seconds", () => {
  const paints = subscribe();
  for (const reading of [QUIET, LOUD, QUIET]) {
    run(reading, 1);
    settle();
  }
  const gaps = framesRun.slice(1).map((t, i) => same(t - framesRun[i]));
  assert.deepEqual(
    paints.slice(1).map((p) => same(p.dt * SECOND_MS)),
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
  const handed = after.reduce((sum, p) => sum + p.dt, 0) * SECOND_MS;
  assert.equal(same(handed), same((after.at(-1)?.now ?? NaN) - (after[0]?.now ?? NaN)));
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
  const paints = subscribe();
  run(QUIET, 3);
  follow([LOUD], LENGTHS[0]);
  settle();
  assert.equal(Math.max(...paints.map((p) => p.peak)), QUIET.peak);
});

test("test_a_held_back_frame_reaches_the_scene_once_a_paint_reaches_it", () => {
  const paints = subscribe();
  run(QUIET, 3);
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
  follow([QUIET], LENGTHS[4]);
  follow([LOUD], LENGTHS[6]);
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
