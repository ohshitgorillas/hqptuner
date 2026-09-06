// Behavioral suite for lib/dsp/spectrum.js — the frequency-domain readings
// behind the filter primer: the source wash and the alias fold. Written blind
// from the spec block, before the module existed.
//
// Every assertion is on what a reading SAYS — a dB figure at a frequency —
// never on how the algebra is organised.

import test from "node:test";
import assert from "node:assert/strict";

import { sourceSpectrumDb, foldSpectrumDb, analogStageDb } from "../../../hqptuner/static/lib/dsp/spectrum.js";

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
 * @param {number[]} actual
 * @param {number[]} expected
 * @param {number} tol
 * @returns {[boolean, string]}
 */
const nearAll = (actual, expected, tol) => [
  actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) <= tol),
  `expected ${expected.join(", ")} ± ${tol}, got ${actual.join(", ")}`,
];

/**
 * @param {number} lo
 * @param {number} hi
 * @param {number} step
 * @returns {number[]}
 */
const range = (lo, hi, step) => Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

// 3. the fake-hires flag removes the content above the source's real band.
test("test_fake_hires_source_has_no_content_at_thirty_kilohertz", () => {
  const flags = { spurs: false, risingNoise: false };
  const fake = sourceSpectrumDb(96000, [30000], { ...flags, fakeHires: true })[0];
  const real = sourceSpectrumDb(96000, [30000], { ...flags, fakeHires: false })[0];
  assert.ok(...atMost(fake, real - 60));
});

// 1. the analog reconstruction stage is a zero-order hold at the OUTPUT rate on
// top of an analog low-pass, so it reads lower the lower that rate is: at
// 20 kHz an 88.2 kHz output sits 0.70 dB under a 352.8 kHz one, and at 30 kHz
// 1.62 dB under. A stage that is the low-pass alone depends on frequency and
// not on the output rate, so it gives 0.00 dB of difference at both.
test("test_analog_stage_reads_lower_at_a_lower_output_rate", () => {
  const gaps = [20000, 30000].map((f) => analogStageDb([f], 352800)[0] - analogStageDb([f], 88200)[0]);
  assert.ok(...nearAll(gaps, [0.7, 1.62], 0.03));
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
