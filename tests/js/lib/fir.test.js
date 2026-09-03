// Behavioral suite for lib/dsp/fir.js — the Kaiser-windowed sinc designer and
// minimum-phase transform behind the filter primer. Written blind from the
// spec block, before the module existed.
//
// Every assertion is on what a filter DOES — a dB figure at a frequency, a
// ringing level relative to a pulse peak, a window sample — never on how the
// algebra is organised. Reference numbers are textbook (Kaiser's published
// window and attenuation relations), not read out of hqptuner/.

import test from "node:test";
import assert from "node:assert/strict";

import { kaiserWindow, kaiserAttenuation, designLowpass, minimumPhase } from "../../../hqptuner/static/lib/dsp/fir.js";
import { gaussianPulse, ringing } from "../../../hqptuner/static/lib/dsp/pulse.js";
import { magnitudeDb, groupDelaySamples } from "../../../hqptuner/static/lib/dsp/spectrum.js";

// [ok, message] for spreading into ONE assert.ok — see dsp.test.js.
/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol
 * @returns {[boolean, string]}
 */
const near = (actual, expected, tol) => [
  Math.abs(actual - expected) <= tol,
  `expected ${expected} ± ${tol}, got ${actual}`,
];
/**
 * @param {number} actual
 * @param {number} ceiling
 * @returns {[boolean, string]}
 */
const atMost = (actual, ceiling) => [actual <= ceiling, `expected <= ${ceiling}, got ${actual}`];

/**
 * @param {number} lo
 * @param {number} hi
 * @param {number} step
 * @returns {number[]}
 */
const range = (lo, hi, step) => Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

const H = designLowpass({ rate: 88200, taps: 401, cutoffHz: 22050, widthHz: 4000 });
const P = gaussianPulse(2);

// 1. minimum phase moves the ringing out of the pre-echo.
test("test_minimum_phase_taps_ring_far_less_before_the_pulse_than_linear_phase", () => {
  const linear = ringing(H, P).beforeDb;
  const minimum = ringing(minimumPhase(H), P).beforeDb;
  assert.ok(...atMost(minimum, linear - 20));
});

// 2. more taps buy a deeper stopband at the same transition width.
test("test_ten_times_the_taps_deepens_the_stopband_by_at_least_twenty_db", () => {
  const stopband = range(52000, 96000, 1000);
  const worst = (/** @type {number} */ taps) =>
    Math.max(...magnitudeDb(designLowpass({ rate: 192000, taps, cutoffHz: 48000, widthHz: 4000 }), 192000, stopband));
  assert.ok(...atMost(worst(2001), worst(201) - 20));
});

// 5. the Kaiser window itself, against published values for beta 4.
test("test_kaiser_window_matches_the_published_values_for_beta_four", () => {
  const expected = [
    0.08848053, 0.32578323, 0.63343178, 0.89640418, 1.0, 0.89640418, 0.63343178, 0.32578323, 0.08848053,
  ];
  const actual = Array.from(kaiserWindow(9, 4.0));
  const worst = Math.max(...expected.map((e, i) => Math.abs((actual[i] ?? NaN) - e)));
  assert.ok(...atMost(worst, 1e-6));
});

// 6. the Kaiser attenuation relation with the width taken in hertz.
test("test_kaiser_attenuation_follows_the_published_relation_in_hertz", () => {
  assert.ok(...near(kaiserAttenuation(211, 826.875, 44100), 64.48, 0.01));
});

// Group delay of a minimum-phase filter rises towards the corner: the delay in
// samples at 22.05 kHz exceeds the delay at 1 kHz by more than 50 samples.
test("test_minimum_phase_group_delay_rises_towards_the_corner", () => {
  const h = minimumPhase(designLowpass({ rate: 88200, taps: 401, cutoffHz: 22050, widthHz: 4000 }));
  const [low, corner] = groupDelaySamples(h, 88200, [1000, 22050]);
  assert.ok(corner - low > 50, `expected 22.05 kHz to exceed 1 kHz by more than 50 samples, got ${corner - low}`);
});
