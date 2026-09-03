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
