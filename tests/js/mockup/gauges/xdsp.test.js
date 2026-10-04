// Behavioral suite for the mockup's response maths (mockup/scripts/lib/xdsp.js): the Loudness curve, the complex
// response of one DSP pipeline, and a pipeline gain as a linear factor.
//
// Every expected number is a row the test writes, taken from the textbook identities of the RBJ cookbook and the
// bilinear first-order sections: a shelf reaches its full gain on its own side and none on the other, and half of it
// in dB at its corner; a peak reaches its full gain at its centre; a low-pass passes its Q at the corner; a band-pass
// peaks at unity; a notch nulls; an all-pass is flat; a bilinear first order is 3 dB down at its corner. Levels are
// written as the linear factors they stand for: 6 dB is 1.9952623149688795, −6 dB is 0.5011872336272722, 12 dB is
// 3.9810717055349722, −12 dB is 0.251188643150958 and 1/√2 is 0.7071067811865476.
//
// Run: node --test tests/js/mockup/xdsp.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { gainLin, loudnessDb, pipeH } from "../../../../mockup/scripts/lib/xdsp.js";
import { near } from "../../support/near.js";

//: Tolerance for responses the float arithmetic may round in the last places.
const EPS = 1e-9;
//: The rate the Loudness curve and every pipeline row here run at.
const FS = 48000;
const NYQUIST = FS / 2;

/** @typedef {{ type: string, freq: number, steep: number, level: number }} Band */
/** @typedef {{ name: string, low: Band, high: Band, amount: number, f: number, db: number }} LoudnessRow */
/** @typedef {{ name: string, stages: object[], f: number, unit?: string, gain?: number, mag: number }} PipeRow */

//: A band at 0 dB: flat at every frequency, whatever its type.
const FLAT_LOW = { type: "lshelf", freq: 80, steep: 0.5, level: 0 };
const FLAT_HIGH = { type: "hshelf", freq: 5000, steep: 1, level: 0 };

/** @type {LoudnessRow[]} */
const LOUDNESS = [
  {
    name: "a_bass_shelf_reaches_its_full_level_at_dc",
    low: { type: "lshelf", freq: 80, steep: 0.5, level: 20 },
    high: FLAT_HIGH,
    amount: 1,
    f: 0,
    db: 20,
  },
  {
    name: "half_the_amount_gives_half_the_bass_level_at_dc",
    low: { type: "lshelf", freq: 80, steep: 0.5, level: 20 },
    high: FLAT_HIGH,
    amount: 0.5,
    f: 0,
    db: 10,
  },
  {
    name: "a_bass_shelf_gives_half_its_level_at_its_corner",
    low: { type: "lshelf", freq: 80, steep: 0.5, level: 20 },
    high: FLAT_HIGH,
    amount: 1,
    f: 80,
    db: 10,
  },
  {
    name: "a_bass_shelf_is_flat_at_nyquist",
    low: { type: "lshelf", freq: 80, steep: 0.5, level: 20 },
    high: FLAT_HIGH,
    amount: 1,
    f: NYQUIST,
    db: 0,
  },
  {
    name: "a_treble_shelf_reaches_its_full_level_at_nyquist",
    low: FLAT_LOW,
    high: { type: "hshelf", freq: 5000, steep: 1, level: 10 },
    amount: 1,
    f: NYQUIST,
    db: 10,
  },
  {
    name: "a_treble_shelf_is_flat_at_dc",
    low: FLAT_LOW,
    high: { type: "hshelf", freq: 5000, steep: 1, level: 10 },
    amount: 1,
    f: 0,
    db: 0,
  },
  {
    name: "a_bandwidth_peak_reaches_its_level_at_its_centre",
    low: { type: "peak", freq: 1000, steep: 1, level: 6 },
    high: FLAT_HIGH,
    amount: 1,
    f: 1000,
    db: 6,
  },
  {
    name: "a_q_peak_reaches_its_level_at_its_centre",
    low: FLAT_LOW,
    high: { type: "peakq", freq: 2000, steep: 2, level: -6 },
    amount: 1,
    f: 2000,
    db: -6,
  },
  {
    name: "both_bands_add_at_a_shared_centre",
    low: { type: "peak", freq: 1000, steep: 1, level: 6 },
    high: { type: "peakq", freq: 1000, steep: 0.7, level: 3 },
    amount: 1,
    f: 1000,
    db: 9,
  },
];

for (const row of LOUDNESS) {
  test(`test_loudness_${row.name}`, () => {
    assert.ok(...near(loudnessDb({ low: row.low, high: row.high }, row.f, row.amount), row.db, EPS));
  });
}

/** @type {PipeRow[]} */
const PIPES = [
  { name: "an_empty_chain_at_20_db_is_a_factor_of_ten", stages: [], f: 1000, unit: "dB", gain: 20, mag: 10 },
  { name: "a_first_order_lowpass_passes_dc", stages: [{ kind: "iir", type: "lp1", f: 1000 }], f: 0, mag: 1 },
  {
    name: "a_first_order_lowpass_is_3_db_down_at_its_corner",
    stages: [{ kind: "iir", type: "lp1", f: 1000 }],
    f: 1000,
    mag: 0.7071067811865476,
  },
  {
    name: "a_stage_without_a_frequency_takes_its_corner_at_1_khz",
    stages: [{ kind: "iir", type: "lp1" }],
    f: 1000,
    mag: 0.7071067811865476,
  },
  {
    name: "two_first_order_lowpasses_multiply_at_their_corner",
    stages: [
      { kind: "iir", type: "lp1", f: 1000 },
      { kind: "iir", type: "lp1", f: 1000 },
    ],
    f: 1000,
    mag: 0.5,
  },
  {
    name: "a_first_order_highpass_passes_nyquist",
    stages: [{ kind: "iir", type: "hp1", f: 1000 }],
    f: NYQUIST,
    mag: 1,
  },
  { name: "a_first_order_highpass_blocks_dc", stages: [{ kind: "iir", type: "hp1", f: 1000 }], f: 0, mag: 0 },
  {
    name: "a_lowpass_passes_its_q_at_its_corner",
    stages: [{ kind: "iir", type: "lp", f: 2000, q: 2 }],
    f: 2000,
    mag: 2,
  },
  { name: "a_lowpass_blocks_nyquist", stages: [{ kind: "iir", type: "lp", f: 2000, q: 2 }], f: NYQUIST, mag: 0 },
  {
    name: "a_highpass_passes_its_q_at_its_corner",
    stages: [{ kind: "iir", type: "hp", f: 500, q: 0.5 }],
    f: 500,
    mag: 0.5,
  },
  { name: "a_bandpass_peaks_at_unity", stages: [{ kind: "iir", type: "bp", f: 3000, q: 4 }], f: 3000, mag: 1 },
  { name: "a_notch_nulls_its_centre", stages: [{ kind: "iir", type: "notch", f: 3000, q: 4 }], f: 3000, mag: 0 },
  { name: "an_allpass_is_flat_off_centre", stages: [{ kind: "iir", type: "ap", f: 1000, q: 1 }], f: 3000, mag: 1 },
  {
    name: "a_q_peak_reaches_its_gain_at_its_centre",
    stages: [{ kind: "iir", type: "peak", f: 1000, q: 1, g: 6 }],
    f: 1000,
    mag: 1.9952623149688795,
  },
  {
    name: "a_bandwidth_peak_reaches_its_gain_at_its_centre",
    stages: [{ kind: "iir", type: "peak", f: 1000, bw: 1, g: -6 }],
    f: 1000,
    mag: 0.5011872336272722,
  },
  {
    name: "a_slope_low_shelf_reaches_its_gain_at_dc",
    stages: [{ kind: "iir", type: "lshelf", f: 200, s: 1, g: 12 }],
    f: 0,
    mag: 3.9810717055349722,
  },
  {
    name: "a_q_high_shelf_reaches_its_gain_at_nyquist",
    stages: [{ kind: "iir", type: "hshelf", f: 8000, q: 0.707, g: -12 }],
    f: NYQUIST,
    mag: 0.251188643150958,
  },
  {
    name: "a_raw_biquad_applies_its_coefficients",
    stages: [{ kind: "iir", type: "biquad", b0: 0.5, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 }],
    f: 5000,
    mag: 0.5,
  },
  { name: "an_unmodelled_stage_is_flat", stages: [{ kind: "riaa", subsonic: 1 }], f: 1000, mag: 1 },
];

for (const row of PIPES) {
  test(`test_pipeline_${row.name}`, () => {
    const p = { stages: row.stages, unit: row.unit ?? "dB", gain: row.gain ?? 0 };
    const [re, im] = pipeH(p, row.f, FS);
    assert.ok(...near(Math.hypot(re, im), row.mag, EPS));
  });
}

test("test_pipeline_a_negative_linear_gain_flips_polarity", () => {
  assert.ok(...near(pipeH({ stages: [], unit: "Lin", gain: -1 }, 1000, FS)[0], -1, EPS));
});

test("test_pipeline_a_quarter_period_delay_turns_a_cosine_into_a_negative_sine", () => {
  assert.ok(...near(pipeH({ stages: [{ kind: "delay", t: 0.001 }], unit: "dB", gain: 0 }, 250, FS)[1], -1, EPS));
});

/** @type {{ name: string, p: { unit: string, gain: number | string }, lin: number }[]} */
const GAINS = [
  { name: "20_db_is_a_factor_of_ten", p: { unit: "dB", gain: 20 }, lin: 10 },
  { name: "a_db_gain_given_as_text_converts", p: { unit: "dB", gain: "-20" }, lin: 0.1 },
  { name: "a_linear_gain_passes_through_with_its_sign", p: { unit: "Lin", gain: -0.5 }, lin: -0.5 },
  { name: "a_linear_gain_given_as_text_converts", p: { unit: "Lin", gain: "2" }, lin: 2 },
];

for (const row of GAINS) {
  test(`test_gain_${row.name}`, () => {
    assert.ok(...near(gainLin(row.p), row.lin, EPS));
  });
}
