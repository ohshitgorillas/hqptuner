// Store suite for hqptuner/static/store/meter/loop.js: the animation-frame loop that steps the scene at most once per
// 1/30 s, paces the feed frames out to it behind the effective delay, hands the scene to the painters on each step, and
// passes every frame it takes on to the spectrogram exactly once.
//
// Feed frames arrive through openMeterFeed() on the EventSource fake (tests/js/support/eventsource.js), as the
// payloads /api/meter/feed sends. Animation frames arrive through a fake Clock whose requestAnimationFrame queues and
// whose frame() moves time one frame, 16.7 ms unless told otherwise, and runs what was queued for it; its timers never
// fire. Two 16.7 ms frames make one step, 33.4 ms long; a case that states its numbers at 30 fps steps on single
// frames exactly 1/30 s apart instead. The loop starts once for the whole file on that clock. Each case runs at no
// offset and no reported output delay unless it sets one, reopens the feed, whose fresh geometry resets the loop, and
// runs one frame a whole step long, so the reset lands on a step before the case sends anything. The spectrogram is
// read through spectrogramEnd, the frame time its fine slices have closed on. The loop requests animation frames only
// while a painter is registered and the feed is open, so the fake clock also says how many frame callbacks it holds.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop.test.js

import test, { afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { spectrogramEnd } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { near } from "../../support/near.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene} MeterScene */

const FRAME_MS = 16.7;
const STEP_MS = 1000 / 30;
const BINS = 8;
const PLAYING = { status: { state: "2" } };
const STOPPED = { status: { state: "0" } };
//: The trace's column count.
const TRACE_COLS = 600;
//: A bin count that puts one bin on each trace column's lower edge, the bin at Nyquist sharing the last column.
const EDGE_BINS = TRACE_COLS + 1;
//: The column at half Nyquist, and the bin on its lower edge.
const SPIKE_AT = TRACE_COLS / 2;
//: The lone loud bin's byte and level, and every other bin's byte, far enough below that smoothing pulls the loud
//: column down.
const LOUD_BYTE = 20;
const LOUD_DB = -10;
const QUIET_BYTE = 120;

/**
 * A clock that moves only on `frame`: each call is one animation frame, `ms` after the last; `waiting` is the number of
 * animation-frame callbacks queued for the next one.
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
  /** Run one animation frame `ms` after the last and return its stamp. */
  const frame = (ms = FRAME_MS) => {
    now += ms;
    const due = queued;
    queued = [];
    due.forEach((fn) => fn(now));
    return now;
  };
  return { clock, frame, waiting: () => queued.length };
}

const { clock, frame, waiting } = frameClock();

/** Run two 16.7 ms animation frames, the second of which steps the scene, and return the step's stamp. */
const step = () => {
  frame();
  return frame();
};

/**
 * Every bin of one channel at step `byte`, under 256, encoded as the feed sends it, two bytes a bin with the low one
 * first: dB = -byte * 0.5.
 *
 * @param {number} byte
 */
const bins = (byte) => btoa(String.fromCharCode(...new Array(BINS).fill([byte, 0]).flat()));

/**
 * `n` bins of one channel, every one at step `quiet` but bin `at` at step `loud`, encoded as `bins` encodes them.
 *
 * @param {{ n: number, at: number, loud: number, quiet: number }} shape
 */
const spike = ({ n, at, loud, quiet }) =>
  btoa(String.fromCharCode(...Array.from({ length: n }, (_, k) => [k === at ? loud : quiet, 0]).flat()));

/**
 * Send one single-channel feed frame covering `ms` of frame time.
 *
 * @param {{ peak: number, rms: number, byte: number, ms?: number }} reading
 */
function send({ peak, rms, byte, ms = 16.667 }) {
  lastStream()?.emit("frame", { channels: [{ peak, rms, bins: bins(byte) }], ms });
}

/**
 * The level the scene's trace shows, to the whole dB, for a trace as flat as the frames that made it.
 *
 * @param {MeterScene} scene
 */
const traceDb = (scene) => Math.round(scene.spectrum?.disp[0] ?? NaN);

/** @type {MeterScene[]} */
let scenes = [];
let unpaint = () => {};

before(() => {
  startMeterLoop(clock);
});

beforeEach(() => {
  useStorage();
  setSpectrumOffset(0);
  engineStatus.value = { ...PLAYING };
  useEventSource();
  openMeterFeed(clock);
  lastStream()?.emit("geometry", { nyquist: 48000, channels: 1, bins: BINS });
  frame(STEP_MS);
  scenes = [];
  unpaint = onMeterPaint((scene) => scenes.push(scene));
});

afterEach(() => {
  unpaint();
});

test("test_six_animation_frames_16_7_ms_apart_run_the_painters_3_times", () => {
  for (let k = 0; k < 6; k++) frame();
  assert.equal(scenes.length, 3);
});

test("test_three_feed_frames_handed_out_at_one_step_show_their_loudest_peak", () => {
  send({ peak: -20, rms: -30, byte: 60, ms: 10.667 });
  send({ peak: -15, rms: -30, byte: 60, ms: 10.667 });
  send({ peak: -6, rms: -30, byte: 60, ms: 10.667 });
  step();
  assert.equal(scenes.at(-1)?.levels[0]?.peak, -6);
});

test("test_the_first_reading_after_playback_restarts_lands_outright", () => {
  send({ peak: -10, rms: -20, byte: 60 });
  step();
  engineStatus.value = { ...STOPPED };
  step();
  engineStatus.value = { ...PLAYING };
  send({ peak: -10, rms: -20, byte: 20 });
  step();
  assert.ok(...near(scenes.at(-1)?.spectrum?.disp[0] ?? NaN, -10, 0.005));
});

test("test_the_scene_carries_a_lone_loud_column_at_the_frames_level_before_smoothing", () => {
  lastStream()?.emit("geometry", { nyquist: 48000, channels: 1, bins: EDGE_BINS });
  frame(STEP_MS);
  const loud = spike({ n: EDGE_BINS, at: SPIKE_AT, loud: LOUD_BYTE, quiet: QUIET_BYTE });
  lastStream()?.emit("frame", { channels: [{ peak: -10, rms: -20, bins: loud }], ms: 16.667 });
  step();
  assert.ok(...near(scenes.at(-1)?.raw?.[SPIKE_AT] ?? NaN, LOUD_DB, 1e-3));
});

test("test_at_a_0_1_s_engine_output_delay_the_trace_shows_the_first_clump_once_the_feed_covers_it", () => {
  engineStatus.value = { status: { state: "2", output_delay: "100000" } };
  for (let k = 0; k < 5; k++) send({ peak: -10, rms: -20, byte: 20, ms: 10.667 });
  for (let k = 0; k < 6; k++) frame();
  for (let k = 0; k < 5; k++) send({ peak: -10, rms: -20, byte: 60, ms: 10.667 });
  step();
  assert.equal(scenes.map(traceDb)[3], -10);
});

test("test_a_registered_painter_runs_once_per_step", () => {
  let calls = 0;
  const stop = onMeterPaint(() => (calls += 1));
  step();
  step();
  stop();
  assert.equal(calls, 2);
});

test("test_an_unregistered_painter_runs_no_more", () => {
  let calls = 0;
  const stop = onMeterPaint(() => (calls += 1));
  step();
  step();
  stop();
  step();
  assert.equal(calls, 2);
});

test("test_a_second_start_runs_no_second_loop", () => {
  startMeterLoop(clock);
  step();
  assert.equal(scenes.length, 1);
});

test("test_every_frame_reaches_the_spectrogram_exactly_once_across_a_stop", () => {
  setApodWindow("300");
  setSpectrumOffset(0.1);
  const start = spectrogramEnd.value;
  for (let k = 0; k < 6; k++) send({ peak: -10, rms: -20, byte: 20, ms: 25 });
  step();
  for (let k = 0; k < 2; k++) send({ peak: -10, rms: -20, byte: 20, ms: 25 });
  engineStatus.value = { ...STOPPED };
  step();
  assert.ok(...near(spectrogramEnd.value - start, 200, 1e-9));
});

test("test_a_painter_registered_on_an_idle_loop_queues_exactly_one_frame", () => {
  unpaint();
  frame();
  unpaint = onMeterPaint((scene) => scenes.push(scene));
  assert.equal(waiting(), 1);
});

test("test_with_the_feed_closed_the_loop_queues_no_frame_after_the_next_one", () => {
  closeMeterFeed();
  frame();
  assert.equal(waiting(), 0);
});

test("test_playback_starting_again_queues_exactly_one_frame", () => {
  engineStatus.value = { ...STOPPED };
  frame();
  engineStatus.value = { ...PLAYING };
  assert.equal(waiting(), 1);
});

test("test_playback_stopping_hands_the_painters_the_empty_scene_with_no_frame_run", () => {
  send({ peak: -10, rms: -20, byte: 20 });
  step();
  engineStatus.value = { ...STOPPED };
  assert.deepEqual(scenes.at(-1), { levels: [], spectrum: null, raw: null });
});

test("test_the_frames_the_loop_holds_when_its_last_painter_unregisters_reach_the_spectrogram", () => {
  setSpectrumOffset(0.1);
  const start = spectrogramEnd.value;
  for (let k = 0; k < 6; k++) send({ peak: -10, rms: -20, byte: 20, ms: 25 });
  step();
  unpaint();
  assert.ok(...near(spectrogramEnd.value - start, 150, 1e-9));
});
