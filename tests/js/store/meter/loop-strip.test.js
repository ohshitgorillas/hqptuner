// Store suite for the apodizing strip's right edge (store/meter/spectrogram.js stripEnd) while the meter loop
// (store/meter/loop.js) paces the feed: the edge moves on by the same playback every step, the playback the loop's
// playhead crossed, however the feed's events fall across those steps.
//
// Feed events arrive through openMeterFeed() on the EventSource fake (tests/js/support/eventsource.js), as the payloads
// /api/meter/feed sends, stamped from STEPS_48K, a table written out by hand; the strip's bins through the poll seam
// (tests/js/support/apodpolls.js), one track whose second poll records one bin once the first step's events are queued,
// so the bin carries a playback stamp. The loop runs on a fake Clock that moves only when the case runs an animation
// frame, each one step 100 ms after the last. The meters run 0.1 s behind the feed, and every step the feed sends
// 100 ms of playback as five events, 20 ms long for the first three steps and 22.5, 22.5, 17.5, 17.5 and 20 ms long
// from the fourth, so the queue ahead of the playhead holds the delay exactly and the playhead crosses exactly 100 ms a
// step.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-strip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { initSpectrogram, stripEnd } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { setApodWindow, setMeterChannel } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll, setPollStep } from "../../support/apodpolls.js";
import { RATE_48K, geometry, play } from "../../support/meterfeed.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../support/meterfeed.js").Stamp} Stamp */

//: Wall time between two animation frames, ms, and the playback each step's events cover.
const STEP_MS = 100;
//: The meters' offset behind the feed, s: one step's playback.
const OFFSET_S = STEP_MS / 1000;

/**
 * Seven steps of events at 48 kHz from 5 s of playback on, each event starting where the one before it ended and each
 * step covering 4800 samples, 100 ms: 20 ms events for three steps, then 22.5, 22.5, 17.5, 17.5 and 20 ms from the
 * fourth.
 *
 * @type {Stamp[][]}
 */
const STEPS_48K = [
  [
    { at: 240000, n: 960 },
    { at: 240960, n: 960 },
    { at: 241920, n: 960 },
    { at: 242880, n: 960 },
    { at: 243840, n: 960 },
  ],
  [
    { at: 244800, n: 960 },
    { at: 245760, n: 960 },
    { at: 246720, n: 960 },
    { at: 247680, n: 960 },
    { at: 248640, n: 960 },
  ],
  [
    { at: 249600, n: 960 },
    { at: 250560, n: 960 },
    { at: 251520, n: 960 },
    { at: 252480, n: 960 },
    { at: 253440, n: 960 },
  ],
  [
    { at: 254400, n: 1080 },
    { at: 255480, n: 1080 },
    { at: 256560, n: 840 },
    { at: 257400, n: 840 },
    { at: 258240, n: 960 },
  ],
  [
    { at: 259200, n: 1080 },
    { at: 260280, n: 1080 },
    { at: 261360, n: 840 },
    { at: 262200, n: 840 },
    { at: 263040, n: 960 },
  ],
  [
    { at: 264000, n: 1080 },
    { at: 265080, n: 1080 },
    { at: 266160, n: 840 },
    { at: 267000, n: 840 },
    { at: 267840, n: 960 },
  ],
  [
    { at: 268800, n: 1080 },
    { at: 269880, n: 1080 },
    { at: 270960, n: 840 },
    { at: 271800, n: 840 },
    { at: 272640, n: 960 },
  ],
];

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

const { clock, frame } = frameClock();

/**
 * How far the strip's right edge moved on each step after the first, playback ms, over the steps of STEPS_48K.
 *
 * @returns {number[]}
 */
function moves() {
  const [first = [], ...rest] = STEPS_48K;
  play(first);
  poll();
  frame(STEP_MS);
  /** @type {number[]} */
  const moved = [];
  let was = stripEnd.value ?? NaN;
  for (const rows of rest) {
    play(rows);
    frame(STEP_MS);
    const now = stripEnd.value ?? NaN;
    moved.push(now - was);
    was = now;
  }
  return moved;
}

useStorage();
setApodWindow("60");
setMeterChannel("sum");
setSpectrumOffset(OFFSET_S);
initApodHistory();
initSpectrogram();
setPollStep(1);
newTrack();
useEventSource();
openMeterFeed(clock);
lastStream()?.emit("geometry", geometry(RATE_48K));
startMeterLoop(clock);
onMeterPaint(() => {});

test("test_the_strip_edge_moves_on_by_the_playback_each_step_crossed_on_every_step", () => {
  assert.deepEqual(moves(), new Array(STEPS_48K.length - 1).fill(STEP_MS));
});
