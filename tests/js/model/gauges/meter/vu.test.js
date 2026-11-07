// Behavioral suite for the Source VU needles (hqptuner/static/model/gauges/meter/vu.js): one needle per channel, driven by
// that channel's RMS in dBFS, moved only by the elapsed time handed to each step, reading in VU against the VU
// reference and held on the -20 to +3 VU scale.
//
// The dynamic response is pinned against IEC 60268-17, committed as tests/support/fixtures/iec60268-17/. The
// standard states the needle's travel as a percentage of reference deflection on a scale linear in voltage, 100% at
// 0 VU, so a deflection of p% reads 20·log10(p / 100) VU.
//
// Time is a table: every step a test runs is a frame of a stated length in seconds. Nothing here reads a clock or
// waits on one.
//
// Run: node --test tests/js/model/gauges/meter/vu.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { restVu, stepVu } from "../../../../../hqptuner/static/model/gauges/meter/vu.js";
import * as vuModel from "../../../../../hqptuner/static/model/gauges/meter/vu.js";
import { near } from "../../../support/near.js";

/** @typedef {{ vu: number[] }} VuState */

/**
 * @type {{
 *   referenceDeflectionPercent: number,
 *   responseDeflectionPercent: number,
 *   responseTimeMs: number,
 *   responseTimeTolerancePercent: number,
 *   overshootMinPercent: number,
 *   overshootMaxPercent: number,
 *   scaleMinVu: number,
 *   scaleMaxVu: number,
 * }}
 */
const IEC = JSON.parse(
  readFileSync(new URL("../../../../support/fixtures/iec60268-17/vu-dynamic-response.json", import.meta.url), "utf8"),
);

/**
 * The VU reading of a deflection stated as a percentage of reference deflection.
 *
 * @param {number} percent
 */
const vuOfDeflection = (percent) => 20 * Math.log10(percent / IEC.referenceDeflectionPercent);

//: The reading the standard's response-time clause names: 99% of reference deflection.
const RESPONSE_VU = vuOfDeflection(IEC.responseDeflectionPercent);
//: The least and the most the needle may overshoot reference deflection.
const OVERSHOOT_MIN_VU = vuOfDeflection(IEC.referenceDeflectionPercent + IEC.overshootMinPercent);
const OVERSHOOT_MAX_VU = vuOfDeflection(IEC.referenceDeflectionPercent + IEC.overshootMaxPercent);
//: The earliest and latest the needle may reach 99% of reference deflection, in ms.
const RESPONSE_EARLIEST_MS = IEC.responseTimeMs * (1 - IEC.responseTimeTolerancePercent / 100);
const RESPONSE_LATEST_MS = IEC.responseTimeMs * (1 + IEC.responseTimeTolerancePercent / 100);

//: The three VU references the user may pick, in dBFS.
const REFERENCES = [-14, -18, -20];
//: The reference the single-reference cases run against, and an RMS level between the two outer references.
const REF = -18;
const BETWEEN = -18;
//: The outer references, and the steady reading they must differ by at `BETWEEN`.
const REF_HIGH = -14;
const REF_LOW = -20;
const REF_SPAN_DB = REF_HIGH - REF_LOW;

//: A fine frame for timing the response, a frame as the meter feed hands them, and a stalled frame three times as long.
const FINE_S = 0.001;
const FRAME_S = 0.01;
const LONG_FRAME_S = 0.03;
//: Long enough for any needle within the standard to settle to its steady reading.
const SETTLE_MS = 3000;
//: Part-way up the needle's rise, where its reading still moves fast.
const MID_RISE_MS = 150;
//: A level 10 dB under the reference, held on a second channel.
const UNDER_DB = 10;
//: Far enough past either end of the scale that a needle that is not held there leaves it.
const BEYOND_DB = 40;

//: Tolerance for a steady reading, and for one elapsed time handed in frames of two sizes.
const STEADY_EPS = 0.01;
const FRAMING_EPS = 0.1;
//: Tolerance for float rounding in a reading the scale holds at its end.
const END_EPS = 1e-9;

/**
 * The readings after each of `frames` steps of `dt` seconds, every step holding the same per-channel levels, from
 * `start`. Each step's readings are copied out, so a step that moves the state it is handed leaves the record intact.
 *
 * @param {ReturnType<typeof restVu>} start
 * @param {number[]} rms
 * @param {number} reference
 * @param {{ dt: number, frames: number }} steps
 * @returns {VuState[]}
 */
function trajectoryFrom(start, rms, reference, { dt, frames }) {
  /** @type {VuState[]} */
  const states = [];
  let state = start;
  for (let k = 0; k < frames; k++) {
    state = stepVu(state, rms, dt, reference);
    states.push({ vu: [...state.vu] });
  }
  return states;
}

/**
 * The readings after each of `frames` steps of `dt` seconds, every step holding the same per-channel levels, from rest.
 *
 * @param {number[]} rms
 * @param {number} reference
 * @param {number} dt
 * @param {number} frames
 * @returns {VuState[]}
 */
const trajectory = (rms, reference, dt, frames) => trajectoryFrom(restVu(rms.length), rms, reference, { dt, frames });

/**
 * Channel 0's reading after one level is held from rest for `ms`, in frames of `dt` seconds.
 *
 * @param {number} rms
 * @param {number} reference
 * @param {number} ms
 * @param {number} dt
 */
const readingAfter = (rms, reference, ms, dt = FINE_S) =>
  trajectory([rms], reference, dt, Math.round(ms / 1000 / dt)).at(-1)?.vu[0] ?? NaN;

/**
 * The highest reading channel 0 shows while one level is held from rest for `SETTLE_MS`.
 *
 * @param {number} rms
 * @param {number} reference
 */
const peakReading = (rms, reference) =>
  Math.max(...trajectory([rms], reference, FINE_S, SETTLE_MS).map((s) => s.vu[0] ?? NaN));

//: The fine frames in a settle.
const SETTLE_FRAMES = Math.round(SETTLE_MS / 1000 / FINE_S);

/**
 * Channel 0's reading after each fine step of a settle from rest, read off the needle array taken from the state
 * before the first step, while that one state is stepped and every step's return is dropped, as a paint does.
 *
 * @param {number} rms
 * @param {number} reference
 */
function readingsHeldInPlace(rms, reference) {
  const state = restVu(1);
  const needles = state.vu;
  /** @type {number[]} */
  const readings = [];
  for (let k = 0; k < SETTLE_FRAMES; k++) {
    stepVu(state, [rms], FINE_S, reference);
    readings.push(needles[0] ?? NaN);
  }
  return readings;
}

/**
 * The state a one-channel needle reaches after one level is held from rest for a settle, in fine frames.
 *
 * @param {number} rms
 * @param {number} reference
 */
function settledAt(rms, reference) {
  let state = restVu(1);
  for (let k = 0; k < SETTLE_FRAMES; k++) state = stepVu(state, [rms], FINE_S, reference);
  return state;
}

/**
 * The readings that follow the needle's arrival at a stop its level drives it past, found as the first reading after
 * which the needle travels back away from the stop rather than on toward it; none when the needle never turns back.
 * A strike may fall anywhere inside a step, so arrival is read off the needle's direction, not off a reading that lies
 * on the stop.
 *
 * @param {number[]} readings
 * @param {number} stop
 */
function readingsAfterReaching(readings, stop) {
  const toward = Math.sign(stop - (readings[0] ?? stop));
  const turn = readings.findIndex((r, k) => ((readings[k + 1] ?? r) - r) * toward < 0);
  return turn < 0 ? [] : readings.slice(turn + 1);
}

/**
 * Channel 0's readings after it first reaches a stop and turns back, while one level is held for a settle from `start`.
 *
 * @param {ReturnType<typeof restVu>} start
 * @param {number} rms
 * @param {number} reference
 * @param {number} stop
 */
const readingsAfterTheStop = (start, rms, reference, stop) =>
  readingsAfterReaching(
    trajectoryFrom(start, [rms], reference, { dt: FINE_S, frames: SETTLE_FRAMES }).map((s) => s.vu[0] ?? NaN),
    stop,
  );

test("test_a_level_at_the_reference_is_short_of_99_percent_deflection_before_the_earliest_response_time", () => {
  assert.ok(readingAfter(REF, REF, RESPONSE_EARLIEST_MS) < RESPONSE_VU);
});

test("test_a_level_at_the_reference_reaches_99_percent_deflection_by_the_latest_response_time", () => {
  assert.ok(readingAfter(REF, REF, RESPONSE_LATEST_MS) >= RESPONSE_VU);
});

test("test_a_level_at_the_reference_overshoots_reference_deflection_by_at_least_the_least_overshoot", () => {
  assert.ok(peakReading(REF, REF) >= OVERSHOOT_MIN_VU);
});

test("test_a_level_at_the_reference_overshoots_reference_deflection_by_no_more_than_the_most_overshoot", () => {
  assert.ok(peakReading(REF, REF) <= OVERSHOOT_MAX_VU);
});

for (const reference of REFERENCES) {
  test(`test_a_steady_level_at_a_reference_of_${-reference}_dbfs_below_full_scale_reads_0_vu`, () => {
    assert.ok(...near(readingAfter(reference, reference, SETTLE_MS), 0, STEADY_EPS));
  });
}

test("test_moving_the_reference_moves_the_steady_reading_by_the_same_number_of_db", () => {
  const shift = readingAfter(BETWEEN, REF_LOW, SETTLE_MS) - readingAfter(BETWEEN, REF_HIGH, SETTLE_MS);
  assert.ok(...near(shift, REF_SPAN_DB, STEADY_EPS));
});

test("test_each_channel_needle_reads_its_own_channel_level", () => {
  const settled = trajectory([REF, REF - UNDER_DB], REF, FRAME_S, Math.round(SETTLE_MS / 1000 / FRAME_S)).at(-1);
  assert.ok(...near(settled?.vu[1] ?? NaN, -UNDER_DB, STEADY_EPS));
});

test("test_a_steady_level_above_the_top_of_the_scale_holds_the_needle_at_the_top", () => {
  assert.ok(...near(readingAfter(REF + BEYOND_DB, REF, SETTLE_MS), IEC.scaleMaxVu, END_EPS));
});

test("test_the_needle_overshooting_toward_the_top_of_the_scale_never_reads_past_it", () => {
  assert.ok(peakReading(REF + IEC.scaleMaxVu, REF) <= IEC.scaleMaxVu + END_EPS);
});

test("test_a_steady_level_below_the_bottom_of_the_scale_holds_the_needle_at_the_bottom", () => {
  assert.ok(...near(readingAfter(REF - BEYOND_DB, REF, SETTLE_MS), IEC.scaleMinVu, END_EPS));
});

test("test_a_needle_at_rest_reads_the_bottom_of_the_scale", () => {
  assert.ok(...near(restVu(1).vu[0] ?? NaN, IEC.scaleMinVu, END_EPS));
});

test("test_a_step_handed_no_elapsed_time_leaves_the_needle_where_it_was", () => {
  assert.ok(...near(stepVu(restVu(1), [REF], 0, REF).vu[0] ?? NaN, IEC.scaleMinVu, END_EPS));
});

test("test_the_same_elapsed_time_moves_the_needle_as_far_in_long_frames_as_in_short_ones", () => {
  const gap = readingAfter(REF, REF, MID_RISE_MS, LONG_FRAME_S) - readingAfter(REF, REF, MID_RISE_MS, FRAME_S);
  assert.ok(...near(gap, 0, FRAMING_EPS));
});

test("test_a_state_stepped_in_place_carries_its_needle_past_reference_deflection", () => {
  const peak = Math.max(...readingsHeldInPlace(REF, REF));
  assert.ok(peak >= OVERSHOOT_MIN_VU, `peak read off the held needles ${peak} VU, want at least ${OVERSHOOT_MIN_VU}`);
});

test("test_the_bottom_of_the_dial_scale_is_exported_at_the_bottom_of_the_vu_scale", () => {
  assert.equal(vuModel.SCALE_MIN_VU, IEC.scaleMinVu);
});

test("test_the_top_of_the_dial_scale_is_exported_at_the_top_of_the_vu_scale", () => {
  assert.equal(vuModel.SCALE_MAX_VU, IEC.scaleMaxVu);
});

test("test_a_needle_overshooting_onto_the_top_stop_rebounds_back_down_the_scale", () => {
  const after = readingsAfterTheStop(restVu(1), REF + IEC.scaleMaxVu, REF, IEC.scaleMaxVu);
  const lowest = Math.min(...after);
  assert.ok(lowest < IEC.scaleMaxVu - STEADY_EPS, `lowest of ${after.length} readings after the stop ${lowest} VU`);
});

test("test_a_needle_falling_onto_the_bottom_stop_rebounds_back_up_the_scale", () => {
  const after = readingsAfterTheStop(settledAt(REF, REF), REF - BEYOND_DB, REF, IEC.scaleMinVu);
  const highest = Math.max(...after);
  assert.ok(highest > IEC.scaleMinVu + STEADY_EPS, `highest of ${after.length} readings after the stop ${highest} VU`);
});
