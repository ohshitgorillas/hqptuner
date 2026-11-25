// Store suite for what the Source section's spectrum paints as the meter loop plays a feed: the loop (store/meter/loop.js)
// hands each paint's scene to a real sourcePainter (components/faceplate/page/sourcepaint.js) on the fake section
// (tests/js/support/rendered/sourcesection.js), and the suite reads what the painter wrote.
//
// "Choppy" is read as the spectrum judder, standing still and lurching, and a low update rate, while the buffer holds
// frames. A frame carries a level that names it, one 0.5 dB step more than the frame before, so the trace's mean level
// names the music it shows. Paints before the first frame is heard are not read. Owner rulings, 2026-11-08: each paint
// shows one whole frame, the one that covers most of the paint's interval, and not a power average of the frames the
// paint reached; at about 47 frames a second against 60 paints some paints show the frame the paint before showed, and
// a trace that stands for one paint is accepted. So the trace is read for the frame it names, never for evenness or for a
// change at every paint.
//
// The feeds are the loop-painters suite's generated bursts (short and long, steady and uneven paint waits) and the
// first 200 frames of the committed capture (tests/support/fixtures/meter_feed_capture.json) at its delay, which the
// 0.5 dB steps keep inside the trace's 120 dB range. The stores pace on one fake clock whose animation frames run after
// the waits of the feed's case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrum-motion.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint } from "../../../../hqptuner/static/store/meter/loop.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { pageRange, spectrumColors, spectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream } from "../../support/eventsource.js";
import { fakeClock } from "../../support/clock.js";
import { RATE_44K, geometry } from "../../support/meterfeed.js";
import { bootMeter, capturedFeed, frameTimes, generatedLandings, setDelays } from "../../support/meter/meterrig.js";
import { RANGE, TRACE, MONO, lineLevel, section } from "../../support/rendered/sourcesection.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../support/meter/meterrig.js").Landing} Landing */
/** @typedef {import("../../support/meter/meterrig.js").Delays} Delays */
/** @typedef {{ rate: number, channels: number, bins: number, landings: Landing[], delays: Delays, gaps: number[] }} Feed */

/** Wall time, ms, one settle runs the clock on. */
const SETTLE_MS = 2500;

/** Frames of the capture the case plays. */
const CAPTURE_FRAMES = 200;

/** The wire count of 0.5 dB steps below full scale the first frame carries: -110 dBFS. */
const FIRST_COUNT = 220;

/** The level, dBFS, the first frame carries, and one step of the level between frames, dB. */
const FIRST_DB = -110;
const STEP_DB = 0.5;

/** How far from a whole frame the level a paint names may fall, in frames, and still be that frame: the line's rounding. */
const WHOLE_FRAME = 0.05;

const fake = fakeClock();
let frameGaps = [16];
let gapAt = 0;

/** @type {Clock} */
const clock = {
  ...fake.clock,
  requestAnimationFrame: (fn) => {
    const wait = frameGaps[gapAt % frameGaps.length];
    gapAt += 1;
    return fake.clock.setTimeout(() => fn(fake.clock.now()), wait);
  },
};

/**
 * A generated feed of bursts of `sizes` frames in turn at 44.1 kHz, one channel of four bins.
 *
 * @param {number[]} sizes
 * @param {number} delay  s
 * @param {number[]} gaps  the paint waits, wall ms
 * @returns {Feed}
 */
function generated(sizes, delay, gaps) {
  return {
    rate: RATE_44K,
    channels: 1,
    bins: 4,
    landings: generatedLandings(sizes),
    delays: { offsetS: delay },
    gaps,
  };
}

/**
 * The first frames of the committed capture as a feed, each at its recorded time, at the capture's delay and 60 Hz.
 *
 * @returns {Feed}
 */
const captured = () => capturedFeed(CAPTURE_FRAMES);

/**
 * The wire's bins: `n` of them, every one at `count` steps of 0.5 dB below full scale.
 *
 * @param {number} count
 * @param {number} n
 */
function binsOf(count, n) {
  const raw = Buffer.alloc(2 * n);
  for (let k = 0; k < n; k++) raw.writeUInt16LE(count, 2 * k);
  return raw.toString("base64");
}

beforeEach(() => {
  bootMeter(clock, { loop: true });
  fake.advance(SETTLE_MS);
  pageRange.value = String(RANGE);
  spectrumStyle.value = TRACE;
  spectrumColors.value = MONO;
});

afterEach(() => {
  engineStatus.value = { metering: false };
});

/**
 * One paint as the spectrum painted it: the wall time since the paint before, ms, the mean level of its trace line,
 * dBFS, and where the playhead stood, playback ms.
 *
 * @typedef {{ dt: number, level: number, head: number }} Painted
 */

/**
 * Play `feed` and write down each paint's trace.
 *
 * @param {Feed} feed
 * @returns {{ paints: Painted[], starts: number[], ends: number[] }}  where each frame starts and ends, playback ms
 */
function play(feed) {
  setDelays(feed.delays);
  frameGaps = feed.gaps;
  gapAt = 0;
  const root = section(feed.channels);
  /** @type {Painted[]} */
  const paints = [];
  const unsubscribe = onMeterPaint((scene, dt) => {
    root.painter.paint(scene, { dt });
    paints.push({ dt, level: lineLevel(root), head: playhead.peek() ?? Number.NaN });
  });
  const t0 = fake.clock.now();
  lastStream()?.emit("geometry", geometry(feed.rate, feed.channels, feed.bins));
  const { starts, ends } = frameTimes(feed.landings, feed.rate);
  let sent = 0;
  for (const { wall, frames: landing } of feed.landings) {
    fake.advance(Math.max(0, t0 + wall - fake.clock.now()));
    for (const { at, n } of landing) {
      const bins = binsOf(FIRST_COUNT - sent++, feed.bins);
      const reading = { peak: FIRST_DB, rms: FIRST_DB, bins };
      lastStream()?.emit("frame", { channels: Array.from({ length: feed.channels }, () => reading), at, n });
    }
  }
  unsubscribe();
  return { paints: paints.filter((p) => Number.isFinite(p.level)), starts, ends };
}

/**
 * The paints of a played feed from the first one that names a frame on, each with the frame the level names, as a
 * number of frames from the first: whole where the trace shows one frame, between two where it reads between them.
 *
 * @param {{ paints: Painted[] }} played
 * @returns {Array<Painted & { named: number }>}
 */
function heard({ paints }) {
  return paints.map((p) => ({ ...p, named: (p.level - FIRST_DB) / STEP_DB })).filter((p) => p.named >= 0);
}

/** @type {Array<[string, () => Feed]>} */
const FEEDS = [
  ["short_bursts_at_steady_paints", () => generated([3, 5, 2, 4], 0.3, [16])],
  ["short_bursts_at_uneven_paints", () => generated([3, 5, 2, 4], 0.3, [16, 33, 17, 41, 16.7])],
  ["long_bursts_at_steady_paints", () => generated([5, 7, 4, 6], 0.6, [16])],
  ["long_bursts_at_uneven_paints", () => generated([5, 7, 4, 6], 0.6, [16, 33, 17, 41, 16.7])],
  ["the_capture_at_60_hz", captured],
];

/**
 * How much of the paint's interval, playback ms, frame `k` covers.
 *
 * @param {{ starts: number[], ends: number[] }} played
 * @param {number} k
 * @param {number} from
 * @param {number} to
 */
const overlap = ({ starts, ends }, k, from, to) => Math.max(0, Math.min(ends[k], to) - Math.max(starts[k], from));

/**
 * The paints of `heard` whose trace is not exactly the one frame that covers most of the interval the paint moved the
 * playhead over, from where the paint before it stood.
 *
 * @param {ReturnType<typeof play>} played
 * @param {Array<Painted & { named: number }>} paints
 */
function notTheFrameCoveringMost(played, paints) {
  return paints.filter((p, i) => {
    if (i === 0 || p.head <= paints[i - 1].head) return false;
    const k = Math.round(p.named);
    if (Math.abs(p.named - k) > WHOLE_FRAME) return true;
    const mine = overlap(played, k, paints[i - 1].head, p.head);
    return played.starts.some((_, j) => overlap(played, j, paints[i - 1].head, p.head) > mine);
  });
}

for (const [name, make] of FEEDS) {
  test(`test_${name}_shows_each_paint_the_one_frame_that_covers_most_of_its_interval`, () => {
    const played = play(make());
    const paints = heard(played);
    assert.deepEqual(
      { some: paints.length > 1, off: notTheFrameCoveringMost(played, paints).length },
      { some: true, off: 0 },
    );
  });
}
