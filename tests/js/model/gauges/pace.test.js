// Behavioral suite for the spectrum's pacing model (hqptuner/static/model/gauges/pace.js): holding frames back until
// the delay is buffered, handing out one step's worth of frame time, trimming that pace toward the delay, dropping the
// oldest frames when the delay is lowered or the buffer runs far past it, and leaving no budget behind an underrun.
//
// Time is a table: every step a test runs is a row holding the frames that arrived, its `dt` (ms) and the delay (ms)
// in force. Nothing here reads a clock or waits on one.
//
// Run: node --test tests/js/model/gauges/pace.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { PACE_IDLE, pace } from "../../../../hqptuner/static/model/gauges/pace.js";

//: One feed frame's span: 1024 samples at 96 kHz.
const FRAME_MS = 10.667;
//: One animation step at 30 steps a second.
const STEP_DT = 33.3;

/** @typedef {import("../../../../hqptuner/static/model/gauges/meter.js").MeterFrame} MeterFrame */
/** @typedef {{ add: number, dt: number, delay: number, ms?: number }} Row */
/** @typedef {{ handed: MeterFrame[], out: MeterFrame[], dropped: MeterFrame[], rest: MeterFrame[] }} Step */

/**
 * `n` fresh frames, each its own object so a test can tell them apart, each spanning `ms`.
 *
 * @param {number} n
 * @param {number} ms
 * @returns {MeterFrame[]}
 */
const frames = (n, ms) => Array.from({ length: n }, () => ({ channels: [], ms }));

/**
 * Each row's call from the idle state, threading the state and the frames left queued into the next row, with the
 * row's new frames appended after them. `handed` is the queue that row's call was given.
 *
 * @param {Row[]} rows
 * @returns {Step[]}
 */
function run(rows) {
  let state = PACE_IDLE;
  /** @type {MeterFrame[]} */
  let queue = [];
  return rows.map(({ add, dt, delay, ms = FRAME_MS }) => {
    const handed = [...queue, ...frames(add, ms)];
    const r = pace(state, handed, { dt, delay });
    state = r.state;
    queue = r.rest;
    return { handed, out: r.out, dropped: r.dropped, rest: r.rest };
  });
}

/**
 * The position of each of `picked` in the queue it was taken from.
 *
 * @param {MeterFrame[]} handed
 * @param {MeterFrame[]} picked
 * @returns {number[]}
 */
const positions = (handed, picked) => picked.map((f) => handed.indexOf(f));

/**
 * The positions of the first `n` frames of a queue.
 *
 * @param {number} n
 * @returns {number[]}
 */
const firstN = (n) => Array.from({ length: n }, (_, i) => i);

/**
 * The last row's step.
 *
 * @param {Step[]} steps
 * @returns {Step}
 */
const last = (steps) => steps[steps.length - 1];

/**
 * How many frames a step handed out, and whether what it left queued holds at least `delay` ms and less than one more
 * `ms` frame on top of it.
 *
 * @param {Step} step
 * @param {number} delay
 * @param {number} ms
 * @returns {{ out: number, cut: boolean }}
 */
function cut(step, delay, ms) {
  const held = step.rest.reduce((sum, f) => sum + f.ms, 0);
  return { out: step.out.length, cut: held >= delay && held < delay + ms };
}

test("ten frames under a 250 ms delay all stay queued", () => {
  const step = last(run([{ add: 10, dt: STEP_DT, delay: 250 }]));
  assert.equal(step.rest.length, 10);
});

test("once 250 ms is buffered a 33.3 ms step hands out the oldest 3 frames", () => {
  const step = last(run([{ add: 24, dt: STEP_DT, delay: 250 }]));
  assert.deepEqual(positions(step.handed, step.out), firstN(3));
});

test("lowering the delay from 250 to 100 drops the oldest frames down to the first count leaving 100 ms", () => {
  const step = last(
    run([
      { add: 24, dt: STEP_DT, delay: 250 },
      { add: 0, dt: STEP_DT, delay: 100 },
    ]),
  );
  assert.deepEqual(positions(step.handed, step.dropped), firstN(11));
});

test("raising the delay to 500 holds every step until 500 ms is buffered", () => {
  const raised = run([
    { add: 24, dt: STEP_DT, delay: 250 },
    ...Array.from({ length: 12 }, () => ({ add: 3, dt: STEP_DT, delay: 500 })),
  ]).slice(1);
  assert.equal(
    raised.findIndex((s) => s.out.length > 0),
    8,
  );
});

test("a buffer averaging 150 ms past the delay hands out 2% more frame time than the step", () => {
  const step = last(run([{ add: 40, ms: 10, dt: 99, delay: 250 }]));
  assert.equal(step.out.length, 10);
});

test("a buffer past the delay plus one second drops the oldest frames down to the delay", () => {
  const step = last(
    run([
      { add: 24, dt: STEP_DT, delay: 250 },
      { add: 97, dt: STEP_DT, delay: 250 },
    ]),
  );
  assert.deepEqual(positions(step.handed, step.dropped), firstN(94));
});

test("a step that empties the queue leaves no budget, so frames after an underrun come out at one step's pace", () => {
  const step = last(
    run([
      { add: 24, dt: STEP_DT, delay: 250 },
      ...Array.from({ length: 12 }, () => ({ add: 0, dt: STEP_DT, delay: 250 })),
      { add: 12, dt: STEP_DT, delay: 250 },
    ]),
  );
  assert.equal(step.out.length, 3);
});

test("a 30 s step over 6.5 s of queued 16 ms frames hands out nothing and drops the oldest down to the delay", () => {
  const step = last(
    run([
      { add: 32, ms: 16, dt: STEP_DT, delay: 500 },
      { add: 376, ms: 16, dt: 30000, delay: 500 },
    ]),
  );
  assert.deepEqual(cut(step, 500, 16), { out: 0, cut: true });
});

test("a 1 s step over 500 ms queued and 62 newly arrived 16 ms frames hands out nothing and drops down to the delay", () => {
  const step = last(
    run([
      { add: 53, ms: 10, dt: STEP_DT, delay: 500 },
      { add: 62, ms: 16, dt: 1000, delay: 500 },
    ]),
  );
  assert.deepEqual(cut(step, 500, 16), { out: 0, cut: true });
});
