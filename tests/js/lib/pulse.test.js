// Behavioral suite for lib/dsp/pulse.js — the transient pulse and the
// pulse-ringing measurement behind the filter primer. Written blind from the
// spec block, before the module existed.
//
// Every assertion is on what a filter DOES — a ringing level relative to a
// pulse peak — never on how the algebra is organised.

import test from "node:test";
import assert from "node:assert/strict";

import { designLowpass } from "../../../hqptuner/static/lib/dsp/fir.js";
import { gaussianPulse, ringing } from "../../../hqptuner/static/lib/dsp/pulse.js";

// [ok, message] for spreading into ONE assert.ok — see dsp.test.js.
/**
 * @param {number} actual
 * @param {number} ceiling
 * @returns {[boolean, string]}
 */
const atMost = (actual, ceiling) => [actual <= ceiling, `expected <= ${ceiling}, got ${actual}`];

const H = designLowpass({ rate: 88200, taps: 401, cutoffHz: 22050, widthHz: 4000 });
const P = gaussianPulse(2);

// 4. a wider pulse excites less ringing after its centre.
test("test_a_wider_pulse_rings_less_after_its_centre", () => {
  const wide = ringing(H, gaussianPulse(8)).afterDb;
  const narrow = ringing(H, P).afterDb;
  assert.ok(...atMost(wide, narrow - 10));
});

// [ok, message] for spreading into ONE assert.ok.
/**
 * @param {number} actual
 * @param {number} floor
 * @returns {[boolean, string]}
 */
const above = (actual, floor) => [actual > floor, `expected > ${floor}, got ${actual}`];

/**
 * The largest sample of a pulse other than its centre, in dB below the centre.
 *
 * @param {Float64Array} pulse
 * @returns {number}
 */
function loudestNeighbourDb(pulse) {
  const centre = (pulse.length - 1) / 2;
  let loudest = 0;
  for (let i = 0; i < pulse.length; i++) {
    if (i !== centre) loudest = Math.max(loudest, Math.abs(pulse[i]));
  }
  return 20 * Math.log10(loudest / Math.abs(pulse[centre]));
}

// 1. a pulse narrower than a sample is a single-sample impulse: nothing but
// the centre sample survives above -60 dB.
test("test_a_pulse_narrower_than_a_sample_is_a_single_sample_impulse", () => {
  assert.ok(...atMost(loudestNeighbourDb(gaussianPulse(0.25)), -60));
});

// 2. the ring readout is the output minus the input, so smear inside the
// pulse's own span counts: a short 19-tap filter on a 3.5-sample pulse reads
// well above -40 dB.
test("test_ringing_after_counts_smear_inside_the_pulses_own_span", () => {
  const short = designLowpass({ rate: 176400, taps: 19, cutoffHz: 21400, widthHz: 2700 });
  assert.ok(...above(ringing(short, gaussianPulse(3.5)).afterDb, -40));
});
