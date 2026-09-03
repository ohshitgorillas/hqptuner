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

import { gaussianPulse, ringing } from "../../../hqptuner/static/lib/dsp/pulse.js";
import { magnitudeDb } from "../../../hqptuner/static/lib/dsp/spectrum.js";
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

// 2. no oversampling means no filter: the design stops ringing once the
// oversampling is switched off, whether the output is null or the source
// rate itself, whatever rate it was designed at before.
test("test_no_oversampling_after_four_times_leaves_no_ringing_whether_output_is_null_or_the_source_rate", () => {
  const cases = [
    { rate: 44100, fourX: 176400, then: null },
    { rate: 96000, fourX: 384000, then: 96000 },
  ];
  const quiet = cases.map((c) => {
    configure({ rate: c.rate, lengthMs: 2, outputRate: c.fourX });
    outputRate.value = c.then;
    return ringing(design.value.h, gaussianPulse(4)).afterDb < -100;
  });
  assert.deepEqual(quiet, [true, true]);
});

/**
 * Filter magnitude at the given frequencies, read off the design the store holds.
 *
 * @param {number[]} freqsHz
 * @returns {Float64Array}
 */
const designDb = (freqsHz) => magnitudeDb(design.value.h, design.value.designRate, freqsHz);

// Line 1. the transition readout is the width the filter actually has: at Long
// and Slow the response is still falling a quarter of the readout above the
// cutoff, and is at least 20 dB further down half the readout above it.
test("test_transition_readout_at_long_slow_is_the_width_the_filter_actually_has", () => {
  configure({ rate: 44100, lengthMs: 8, outputRate: 176400, rolloff: 0 });
  const cutoff = design.value.cutoffHz;
  const widthHz = readouts.value.transitionKhz * 1000;
  const [quarter, half] = designDb([cutoff + widthHz / 4, cutoff + widthHz / 2]);
  assert.ok(
    quarter - half >= 20,
    `expected a quarter of the readout above the cutoff (${quarter}) to exceed half above it (${half}) by 20 dB`,
  );
});

// Line 2. Fast roll-off at Long is a real slope, not the attenuation cap: the
// stop band just above Nyquist, 22.5..26 kHz, peaks between -110 and -60 dB.
test("test_fast_rolloff_at_long_leaves_the_band_just_above_nyquist_between_minus_110_and_minus_60_db", () => {
  const band = Array.from({ length: 36 }, (_, i) => 22500 + i * 100);
  configure({ rate: 44100, lengthMs: 8, outputRate: 176400, rolloff: 1 });
  const peak = Math.max(...designDb(band));
  assert.ok(peak >= -110 && peak <= -60, `expected 22.5..26 kHz peak between -110 and -60 dB, got ${peak}`);
});

/**
 * Samples after the peak tap over which the taps stay above -60 dB of the peak.
 *
 * @param {Float64Array} h
 * @returns {number}
 */
function tailSamples(h) {
  let peak = 0;
  for (let i = 1; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[peak])) peak = i;
  const floor = Math.abs(h[peak]) * 1e-3;
  let last = peak;
  for (let i = peak; i < h.length; i++) if (Math.abs(h[i]) > floor) last = i;
  return last - peak;
}

// Line 4. a longer filter rings longer: the 8 ms filter's tail above -60 dB is
// more than three times the 2 ms filter's.
test("test_long_filter_tail_above_minus_sixty_db_is_over_three_times_the_medium_filters", () => {
  configure({ rate: 44100, lengthMs: 8, outputRate: 176400, rolloff: 0.5 });
  const long = tailSamples(design.value.h);
  configure({ rate: 44100, lengthMs: 2, outputRate: 176400, rolloff: 0.5 });
  const medium = tailSamples(design.value.h);
  assert.ok(long > 3 * medium, `expected 8 ms tail (${long}) to exceed three times the 2 ms tail (${medium})`);
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
