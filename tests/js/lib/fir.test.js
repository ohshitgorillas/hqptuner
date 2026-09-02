// Behavioral suite for lib/dsp/fir.js — the Kaiser-windowed sinc designer,
// minimum-phase transform and pulse-ringing measurement behind the filter
// primer. Written blind from the spec block, before the module existed.
//
// Every assertion is on what a filter DOES — a dB figure at a frequency, a
// ringing level relative to a pulse peak, a window sample — never on how the
// algebra is organised. Reference numbers are textbook (Kaiser's published
// window and attenuation relations), not read out of hqptuner/.

import test from "node:test";
import assert from "node:assert/strict";

import {
  kaiserWindow,
  kaiserAttenuation,
  designLowpass,
  minimumPhase,
  magnitudeDb,
  gaussianPulse,
  ringing,
  sourceSpectrumDb,
  foldSpectrumDb,
} from "../../../hqptuner/static/lib/dsp/fir.js";

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

// 3. the fake-hires flag removes the content above the source's real band.
test("test_fake_hires_source_has_no_content_at_thirty_kilohertz", () => {
  const flags = { spurs: false, risingNoise: false };
  const fake = sourceSpectrumDb(96000, [30000], { ...flags, fakeHires: true })[0];
  const real = sourceSpectrumDb(96000, [30000], { ...flags, fakeHires: false })[0];
  assert.ok(...atMost(fake, real - 60));
});

// 4. a wider pulse excites less ringing after its centre.
test("test_a_wider_pulse_rings_less_after_its_centre", () => {
  const wide = ringing(H, gaussianPulse(8)).afterDb;
  const narrow = ringing(H, P).afterDb;
  assert.ok(...atMost(wide, narrow - 10));
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

// 7. the fold keeps what survives the filter above output Nyquist: a tone at
// 60 kHz on a 192k stream resampled to 96k lands at 36 kHz, at its own level.
test("test_fold_places_a_tone_above_output_nyquist_at_its_alias", () => {
  const freqsHz = range(0, 192000, 100);
  const levelsDb = new Float64Array(freqsHz.length).fill(-120);
  levelsDb[freqsHz.indexOf(60000)] = -20;
  const folded = foldSpectrumDb(levelsDb, freqsHz, 192000, 96000);
  assert.ok(...near(folded[freqsHz.indexOf(36000)], -20, 0.5));
});
