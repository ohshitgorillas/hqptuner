// The schedules the meter painting contract suites replay: a paint schedule (the wall times the page's animation frames
// ran at) and a feed schedule (the wall times the metering frames reached the page, with their lengths in samples), both
// in ms on a virtual clock that starts at 0. No test() and no assert lives here, and no clock is read: every number is
// written down or drawn from a seeded stream.
//
// The generated schedules cover the shapes the owner's page meets: paints at a steady rate, jittered, with dropped
// paints, with one long stall and with runs of slow paints; a feed in bursts that land early and late against the music,
// with a stall that piles its backlog into one burst, and with a gap that outlasts the delay. Every frame length is
// inside the measured feed event range, 17.3 to 23.2 ms, and changes in the middle of the feed. The last schedule is the
// owner's real Safari capture (tests/support/fixtures/safari_paint_schedule.json): its `raf` paint times and its `feed`
// arrival times, read, never written, the frames given lengths here since the capture holds arrivals only.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { readFileSync } from "node:fs";

import { samplesToMs, secondsToMs } from "../../../hqptuner/static/lib/timebase.js";
import { seeded } from "../support/meter/seeded.js";

/**
 * A schedule to replay: the delay the owner's page runs at, the paints and the arrivals.
 *
 * @typedef {object} Schedule
 * @property {string} name
 * @property {number} rate  metering rate, Hz: what `n` counts in
 * @property {number} delay  s: the spectrum offset the page runs at, the engine reporting no delay of its own
 * @property {number[]} paints  wall, ms: when each animation frame ran, ascending
 * @property {Array<{ t: number, n: number, at?: number }>} feed  one entry per frame: wall ms it reached the page,
 *   ascending, its length in samples at the geometry it arrived under, and the wire's own `at` stamp where the stream has
 *   one (samples counted from the feed's reset; the replay counts the lengths on from 0 where it has none)
 * @property {Array<{ t: number, rate: number }>} [geometry]  geometry events, wall ms ascending, each the metering rate of
 *   the frames after it; where a schedule has this it sends its first itself, and `rate` is the rate before any arrives
 * @property {Array<{ t: number, fields: Record<string, string> }>} [status]  Status samples, wall ms ascending, each the
 *   `state`, `track_serial`, `position` and `output_delay` the engine reported then; where a schedule has none, the
 *   engine plays one track and reports no delay of its own
 */

const RATE_44K = 44100;
const RATE_48K = 48000;
const PAINT_MS = secondsToMs(1) / 60;
//: Frame lengths in the first and the second half of a generated feed, whole samples at 44.1 kHz, the rate every generated
//: schedule runs at: 17.4, 19.3 and 21.5 ms, then 23.1, 22.2 and 20.4 ms, all inside 17.3 to 23.2.
const SHORT_SAMPLES = [767, 851, 948];
const LONG_SAMPLES = [1019, 979, 900];
//: The Safari capture's frame lengths in turn, samples at 48 kHz: 20, 21.3 and 22.7 ms.
const SAFARI_SAMPLES = [960, 1024, 1088];
const SAFARI_FILE = new URL("../../support/fixtures/safari_paint_schedule.json", import.meta.url);

/**
 * The frame lengths, samples at 44.1 kHz, of `spanMs` of music: short ones in the first half, long ones in the second.
 *
 * @param {() => number} rand
 * @param {number} spanMs
 * @returns {number[]}
 */
function lengths(rand, spanMs) {
  /** @type {number[]} */
  const out = [];
  let music = 0;
  while (music < spanMs) {
    const pool = music < spanMs / 2 ? SHORT_SAMPLES : LONG_SAMPLES;
    const n = pool[Math.floor(rand() * pool.length)];
    out.push(n);
    music += samplesToMs(n, RATE_44K);
  }
  return out;
}

/**
 * The arrivals of frames of `ns` samples in bursts of `burst[0]` to `burst[1]` frames. A burst lands where its music
 * would have played out, early or late by up to `jitter` ms. A `stall` holds back every burst due inside it until its
 * end, so the backlog lands together.
 *
 * @param {number[]} ns
 * @param {number} rate
 * @param {() => number} rand
 * @param {{ burst: number[], jitter: number, stall?: { at: number, ms: number } }} how
 * @returns {Schedule["feed"]}
 */
function bursts(ns, rate, rand, { burst: [lo, hi], jitter, stall }) {
  /** @type {Schedule["feed"]} */
  const feed = [];
  let music = 0;
  let last = 0;
  for (let i = 0; i < ns.length;) {
    const group = ns.slice(i, i + lo + Math.floor(rand() * (hi - lo + 1)));
    i += group.length;
    const samples = group.reduce((a, b) => a + b, 0);
    music += samplesToMs(samples, rate);
    let t = Math.max(last, music + (rand() * 2 - 1) * jitter);
    if (stall && t >= stall.at && t < stall.at + stall.ms) t = stall.at + stall.ms;
    last = t;
    for (const n of group) feed.push({ t, n });
  }
  return feed;
}

/**
 * Paints from 3 ms on until `spanMs`, each `gap()` ms after the one before it.
 *
 * @param {number} spanMs
 * @param {() => number} gap
 * @returns {number[]}
 */
function paintsEvery(spanMs, gap) {
  /** @type {number[]} */
  const out = [];
  for (let t = 3; t <= spanMs; t += gap()) out.push(t);
  return out;
}

/**
 * A schedule of generated music, `spanMs` long, at 44.1 kHz.
 *
 * @param {object} how
 * @param {string} how.name
 * @param {number} how.delay  s
 * @param {number} how.spanMs
 * @param {number} how.seed
 * @param {{ burst: number[], jitter: number, stall?: { at: number, ms: number } }} how.feed
 * @param {(rand: () => number, spanMs: number) => number[]} how.paints
 * @returns {Schedule}
 */
function generated({ name, delay, spanMs, seed, feed, paints }) {
  const rand = seeded(seed);
  return {
    name,
    rate: RATE_44K,
    delay,
    paints: paints(rand, spanMs),
    feed: bursts(lengths(rand, spanMs), RATE_44K, rand, feed),
  };
}

/** @type {(rand: () => number, spanMs: number) => number[]} */
const steady = (_, spanMs) => paintsEvery(spanMs, () => PAINT_MS);
/** @type {(rand: () => number, spanMs: number) => number[]} */
const jittered = (rand, spanMs) => paintsEvery(spanMs, () => 8 + rand() * 22);

/**
 * Steady paints, a run of one to three of them dropped now and then.
 *
 * @param {() => number} rand
 * @param {number} spanMs
 * @returns {number[]}
 */
function dropped(rand, spanMs) {
  return paintsEvery(spanMs, () => PAINT_MS * (rand() < 0.06 ? 2 + Math.floor(rand() * 3) : 1));
}

/**
 * Steady paints with one stall: no paint for `ms` from `at`.
 *
 * @param {number} at
 * @param {number} ms
 * @returns {(rand: () => number, spanMs: number) => number[]}
 */
const stalled = (at, ms) => (_, spanMs) => steady(_, spanMs).filter((t) => t < at || t >= at + ms);

/**
 * Steady paints with runs of slow ones, 72 ms apart, for half a second every few seconds.
 *
 * @param {() => number} rand
 * @param {number} spanMs
 * @returns {number[]}
 */
function slowRuns(rand, spanMs) {
  let slow = 0;
  return paintsEvery(spanMs, () => {
    if (slow > 0) return (slow--, 72);
    if (rand() < 0.01) slow = 7;
    return PAINT_MS;
  });
}

/**
 * The owner's Safari capture as a schedule: its paints and its frame arrivals on a clock that starts at its first paint.
 *
 * @returns {Schedule}
 */
function safari() {
  const raw = JSON.parse(readFileSync(SAFARI_FILE, "utf8"));
  const start = raw.raf[0];
  return {
    name: "the_safari_capture",
    rate: RATE_48K,
    delay: Number(raw.store["hqptuner.spectrumOffset"]),
    paints: raw.raf.map((/** @type {number} */ t) => t - start),
    feed: raw.feed.map((/** @type {number} */ t, /** @type {number} */ i) => ({
      t: t - start,
      n: SAFARI_SAMPLES[i % SAFARI_SAMPLES.length],
    })),
  };
}

const STANDARD = { burst: [1, 8], jitter: 40 };

/**
 * Every schedule the contract suites replay. The delay of each is long enough to carry its feed's gaps, bar the one
 * that says otherwise.
 *
 * @type {Schedule[]}
 */
export const SCHEDULES = [
  generated({ name: "steady_paints", delay: 0.5, spanMs: 12000, seed: 1, feed: STANDARD, paints: steady }),
  generated({ name: "jittered_paints", delay: 0.25, spanMs: 12000, seed: 2, feed: STANDARD, paints: jittered }),
  generated({ name: "dropped_paints", delay: 0.25, spanMs: 12000, seed: 3, feed: STANDARD, paints: dropped }),
  generated({
    name: "one_long_paint_stall",
    delay: 1,
    spanMs: 12000,
    seed: 4,
    feed: STANDARD,
    paints: stalled(5000, 800),
  }),
  generated({ name: "runs_of_slow_paints", delay: 0.5, spanMs: 12000, seed: 5, feed: STANDARD, paints: slowRuns }),
  generated({
    name: "a_feed_stall_that_piles_its_backlog",
    delay: 0.5,
    spanMs: 12000,
    seed: 6,
    feed: { ...STANDARD, stall: { at: 4000, ms: 450 } },
    paints: steady,
  }),
  generated({
    name: "a_feed_gap_past_the_delay",
    delay: 0.25,
    spanMs: 12000,
    seed: 7,
    feed: { ...STANDARD, stall: { at: 4000, ms: 900 } },
    paints: jittered,
  }),
  generated({ name: "a_long_jittered_run", delay: 0.5, spanMs: 45000, seed: 8, feed: STANDARD, paints: jittered }),
  safari(),
];

/**
 * A reader of what replaying a schedule showed: `look` replays the schedule and reads what its probes found, once, and
 * every ask for that schedule gets that reading.
 *
 * @template T
 * @param {(schedule: Schedule) => T} look
 * @returns {(schedule: Schedule) => T}
 */
export function seenOnce(look) {
  /** @type {Map<string, T>} */
  const looked = new Map();
  return (schedule) => {
    if (!looked.has(schedule.name)) looked.set(schedule.name, look(schedule));
    return /** @type {T} */ (looked.get(schedule.name));
  };
}
