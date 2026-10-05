// Store suite for hqptuner/static/store/meter/loop.js: the animation-frame loop that steps the source meter's levels
// and spectrum toward the newest feed frames and hands each frame's scene to the painters.
//
// Feed frames arrive through openMeterFeed() on the EventSource fake (tests/js/support/eventsource.js), as the
// payloads /api/meter/feed sends. Animation frames arrive through a fake Clock whose requestAnimationFrame queues and
// whose frame() moves time one 16.7 ms frame and runs what was queued for it; its timers never fire. The loop starts
// once for the whole file on that clock. Each case reopens the feed, whose fresh geometry resets the scene, and runs
// one frame so the reset lands before the case sends anything.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop.test.js

import test, { afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { stepLevel } from "../../../../hqptuner/static/model/gauges/meter.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { near } from "../../support/near.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene} MeterScene */

const FRAME_MS = 16.7;
const BINS = 8;
const PLAYING = { status: { state: "2" } };
const STOPPED = { status: { state: "0" } };

/** A clock that moves only on `frame`: each call is one animation frame, 16.7 ms after the last. */
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
  /** Run one animation frame and return its stamp. */
  const frame = () => {
    now += FRAME_MS;
    const due = queued;
    queued = [];
    due.forEach((fn) => fn(now));
    return now;
  };
  return { clock, frame };
}

const { clock, frame } = frameClock();

/**
 * Every bin of one channel at byte `byte`, encoded as the feed sends it: dB = -byte * 0.5.
 *
 * @param {number} byte
 */
const bins = (byte) => btoa(String.fromCharCode(...new Array(BINS).fill(byte)));

/**
 * Send one single-channel feed frame.
 *
 * @param {{ peak: number, rms: number, byte: number }} reading
 */
function send({ peak, rms, byte }) {
  lastStream()?.emit("frame", { channels: [{ peak, rms, bins: bins(byte) }], ms: 16.667 });
}

/** @type {MeterScene[]} */
let scenes = [];
let unpaint = () => {};

before(() => {
  startMeterLoop(clock);
});

beforeEach(() => {
  engineStatus.value = { ...PLAYING };
  useEventSource();
  openMeterFeed(clock.now);
  lastStream()?.emit("geometry", { nyquist: 48000, channels: 1, bins: BINS });
  frame();
  scenes = [];
  unpaint = onMeterPaint((scene) => scenes.push(scene));
});

afterEach(() => {
  unpaint();
});

test("test_the_rms_after_six_animation_frames_is_six_steps_toward_the_feed_frame", () => {
  send({ peak: -30, rms: -40, byte: 60 });
  const stamps = [frame()];
  send({ peak: -5, rms: -10, byte: 60 });
  for (let k = 0; k < 6; k++) stamps.push(frame());
  let reading = { peak: -30, rms: -40, hold: -30, holdAt: stamps[0] };
  for (let k = 1; k < stamps.length; k++) {
    reading = stepLevel(reading, { peak: -5, rms: -10 }, stamps[k], (stamps[k] - stamps[k - 1]) / 1000);
  }
  assert.ok(...near(scenes.at(-1)?.levels[0]?.rms ?? NaN, reading.rms, 1e-6));
});

test("test_three_feed_frames_between_two_animation_frames_show_their_loudest_peak", () => {
  frame();
  send({ peak: -20, rms: -30, byte: 60 });
  send({ peak: -6, rms: -30, byte: 60 });
  send({ peak: -15, rms: -30, byte: 60 });
  frame();
  assert.equal(scenes.at(-1)?.levels[0]?.peak, -6);
});

test("test_the_trace_shows_a_40_db_drop_on_the_next_animation_frame", () => {
  send({ peak: -10, rms: -20, byte: 20 });
  frame();
  send({ peak: -10, rms: -20, byte: 100 });
  frame();
  assert.deepEqual([...new Set(scenes.at(-1)?.spectrum?.disp ?? [])], [-50]);
});

test("test_the_held_peaks_stay_at_the_loudest_level_after_the_trace_drops", () => {
  send({ peak: -10, rms: -20, byte: 20 });
  frame();
  send({ peak: -10, rms: -20, byte: 100 });
  frame();
  assert.deepEqual([...new Set(scenes.at(-1)?.spectrum?.peak ?? [])], [-10]);
});

test("test_a_painter_runs_once_per_animation_frame_until_it_is_unregistered", () => {
  let calls = 0;
  const stop = onMeterPaint(() => (calls += 1));
  frame();
  frame();
  frame();
  const whileRegistered = calls;
  stop();
  frame();
  frame();
  assert.deepEqual([whileRegistered, calls], [3, 3]);
});

test("test_a_second_start_runs_no_second_loop", () => {
  startMeterLoop(clock);
  frame();
  assert.equal(scenes.length, 1);
});

test("test_playback_stopping_empties_the_scene", () => {
  send({ peak: -10, rms: -20, byte: 20 });
  frame();
  engineStatus.value = { ...STOPPED };
  frame();
  assert.deepEqual(scenes.at(-1), { levels: [], spectrum: null });
});
