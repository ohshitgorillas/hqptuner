// Store suite for the frequency span on hqptuner/static/store/meter/loop.js: at a span, the per-frame trace columns the
// scene hands every spectrum style hold only the band from 0 Hz up to that fraction of the source Nyquist, spread
// across all of them, and nothing from above the top of the view. Every style paints from these columns, so what they
// hold is what each style draws. Right after a span change, the smoothed trace and its ghost show the new view at
// once, with nothing eased or held over from the previous view's frequencies. What the span does to the axis is tests/js/store/faceplate-page/meter-span.test.js's.
//
// Feed frames arrive through openMeterFeed() on the EventSource fake (tests/js/support/eventsource.js), as the payloads
// /api/meter/feed sends; animation frames through a fake Clock that moves only when told, as in
// tests/js/store/meter/loop.test.js. The span cases read the scene before smoothing, through its raw columns; the span
// change cases read the smoothed trace and its ghost on the first step after the pick. Each case's bin count
// puts one bin on each trace column's lower edge across the view, the bin at the top of the view sharing the last
// column. The span is set through the view store's setter.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-span.test.js

import test, { afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setFreqSpan } from "../../../../hqptuner/static/store/faceplate/view.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { near } from "../../support/near.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene} MeterScene */

const FRAME_MS = 16.7;
const STEP_MS = 1000 / 30;
const NYQUIST = 48000;
//: The trace's column count.
const TRACE_COLS = 600;
//: The trace column in the middle of the width.
const MID_COL = TRACE_COLS / 2;

// The spans, as the store holds them: the whole band, its lower half, its lower quarter.
const FULL = "full";
const HALF = "half";
const QUARTER = "quarter";

//: The lone loud bin's byte and level, and every other bin's byte and level: dB = -byte * 0.5.
const LOUD_BYTE = 20;
const LOUD_DB = -10;
const QUIET_BYTE = 120;
const QUIET_DB = -60;

// Per span, the bin count that puts the top of the view on bin 600, one bin a column; the bin at the middle of the view,
// and a bin three quarters of the way up the whole band, above the top of the view.
const CASES = [
  { span: HALF, bins: 2 * TRACE_COLS + 1, mid: MID_COL, above: (3 * TRACE_COLS) / 2 },
  { span: QUARTER, bins: 4 * TRACE_COLS + 1, mid: MID_COL, above: 3 * TRACE_COLS },
];

/** A clock that moves only on `frame`: each call is one animation frame, `ms` after the last. */
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
  /** Run one animation frame `ms` after the last. */
  const frame = (ms = FRAME_MS) => {
    now += ms;
    const due = queued;
    queued = [];
    due.forEach((fn) => fn(now));
  };
  return { clock, frame };
}

const { clock, frame } = frameClock();

/**
 * `n` bins of one channel, every one quiet but bin `at` loud, two bytes a bin with the low one first.
 *
 * @param {number} n
 * @param {number} at
 */
const spike = (n, at) =>
  btoa(String.fromCharCode(...Array.from({ length: n }, (_, k) => [k === at ? LOUD_BYTE : QUIET_BYTE, 0]).flat()));

/**
 * The raw trace columns of the scene a step paints at span `span`, after one frame of `bins` bins loud at bin `at`.
 *
 * @param {{ span: string, bins: number, at: number }} c
 * @returns {number[]}
 */
function columns({ span, bins, at }) {
  setFreqSpan(span);
  lastStream()?.emit("geometry", { nyquist: NYQUIST, channels: 1, bins });
  frame(STEP_MS);
  lastStream()?.emit("frame", { channels: [{ peak: -10, rms: -20, bins: spike(bins, at) }], ms: 16.667 });
  frame();
  frame();
  return Array.from(scenes.at(-1)?.raw ?? []);
}

/** @type {MeterScene[]} */
let scenes = [];
let unpaint = () => {};

before(() => {
  startMeterLoop(clock);
});

beforeEach(() => {
  useStorage();
  setSpectrumOffset(0);
  setFreqSpan(FULL);
  engineStatus.value = { status: { state: "2" } };
  closeMeterFeed();
  useEventSource();
  openMeterFeed(clock.now);
  scenes = [];
  unpaint = onMeterPaint((scene) => scenes.push(scene));
});

afterEach(() => {
  unpaint();
});

for (const { span, bins, mid, above } of CASES) {
  test(`test_at_the_${span}_view_content_at_the_middle_of_the_view_lands_mid_width`, () => {
    assert.ok(...near(columns({ span, bins, at: mid })[MID_COL] ?? NaN, LOUD_DB, 1e-3));
  });

  test(`test_at_the_${span}_view_content_above_the_top_of_the_view_lands_in_no_column`, () => {
    assert.ok(...near(Math.max(...columns({ span, bins, at: above })), QUIET_DB, 1e-3));
  });
}

// --- a span change ---------------------------------------------------------------------------------------------------

//: A bin count that puts two bins on each trace column at Full and one on each across the half view.
const CHANGE_BINS = 2 * TRACE_COLS + 1;
//: A bin three quarters of the way up the whole band: column 450 at Full, above the top of the half view.
const HIGH_BIN = (3 * TRACE_COLS) / 2;
//: Steps the trace is held at Full before the span changes, long enough for it and its ghost to settle on the frames.
const SETTLE_STEPS = 30;

/** Send one step's worth of feed frames, loud at HIGH_BIN, and run the step. */
function stepLoudHigh() {
  const loud = spike(CHANGE_BINS, HIGH_BIN);
  lastStream()?.emit("frame", { channels: [{ peak: -10, rms: -20, bins: loud }], ms: 16.667 });
  lastStream()?.emit("frame", { channels: [{ peak: -10, rms: -20, bins: loud }], ms: 16.667 });
  frame();
  frame();
}

/**
 * The smoothed spectrum the first step after a pick of the half view paints, the trace having been held at Full on a
 * loud bin the half view leaves above its top.
 *
 * @returns {{ disp: number[], ghost: number[] }}
 */
function firstSceneAfterHalving() {
  lastStream()?.emit("geometry", { nyquist: NYQUIST, channels: 1, bins: CHANGE_BINS });
  frame(STEP_MS);
  for (let k = 0; k < SETTLE_STEPS; k++) stepLoudHigh();
  setFreqSpan(HALF);
  stepLoudHigh();
  const spectrum = scenes.at(-1)?.spectrum;
  return { disp: Array.from(spectrum?.disp ?? []), ghost: Array.from(spectrum?.ghost ?? []) };
}

test("test_right_after_a_span_change_the_trace_shows_none_of_the_previous_views_content", () => {
  assert.ok(...near(Math.max(...firstSceneAfterHalving().disp), QUIET_DB, 1e-3));
});

test("test_right_after_a_span_change_the_ghost_holds_none_of_the_previous_views_peaks", () => {
  assert.ok(...near(Math.max(...firstSceneAfterHalving().ghost), QUIET_DB, 1e-3));
});
