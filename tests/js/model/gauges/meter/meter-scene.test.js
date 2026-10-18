// Behavioral suite for the meter loop's one scene (foldFrames in hqptuner/static/model/gauges/meter/meter.js): the loop
// hands each fold the scene the fold before it returned, and the fold refills that scene and hands it back, keeping
// nothing of the earlier fold; a fresh scene comes only when the frames' channel or bin count changes. The fold's
// arithmetic is meter-math.test.js's; every case here folds one frame, whose fold reads that frame's own levels.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/meter/meter-scene.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { foldFrames } from "../../../../../hqptuner/static/model/gauges/meter/meter.js";
import { near } from "../../../support/near.js";

//: Tolerance for a level read back from a power average and possibly stored in a Float32Array.
const DB_EPS = 1e-3;
//: Levels of the earlier fold, loud, and of the later one, quiet, in dBFS.
const LOUD_PEAK = -1;
const LOUD_RMS = -3;
const LOUD_BIN = -6;
const QUIET_PEAK = -50;
const QUIET_RMS = -60;
const QUIET_BIN = -70;
//: The levels of a frame folded after a channel or bin count change, in dBFS.
const LATER_PEAK = -24;
const LATER_BINS = [-30, -45, -55];

/**
 * [ok, message] for spreading into ONE assert.ok: as many values as written, each within `tol` of its own.
 *
 * @param {ArrayLike<number>} actual
 * @param {number[]} expected
 * @param {number} tol
 * @returns {[boolean, string]}
 */
const nearEach = (actual, expected, tol) => [
  actual.length === expected.length && expected.every((e, i) => Math.abs(actual[i] - e) <= tol),
  `expected [${expected}] ± ${tol}, got [${Array.from(actual)}]`,
];

/**
 * One channel of a decoded feed frame.
 *
 * @param {number} peak  dBFS
 * @param {number} rms  dBFS
 * @param {number[]} bins  dBFS
 */
const channel = (peak, rms, bins) => ({ peak, rms, bins: Float32Array.from(bins) });

/**
 * A decoded feed frame of these channels.
 *
 * @param {ReturnType<typeof channel>[]} channels
 */
const frame = (channels) => ({ channels, ms: 21.333 });

/** Two loud frames of two channels of two bins, the fold before the one under test. */
const loud = () => [
  frame([channel(LOUD_PEAK, LOUD_RMS, [LOUD_BIN, LOUD_BIN]), channel(LOUD_PEAK, LOUD_RMS, [LOUD_BIN, LOUD_BIN])]),
  frame([channel(LOUD_PEAK, LOUD_RMS, [LOUD_BIN, LOUD_BIN]), channel(LOUD_PEAK, LOUD_RMS, [LOUD_BIN, LOUD_BIN])]),
];

/** One quiet frame of the same two channels of two bins. */
const quiet = () => [
  frame([
    channel(QUIET_PEAK, QUIET_RMS, [QUIET_BIN, QUIET_BIN]),
    channel(QUIET_PEAK, QUIET_RMS, [QUIET_BIN, QUIET_BIN]),
  ]),
];

/** The scene a quiet fold returns when handed the scene a loud fold returned. */
const refold = () => foldFrames(quiet(), foldFrames(loud()));

// ── The same scene, refilled ─────────────────────────────────────────────

test("test_a_fold_handed_the_scene_before_it_returns_that_same_scene", () => {
  const before = foldFrames(loud());
  assert.equal(foldFrames(quiet(), before), before);
});

test("test_a_refilled_scene_keeps_no_peak_of_the_fold_before_it", () => {
  assert.equal(refold().channels[0].peak, QUIET_PEAK);
});

test("test_a_refilled_scene_keeps_no_rms_power_of_the_fold_before_it", () => {
  assert.ok(...near(refold().channels[1].rms, QUIET_RMS, DB_EPS));
});

test("test_a_refilled_scene_keeps_no_bin_power_of_the_fold_before_it", () => {
  assert.ok(...nearEach(refold().channels[0].bins, [QUIET_BIN, QUIET_BIN], DB_EPS));
});

// ── A fresh scene when the frames change shape ───────────────────────────

test("test_a_fold_of_more_channels_than_the_scene_handed_in_reads_the_added_channel", () => {
  const one = foldFrames([frame([channel(LOUD_PEAK, LOUD_RMS, [LOUD_BIN])])]);
  const two = [frame([channel(LOUD_PEAK, LOUD_RMS, [LOUD_BIN]), channel(LATER_PEAK, LOUD_RMS, [LOUD_BIN])])];
  assert.equal(foldFrames(two, one).channels[1]?.peak, LATER_PEAK);
});

test("test_a_fold_of_more_bins_than_the_scene_handed_in_reads_every_bin", () => {
  const narrow = foldFrames([frame([channel(LOUD_PEAK, LOUD_RMS, [LOUD_BIN])])]);
  const wide = [frame([channel(LOUD_PEAK, LOUD_RMS, LATER_BINS)])];
  assert.ok(...nearEach(foldFrames(wide, narrow).channels[0].bins, LATER_BINS, DB_EPS));
});
