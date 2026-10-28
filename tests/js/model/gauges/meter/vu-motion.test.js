// Behavioral suite for the Source VU needles' motion against the paint rate and a restart
// (hqptuner/static/model/gauges/meter/vu.js): after a loud history, the same wall time moves a needle as far when it is
// painted in late frames as in steady ones, and a needle started afresh moves exactly as a meter that never heard
// anything does on its first step.
//
// A meter that never heard anything is a second instance of the model, loaded under the `.fresh-<tag>.js` specifier
// tests/js/support/vendor-resolve.js provides, so nothing this file runs reaches it before it is read.
//
// Time is a table: every step a test runs is a frame of a stated length in seconds. Nothing here reads a clock or
// waits on one.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/meter/vu-motion.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { restVu, stepVu } from "../../../../../hqptuner/static/model/gauges/meter/vu.js";
import { near } from "../../../support/near.js";

const MODULE = "../../../../../hqptuner/static/model/gauges/meter/vu.js";

/** @type {{ restVu: typeof restVu, stepVu: typeof stepVu }} */
const unheard = await import(`${MODULE.replace(/\.js$/, ".fresh-unheard.js")}`);

//: The level that reads 0 VU, dBFS.
const REF = -18;
//: A level 10 dB under the reference, on the scale.
const ON_SCALE_DB = REF - 10;
//: A level 40 dB under the reference, far below the bottom of the scale.
const BELOW_SCALE_DB = REF - 40;
//: A level between the reference and the bottom of the scale.
const MID_DB = REF - 6;
//: Two channels.
const CHANNELS = 2;

//: A steady paint, s, and a late paint four steady paints long.
const STEADY_S = 1 / 32;
const LATE_S = 1 / 8;
const STEADY_PER_LATE = 4;
//: How long the needles hear the reference before the level drops, s: long enough to settle on it.
const HISTORY_S = 3;
//: Moments compared after the drop, one late paint apart: four seconds in all.
const MOMENTS = 32;

//: How far apart, VU, two readings after the same wall time may stand.
const FRAMING_EPS = 0.1;
//: How far a restarted needle may stand from an unheard one, VU: float rounding only.
const SAME_EPS = 1e-9;

/**
 * Needles that have heard the reference on every channel for HISTORY_S, in steady frames.
 *
 * @returns {ReturnType<typeof restVu>}
 */
function afterHistory() {
  let state = restVu(CHANNELS);
  const rms = Array.from({ length: CHANNELS }, () => REF);
  for (let t = 0; t < HISTORY_S - 1e-9; t += STEADY_S) state = stepVu(state, rms, STEADY_S, REF);
  return state;
}

/**
 * Channel 0's reading at each of MOMENTS moments, LATE_S apart, after the level drops from the reference to `db` on
 * every channel, the drop painted in frames of `dt` seconds, `per` of them to each moment.
 *
 * @param {number} db
 * @param {number} dt
 * @param {number} per
 * @returns {number[]}
 */
function readingsAfterDrop(db, dt, per) {
  let state = afterHistory();
  const rms = Array.from({ length: CHANNELS }, () => db);
  /** @type {number[]} */
  const out = [];
  for (let k = 0; k < MOMENTS; k++) {
    for (let i = 0; i < per; i++) state = stepVu(state, rms, dt, REF);
    out.push(state.vu[0] ?? NaN);
  }
  return out;
}

/**
 * The widest distance, VU, between the readings a drop to `db` shows at the same moments painted late and painted
 * steady.
 *
 * @param {number} db
 */
function lateAgainstSteady(db) {
  const steady = readingsAfterDrop(db, STEADY_S, STEADY_PER_LATE);
  const late = readingsAfterDrop(db, LATE_S, 1);
  return Math.max(...late.map((r, k) => Math.abs(r - (steady[k] ?? NaN))));
}

test("test_a_needle_falling_to_a_level_on_the_scale_moves_as_far_on_late_paints_as_on_steady_ones", () => {
  assert.ok(...near(lateAgainstSteady(ON_SCALE_DB), 0, FRAMING_EPS));
});

test("test_a_needle_falling_onto_the_bottom_stop_moves_as_far_on_late_paints_as_on_steady_ones", () => {
  assert.ok(...near(lateAgainstSteady(BELOW_SCALE_DB), 0, FRAMING_EPS));
});

test("test_after_a_loud_history_a_restarted_needle_takes_its_first_step_as_an_unheard_meter_does", () => {
  afterHistory();
  const mid = Array.from({ length: CHANNELS }, () => MID_DB);
  const restarted = stepVu(restVu(CHANNELS), mid, STEADY_S, REF).vu[0] ?? NaN;
  const fresh = unheard.stepVu(unheard.restVu(CHANNELS), mid, STEADY_S, REF).vu[0] ?? NaN;
  assert.ok(...near(restarted, fresh, SAME_EPS));
});
