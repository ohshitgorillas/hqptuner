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
const H2 = designLowpass({ rate: 176400, taps: 353, cutoffHz: 21400, widthHz: 2700 });

// 4. a wider pulse excites less ringing after its centre, by at least the
// stated margin. The sub-sample case (0.5 vs 1.8) holds only when the ring is
// referenced to the pulse's own output peak, not the input peak.
test("test_a_wider_pulse_rings_less_after_its_centre", () => {
  const cases = [
    { name: "H 8 vs 2", taps: H, wide: 8, narrow: 2, marginDb: 10 },
    { name: "H2 1.8 vs 0.5", taps: H2, wide: 1.8, narrow: 0.5, marginDb: 0 },
  ];
  const results = cases.map((c) => {
    const wideDb = ringing(c.taps, gaussianPulse(c.wide)).afterDb;
    const narrowDb = ringing(c.taps, gaussianPulse(c.narrow)).afterDb;
    return { name: c.name, wideDb, narrowDb, ok: wideDb <= narrowDb - c.marginDb };
  });
  assert.deepEqual(
    results,
    results.map((r) => ({ ...r, ok: true })),
  );
});

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
// pulse's own span counts: a short filter on a few-sample pulse reads above
// the floor. A main lobe bounded by zero crossings alone would swallow the
// whole 39-tap response and report the -200 dB floor on the second case.
test("test_ringing_after_counts_smear_inside_the_pulses_own_span", () => {
  const cases = [
    { name: "19 taps at 176400, sigma 3.5", rate: 176400, taps: 19, cutoffHz: 21400, widthHz: 2700, sigma: 3.5, floorDb: -40 },
    { name: "39 taps at 384000, sigma 3.8", rate: 384000, taps: 39, cutoffHz: 46600, widthHz: 5900, sigma: 3.8, floorDb: -60 },
  ];
  const results = cases.map((c) => {
    const short = designLowpass({ rate: c.rate, taps: c.taps, cutoffHz: c.cutoffHz, widthHz: c.widthHz });
    const afterDb = ringing(short, gaussianPulse(c.sigma)).afterDb;
    return { name: c.name, afterDb, ok: afterDb > c.floorDb };
  });
  assert.deepEqual(
    results,
    results.map((r) => ({ ...r, ok: true })),
  );
});
