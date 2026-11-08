// Store suite for what the Source section's spectrum paints as the meter loop plays a feed: the loop (store/meter/loop.js)
// hands each paint's scene to a real sourcePainter (components/faceplate/page/sourcepaint.js) on the fake section
// (tests/js/support/rendered/sourcesection.js), and the suite reads what the painter wrote.
//
// "Choppy" is read as the spectrum judder, standing still and lurching, and a low update rate, while the buffer holds
// frames. A frame carries a level that names it, one 0.5 dB step more than the frame before, so the trace's mean level
// names the music it shows. Paints before the first frame is heard are not read. Owner rulings, 2026-11-08: each paint
// shows one whole frame, the one that covers most of the paint's interval, and not a power average of the frames the
// paint reached; at about 47 frames a second against 60 paints some paints show the frame the paint before showed, and
// a trace that stands for one paint is accepted. While the buffer holds, every frame is shown, on one or two
// consecutive paints. So the trace is read for the frame it names, never for evenness or for a change at every paint.
//
// Ridges and fire step their picture on a pace of their own, and may interpolate between their steps, so their picture
// is read over the capture and a generated feed for a paint that leaves the effects canvas as the paint before left it:
// there is none. The flames' random draws come from a fixed sequence. The effects canvas is a raster canvas (tests/js/support/raster.js) under the real fxPainter, 240 by
// 120.
//
// The feeds are the loop-painters suite's generated bursts (short and long, steady and uneven paint waits) and the
// first 200 frames of the committed capture (tests/support/fixtures/meter_feed_capture.json) at its delay, which the
// 0.5 dB steps keep inside the trace's 120 dB range. The stores pace on one fake clock whose animation frames run after
// the waits of the feed's case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrum-motion.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { initMeterLoop, onMeterPaint } from "../../../../hqptuner/static/store/meter/loop.js";
import { initMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { pageRange, setApodWindow, spectrumColors, spectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import { RATE_44K, geometry } from "../../support/meterfeed.js";
import { RANGE, TRACE, MONO, lineLevel, section } from "../../support/rendered/sourcesection.js";
import { fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { rasterCanvas } from "../../support/raster.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {{ wall: number, frames: Array<{ at: number, n: number }> }} Landing */
/** @typedef {{ rate: number, channels: number, bins: number, landings: Landing[], delay: number, gaps: number[] }} Feed */

const SECOND_MS = 1000;

/** Wall time, ms, one settle runs the clock on. */
const SETTLE_MS = 2500;

/** Event lengths, samples at 44.1 kHz, in turn: 22.7, 17.3, 19.3 and 23.1 ms, two of each. */
const LENGTHS = [1000, 1000, 765, 765, 850, 850, 1020, 1020];

/** Where each burst lands against the music's own schedule, wall ms, in turn. */
const OFF_SCHEDULE_MS = [0, -20, 25, -10, 30, -25, 15, -5, 20, -30];

/** Bursts per generated feed. */
const BURSTS = 30;

/** Frames of the capture the case plays. */
const CAPTURE_FRAMES = 200;

/** The wire count of 0.5 dB steps below full scale the first frame carries: -110 dBFS. */
const FIRST_COUNT = 220;

/** The level, dBFS, the first frame carries, and one step of the level between frames, dB. */
const FIRST_DB = -110;
const STEP_DB = 0.5;

/** How far from a whole frame the level a paint names may fall, in frames, and still be that frame: the line's rounding. */
const WHOLE_FRAME = 0.05;

/** How much more of a paint's interval, playback ms, another frame may cover than the one shown before it counts as more. */
const COVER_EPS = 1e-6;

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
 * A generated feed of `BURSTS` bursts of `sizes` frames in turn at 44.1 kHz, one channel of four bins; a burst lands
 * where the music before it would have ended on the wall, off by OFF_SCHEDULE_MS in turn, never before the burst before
 * it.
 *
 * @param {number[]} sizes
 * @param {number} delay  s
 * @param {number[]} gaps  the paint waits, wall ms
 * @param {number} [lead]  wall ms each burst after the first lands before its music plays at the delay, so the buffer holds
 * @returns {Feed}
 */
function generated(sizes, delay, gaps, lead = 0) {
  /** @type {Landing[]} */
  const landings = [];
  let at = 0;
  let sent = 0;
  let wall = 0;
  for (let k = 0; k < BURSTS; k++) {
    const frames = Array.from({ length: sizes[k % sizes.length] }, () => ({ at, n: LENGTHS[sent++ % LENGTHS.length] }));
    wall = Math.max(wall, k ? (at * SECOND_MS) / RATE_44K + OFF_SCHEDULE_MS[k % OFF_SCHEDULE_MS.length] - lead : 0);
    landings.push({ wall, frames });
    for (const f of frames) {
      f.at = at;
      at += f.n;
    }
  }
  return { rate: RATE_44K, channels: 1, bins: 4, landings, delay, gaps };
}

/**
 * The first frames of the committed capture as a feed, each at its recorded time, at the capture's delay and 60 Hz.
 *
 * @returns {Feed}
 */
function captured() {
  const raw = JSON.parse(
    readFileSync(new URL("../../../support/fixtures/meter_feed_capture.json", import.meta.url), "utf8"),
  );
  const named = (/** @type {string} */ name) =>
    raw.events.filter((/** @type {{ event: string }} */ ev) => ev.event === name);
  const geo = JSON.parse(named("geometry")[0].data);
  const landings = named("frame")
    .slice(0, CAPTURE_FRAMES)
    .map((/** @type {{ t_ms: number, data: string }} */ ev) => {
      const { at, n } = JSON.parse(ev.data);
      return { wall: ev.t_ms, frames: [{ at, n }] };
    });
  const delay = Number(raw.engine_output_delay) / 1e6 + raw.owner_spectrum_offset_s;
  return { rate: geo.rate, channels: geo.channels, bins: geo.bins, landings, delay, gaps: [SECOND_MS / 60] };
}

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
  engineStatus.value = { metering: false };
  useEventSource();
  useStorage();
  setApodWindow("30");
  initApodHistory();
  initSpectrogram();
  newTrack();
  poll();
  initMeterFeed(clock);
  initMeterLoop(clock);
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
 * dBFS, whether the effects canvas is as the paint before left it, and where the playhead stood, playback ms.
 *
 * @typedef {{ dt: number, level: number, still: boolean, head: number }} Painted
 */

/** The effects canvas, device pixels, large enough for its picture to be read. */
const FX_SIZE = [240, 120];

/** The fill under each ridge. */
const GLASS = "#101418";

/**
 * A random source for the flames: a fixed sequence in [0, 1), the same every run. The flames' draws vary in play; a
 * constant answer would settle them on a fixed point where no step could change the picture.
 */
function draws() {
  let seed = 12345;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

/** The effects views whose picture steps on a pace of its own, so a paint could leave it as it was. */
const STEPPED_VIEWS = ["ridges", "fire"];

/**
 * Play `feed` and write down each paint's trace.
 *
 * @param {Feed} feed
 * @param {string} [view]  the spectrum style picked
 * @returns {{ paints: Painted[], starts: number[], ends: number[] }}  where each frame starts and ends, playback ms
 */
function play(feed, view = TRACE) {
  setSpectrumOffset(String(feed.delay));
  frameGaps = feed.gaps;
  gapAt = 0;
  spectrumStyle.value = view;
  const canvas = rasterCanvas(FX_SIZE[0], FX_SIZE[1]);
  const seams = { random: draws(), makeCanvas: rasterCanvas };
  const fx = fxPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), { glass: GLASS }, seams);
  const root = section(feed.channels, "", { fx, aurora: null });
  /** @type {Painted[]} */
  const paints = [];
  let before = canvas.ink.slice();
  const unsubscribe = onMeterPaint((scene, dt) => {
    root.painter.paint(scene, { dt });
    const still = before.every((v, i) => v === canvas.ink[i]);
    before = canvas.ink.slice();
    paints.push({ dt: dt * SECOND_MS, level: lineLevel(root), still, head: playhead.peek() ?? Number.NaN });
  });
  const t0 = fake.clock.now();
  lastStream()?.emit("geometry", geometry(feed.rate, feed.channels, feed.bins));
  const frames = feed.landings.flatMap((l) => l.frames);
  const starts = frames.map((f) => (f.at * SECOND_MS) / feed.rate);
  const ends = frames.map((f) => ((f.at + f.n) * SECOND_MS) / feed.rate);
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
 * The feeds whose buffer holds throughout and whose paints are shorter than every frame: each frame has a paint of its
 * own.
 *
 * @type {Array<[string, () => Feed]>}
 */
const BUFFERED_FEEDS = [
  ["a_full_buffer_at_steady_paints", () => generated([18, 4, 6, 3, 5], 0.3, [16], 300)],
  ["the_capture_at_60_hz", captured],
];

/** The feeds the effects pictures are read over: the capture and one generated feed with uneven paints. */
const FX_FEEDS = ["long_bursts_at_uneven_paints", "the_capture_at_60_hz"];

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
    return played.starts.some((_, j) => overlap(played, j, paints[i - 1].head, p.head) > mine + COVER_EPS);
  });
}

/**
 * How many paints name each frame whole, by frame number, for the frames from the first named to the last.
 *
 * @param {Array<Painted & { named: number }>} paints
 * @returns {Array<number[]>}  the indices of the paints naming each frame
 */
function paintsPerFrame(paints) {
  const whole = paints.map((p, i) => ({
    i,
    k: Math.round(p.named),
    ok: Math.abs(p.named - Math.round(p.named)) <= WHOLE_FRAME,
  }));
  const first = whole[0].k;
  const last = whole[whole.length - 1].k;
  return Array.from({ length: last - first + 1 }, (_, n) =>
    whole.filter((w) => w.ok && w.k === first + n).map((w) => w.i),
  );
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

for (const [name, make] of BUFFERED_FEEDS) {
  test(`test_${name}_shows_every_frame_it_passes_on_one_or_two_consecutive_paints`, () => {
    const runs = paintsPerFrame(heard(play(make())));
    const broken = runs.filter((at) => at.length < 1 || at.length > 2 || (at.length === 2 && at[1] - at[0] !== 1));
    assert.deepEqual({ some: runs.length > 1, broken: broken.length }, { some: true, broken: 0 });
  });
}

for (const view of STEPPED_VIEWS) {
  for (const [name, make] of FEEDS.filter(([n]) => FX_FEEDS.includes(n))) {
    test(`test_${name}_never_leaves_the_${view}_view_as_painted_for_a_paint_while_the_music_moves`, () => {
      const paints = heard(play(make(), view));
      const still = paints.filter((p, i) => i > 0 && p.still);
      assert.deepEqual({ some: paints.length > 1, still: still.length }, { some: true, still: 0 });
    });
  }
}
