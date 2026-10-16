// Mounted suite for useMeterPaint in hqptuner/static/components/faceplate/drawers/source/paint.js while the meter loop
// (hqptuner/static/store/meter/loop.js) paces the feed: the spectrogram scrolls the same distance on every paint, the
// playback the loop's playhead crossed, however the feed's events fall across those paints.
//
// The hook is mounted through preact's own client render on a container with no children, its effects run by hand
// through preact's `options.requestAnimationFrame` seam, on the document tests/js/support/domseam.js installs. The
// spectrogram canvas is a fake whose 2D context records how far each `drawImage` of the canvas onto itself moves the
// pixels. Feed events arrive at the wire, through the EventSource fake and `openMeterFeed`, stamped from STEPS_96K, a
// table written out by hand; the strip's bins through the poll seam (tests/js/support/apodpolls.js), one track whose
// second poll records one bin once the first step's events are queued, so the bin carries a playback stamp. The loop
// runs on a fake Clock that moves only when the case runs an animation frame, each one step 100 ms after the last.
//
// The window is 60 s, so one of the spectrogram's columns is 50 ms of playback and one step's 100 ms is two columns.
// The meters run 0.1 s behind the feed, and every step the feed sends 100 ms of playback as five events, 20 ms long for
// the first three steps and 21.25, 18.75, 21.25, 18.75 and 20 ms long from the fourth, so the queue ahead of the
// playhead holds the delay exactly and the playhead crosses exactly 100 ms a step.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-source-scroll.test.js

import "../../support/domseam.js";
import test from "node:test";
import assert from "node:assert/strict";
import { h, options, render } from "preact";

import { SPEC_SIZE, useMeterPaint } from "../../../../hqptuner/static/components/faceplate/drawers/source/paint.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { setApodWindow, setMeterChannel } from "../../../../hqptuner/static/store/ui/prefs.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll, setPollStep } from "../../support/apodpolls.js";
import { RATE_96K, geometry, play } from "../../support/meterfeed.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../support/meterfeed.js").Stamp} Stamp */
/** @typedef {{ draws: number[], getContext: () => unknown, width: number, height: number }} FakeCanvas */

//: Wall time between two animation frames, ms, and the playback each step's events cover.
const STEP_MS = 100;
//: The meters' offset behind the feed, s: one step's playback.
const OFFSET_S = STEP_MS / 1000;
//: One step's playback across the 60 s window's 50 ms columns.
const COLUMNS_PER_STEP = 2;

/**
 * Seven steps of events at 96 kHz from 9 s of playback on, each event starting where the one before it ended and each
 * step covering 9600 samples, 100 ms: 20 ms events for three steps, then 21.25, 18.75, 21.25, 18.75 and 20 ms from the
 * fourth.
 *
 * @type {Stamp[][]}
 */
const STEPS_96K = [
  [
    { at: 864000, n: 1920 },
    { at: 865920, n: 1920 },
    { at: 867840, n: 1920 },
    { at: 869760, n: 1920 },
    { at: 871680, n: 1920 },
  ],
  [
    { at: 873600, n: 1920 },
    { at: 875520, n: 1920 },
    { at: 877440, n: 1920 },
    { at: 879360, n: 1920 },
    { at: 881280, n: 1920 },
  ],
  [
    { at: 883200, n: 1920 },
    { at: 885120, n: 1920 },
    { at: 887040, n: 1920 },
    { at: 888960, n: 1920 },
    { at: 890880, n: 1920 },
  ],
  [
    { at: 892800, n: 2040 },
    { at: 894840, n: 1800 },
    { at: 896640, n: 2040 },
    { at: 898680, n: 1800 },
    { at: 900480, n: 1920 },
  ],
  [
    { at: 902400, n: 2040 },
    { at: 904440, n: 1800 },
    { at: 906240, n: 2040 },
    { at: 908280, n: 1800 },
    { at: 910080, n: 1920 },
  ],
  [
    { at: 912000, n: 2040 },
    { at: 914040, n: 1800 },
    { at: 915840, n: 2040 },
    { at: 917880, n: 1800 },
    { at: 919680, n: 1920 },
  ],
  [
    { at: 921600, n: 2040 },
    { at: 923640, n: 1800 },
    { at: 925440, n: 2040 },
    { at: 927480, n: 1800 },
    { at: 929280, n: 1920 },
  ],
];

/**
 * The global paint.js reads the stylesheet's tokens through, viewed as an optional member.
 *
 * @type {{ getComputedStyle?: unknown }}
 */
const env = globalThis;
env.getComputedStyle = () => ({ getPropertyValue: () => "" });

/**
 * A clock that moves only on `frame`: each call is one animation frame `ms` after the last, running what was queued
 * for it.
 */
function frameClock() {
  let now = 0;
  /** @type {Array<(now: number) => void>} */
  let queued = [];
  /** @type {Clock} */
  const clock = {
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => queued.push(fn),
    queueMicrotask: (fn) => fn(),
    now: () => now,
  };
  /** @param {number} ms */
  const frame = (ms) => {
    now += ms;
    const due = queued;
    queued = [];
    due.forEach((fn) => fn(now));
  };
  return { clock, frame };
}

/**
 * A canvas whose 2D context records how far each self-draw moves its pixels, in columns.
 *
 * @param {number} width
 * @param {number} height
 * @returns {FakeCanvas}
 */
function fakeCanvas(width, height) {
  /** @type {FakeCanvas} */
  const canvas = { width, height, draws: [], getContext: () => ctx };
  const ctx = {
    /** @param {number} w @param {number} hh */
    createImageData: (w, hh) => ({ width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) }),
    putImageData: () => {},
    /** @param {unknown} src @param {number[]} args */
    drawImage: (src, ...args) => {
      if (src === canvas) canvas.draws.push(args[0] - args[4]);
    },
  };
  return canvas;
}

/**
 * Mount useMeterPaint on the two canvases and run its effects, as the browser does after the first paint.
 *
 * @param {FakeCanvas} spec
 * @param {FakeCanvas} strip
 */
function mount(spec, strip) {
  const refs = { spec: { current: spec }, strip: { current: strip } };
  const Painted = () => {
    useMeterPaint(
      /** @type {{ current: HTMLCanvasElement }} */ (/** @type {unknown} */ (refs.spec)),
      /** @type {{ current: HTMLCanvasElement }} */ (/** @type {unknown} */ (refs.strip)),
    );
    return null;
  };
  const root = { firstChild: null, childNodes: [] };
  /** @type {Array<() => void>} */
  const queued = [];
  const previous = options.requestAnimationFrame;
  options.requestAnimationFrame = (/** @type {() => void} */ flush) => {
    queued.push(flush);
  };
  try {
    render(h(Painted, {}), root);
  } finally {
    options.requestAnimationFrame = previous;
  }
  queued.forEach((flush) => flush());
}

const { clock, frame } = frameClock();

/**
 * How far the spectrogram scrolled on each paint after the first, in columns, over the steps of STEPS_96K.
 *
 * @returns {number[]}
 */
function scrolls() {
  const spec = fakeCanvas(SPEC_SIZE.width, SPEC_SIZE.height);
  mount(spec, fakeCanvas(600, 1));
  const [first = [], ...rest] = STEPS_96K;
  play(first);
  poll();
  frame(STEP_MS);
  const before = spec.draws.length;
  for (const rows of rest) {
    play(rows);
    frame(STEP_MS);
  }
  return spec.draws.slice(before);
}

useStorage();
setApodWindow("60");
setMeterChannel("sum");
setSpectrumOffset(OFFSET_S);
initApodHistory();
initSpectrogram();
openStage.value = "source";
setPollStep(1);
newTrack();
useEventSource();
openMeterFeed(clock);
lastStream()?.emit("geometry", geometry(RATE_96K));
startMeterLoop(clock);
onMeterPaint(() => {});

test("test_the_spectrogram_scrolls_the_playback_each_paint_crossed_on_every_paint", () => {
  assert.deepEqual(scrolls(), new Array(STEPS_96K.length - 1).fill(COLUMNS_PER_STEP));
});
