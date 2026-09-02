// Behavioral suite for store/primergraph.js — the filter primer's model: the
// filter designed from the sliders, and the spectrum the graph draws from it.
// Written blind from a spec block; no store source was read.
//
// Every assertion is on a number the store hands out — a tap count, a ringing
// level, a dB figure at a frequency — never on a word (docs/testing.md rule 9).
// Frequencies are read by the grid index nearest to them, as the spec directs.
//
// Every test sets every input it depends on and leaves the store as it found it:
// `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/primergraph.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { gaussianPulse, ringing } from "../../../hqptuner/static/lib/dsp/fir.js";
import {
  rate,
  outputRate,
  phase,
  lengthMs,
  rolloff,
  transientUs,
  content,
  design,
  readouts,
  spectrum,
  showMe,
} from "../../../hqptuner/static/store/primergraph.js";

test.afterEach(() => {
  showMe("intro");
});

/**
 * The inputs the spec fixes for every line unless the line says otherwise.
 *
 * @param {{ rate: number, outputRate: number | null, lengthMs: number, rolloff?: number }} c
 */
function configure(c) {
  phase.value = "linear";
  rolloff.value = c.rolloff ?? 0.5;
  transientUs.value = 100;
  content.value = { spurs: false, fakeHires: false, risingNoise: false };
  rate.value = c.rate;
  lengthMs.value = c.lengthMs;
  outputRate.value = c.outputRate;
}

/**
 * The grid index nearest a frequency.
 *
 * @param {number[]} freqsHz
 * @param {number} hz
 * @returns {number}
 */
const nearest = (freqsHz, hz) =>
  freqsHz.reduce((best, f, i) => (Math.abs(f - hz) < Math.abs(freqsHz[best] - hz) ? i : best), 0);

/**
 * @param {Float64Array} levels
 * @param {number[]} freqsHz
 * @param {number} hz
 * @returns {number}
 */
const levelAt = (levels, freqsHz, hz) => levels[nearest(freqsHz, hz)];

// 1. the tap count follows the output rate: 8x oversampling needs four times
// the taps of 2x to fill the same milliseconds.
test("test_tap_count_at_eight_times_is_four_times_the_count_at_two_times", () => {
  configure({ rate: 44100, lengthMs: 2, outputRate: 88200 });
  const twoX = readouts.value.taps;
  configure({ rate: 44100, lengthMs: 2, outputRate: 352800 });
  const eightX = readouts.value.taps;
  assert.ok(
    twoX !== null && eightX !== null && Math.abs(eightX - 4 * twoX) <= 1,
    `expected 4 x ${twoX} within 1, got ${eightX}`,
  );
});

// 2. output rate null means no filter: the design stops ringing once the
// oversampling is switched off, whatever rate it was designed at before.
test("test_no_oversampling_after_four_times_leaves_no_ringing_after_the_pulse", () => {
  configure({ rate: 44100, lengthMs: 2, outputRate: 176400 });
  outputRate.value = null;
  const after = ringing(design.value.h, gaussianPulse(4)).afterDb;
  assert.ok(after < -100, `expected below -100 dB, got ${after}`);
});

// 3. downsampling cuts at the OUTPUT Nyquist: 192k to 96k removes 60 kHz while
// keeping 40 kHz.
test("test_downsampling_filter_cuts_above_output_nyquist", () => {
  configure({ rate: 192000, lengthMs: 8, outputRate: 96000, rolloff: 1 });
  const { freqsHz, filterDb } = spectrum.value;
  const pass = levelAt(filterDb, freqsHz, 40000);
  const stop = levelAt(filterDb, freqsHz, 60000);
  assert.ok(pass - stop > 40, `expected 40 kHz (${pass}) to exceed 60 kHz (${stop}) by more than 40 dB`);
});

// 5. upsampling images repeat at the output rate: 44.1k to 176.4k puts an image
// of the 20 kHz content at 156.4 kHz, and nothing at 100 kHz.
test("test_upsampled_result_has_an_image_at_the_output_rate_minus_the_content", () => {
  configure({ rate: 44100, lengthMs: 2, outputRate: 176400 });
  const { freqsHz, resultDb } = spectrum.value;
  const image = levelAt(resultDb, freqsHz, 156400);
  const gap = levelAt(resultDb, freqsHz, 100000);
  assert.ok(image - gap > 40, `expected 156.4 kHz (${image}) to exceed 100 kHz (${gap}) by more than 40 dB`);
});
