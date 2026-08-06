// Behavioral suite for lib/dsp/ — the client-side response math behind every
// plot. Written BEFORE the complexity refactor of iirStageCoeffs and wavSamples.
//
// Surface choice (docs/testing.md rule 3): these go through stageResponse /
// chainResponse / registerIr, the functions the plots actually call. Coefficient
// helpers are reached through them, never directly — iirStageCoeffs is flagged
// by knip as an unused export and should become private, and a test that pinned
// it would block that.
//
// Assertions are on what a filter DOES — gain at a frequency — not on its
// coefficients. A refactor may reorganize the algebra freely; a peaking filter
// set to +6 dB must still put +6 dB at its centre.

import test from "node:test";
import assert from "node:assert/strict";

import { stageResponse } from "../../../hqptuner/static/lib/dsp/stages.js";
import { chainResponse } from "../../../hqptuner/static/lib/dsp/chain.js";
import { registerIr } from "../../../hqptuner/static/lib/dsp/impulse.js";

const FS = 48000;

// [ok, message] for spreading into ONE assert.ok — see matrixspec.test.js.
const near = (actual, expected, tol = 0.05) => [
  Math.abs(actual - expected) <= tol,
  `expected ${expected} ± ${tol}, got ${actual}`,
];
const below = (actual, ceiling) => [actual < ceiling, `expected < ${ceiling}, got ${actual}`];

const iir = (args) => ({ kind: "iir", args });
const db = (stage, f) => stageResponse(stage, f, FS).db;
const deg = (stage, f) => stageResponse(stage, f, FS).deg;

// --- peaking ----------------------------------------------------------------

test("test_peaking_filter_applies_its_gain_at_the_centre_frequency", () => {
  assert.ok(...near(db(iir({ type: "peak", f: "1000", q: "1", g: "6" }), 1000), 6));
});

test("test_peaking_filter_is_transparent_far_below_its_centre", () => {
  assert.ok(...near(db(iir({ type: "peak", f: "1000", q: "1", g: "6" }), 20), 0, 0.1));
});

test("test_peaking_filter_with_negative_gain_cuts_at_the_centre", () => {
  assert.ok(...near(db(iir({ type: "peak", f: "1000", q: "1", g: "-6" }), 1000), -6));
});

test("test_a_higher_q_narrows_the_peak", () => {
  const wide = db(iir({ type: "peak", f: "1000", q: "0.5", g: "6" }), 2000);
  const narrow = db(iir({ type: "peak", f: "1000", q: "4", g: "6" }), 2000);
  assert.ok(...below(narrow, wide));
});

// --- shelves ----------------------------------------------------------------

test("test_low_shelf_applies_its_gain_in_the_bass", () => {
  assert.ok(...near(db(iir({ type: "lshelf", f: "1000", q: "0.7071", g: "6" }), 20), 6, 0.2));
});

test("test_low_shelf_is_transparent_in_the_treble", () => {
  assert.ok(...near(db(iir({ type: "lshelf", f: "1000", q: "0.7071", g: "6" }), 20000), 0, 0.2));
});

test("test_high_shelf_applies_its_gain_in_the_treble", () => {
  assert.ok(...near(db(iir({ type: "hshelf", f: "1000", q: "0.7071", g: "6" }), 20000), 6, 0.2));
});

test("test_high_shelf_is_transparent_in_the_bass", () => {
  assert.ok(...near(db(iir({ type: "hshelf", f: "1000", q: "0.7071", g: "6" }), 20), 0, 0.2));
});

// --- second-order pass filters ----------------------------------------------

test("test_lowpass_is_three_db_down_at_its_corner", () => {
  assert.ok(...near(db(iir({ type: "lp", f: "1000", q: "0.7071" }), 1000), -3, 0.15));
});

test("test_lowpass_attenuates_above_its_corner", () => {
  assert.ok(...below(db(iir({ type: "lp", f: "1000", q: "0.7071" }), 8000), -20));
});

test("test_highpass_is_three_db_down_at_its_corner", () => {
  assert.ok(...near(db(iir({ type: "hp", f: "1000", q: "0.7071" }), 1000), -3, 0.15));
});

test("test_highpass_attenuates_below_its_corner", () => {
  assert.ok(...below(db(iir({ type: "hp", f: "1000", q: "0.7071" }), 100), -20));
});

test("test_bandpass_passes_its_centre_frequency", () => {
  assert.ok(...near(db(iir({ type: "bp", f: "1000", q: "1" }), 1000), 0, 0.05));
});

test("test_notch_rejects_its_centre_frequency", () => {
  assert.ok(...below(db(iir({ type: "notch", f: "1000", q: "1" }), 1000), -60));
});

test("test_allpass_has_flat_magnitude", () => {
  assert.ok(...near(db(iir({ type: "ap", f: "1000", q: "1" }), 5000), 0, 0.01));
});

// --- first-order ------------------------------------------------------------

test("test_first_order_lowpass_is_three_db_down_at_its_corner", () => {
  assert.ok(...near(db(iir({ type: "lp1", f: "1000" }), 1000), -3, 0.15));
});

test("test_first_order_highpass_is_three_db_down_at_its_corner", () => {
  assert.ok(...near(db(iir({ type: "hp1", f: "1000" }), 1000), -3, 0.15));
});

// --- raw biquad -------------------------------------------------------------

test("test_raw_biquad_passthrough_coefficients_are_transparent", () => {
  assert.ok(...near(db(iir({ type: "biquad", b0: "1", b1: "0", b2: "0", a0: "1", a1: "0", a2: "0" }), 1000), 0, 0.01));
});

test("test_raw_biquad_coefficients_are_normalized_by_a0", () => {
  // b0=1, a0=2 is a halving gain: -6.02 dB, flat.
  const stage = iir({ type: "biquad", b0: "1", b1: "0", b2: "0", a0: "2", a1: "0", a2: "0" });
  assert.ok(...near(db(stage, 1000), -6.02, 0.02));
});

// --- unplottable stages -----------------------------------------------------

for (const f of ["0", "-100", "24000", "48000", "abc"]) {
  test(`test_iir_with_an_out_of_range_frequency_is_unplottable: ${f}`, () => {
    assert.equal(stageResponse(iir({ type: "peak", f, q: "1", g: "6" }), 1000, FS), null);
  });
}

test("test_iir_with_an_unknown_type_is_unplottable", () => {
  assert.equal(stageResponse(iir({ type: "bandstop", f: "1000", q: "1" }), 1000, FS), null);
});

// --- delay ------------------------------------------------------------------

test("test_delay_does_not_change_magnitude", () => {
  assert.ok(...near(db({ kind: "delay", args: { t: "0.001" } }, 1000), 0, 1e-9));
});

test("test_delay_of_a_quarter_period_is_ninety_degrees_of_phase", () => {
  assert.ok(...near(deg({ kind: "delay", args: { t: String(1 / 4000) } }, 1000), -90, 0.01));
});

test("test_a_delay_in_samples_matches_the_same_delay_in_seconds", () => {
  const inSamples = deg({ kind: "delay", args: { s: "48" } }, 1000);
  const inSeconds = deg({ kind: "delay", args: { t: "0.001" } }, 1000);
  assert.ok(...near(inSamples, inSeconds, 1e-9));
});

test("test_a_delay_in_metres_uses_the_speed_of_sound", () => {
  const inMetres = deg({ kind: "delay", args: { d: "343.956" } }, 100);
  const oneSecond = deg({ kind: "delay", args: { t: "1" } }, 100);
  assert.ok(...near(inMetres, oneSecond, 1e-6));
});

// --- riaa -------------------------------------------------------------------

test("test_riaa_is_normalized_to_unity_at_one_kilohertz", () => {
  assert.ok(...near(db({ kind: "riaa", args: { subsonic: "0" } }, 1000), 0, 1e-9));
});

test("test_riaa_attenuates_the_treble", () => {
  assert.ok(...below(db({ kind: "riaa", args: { subsonic: "0" } }, 10000), -10));
});

test("test_riaa_boosts_the_bass_relative_to_one_kilohertz", () => {
  const bass = db({ kind: "riaa", args: { subsonic: "0" } }, 100);
  assert.ok(...[bass > 10, `expected > 10 dB at 100 Hz, got ${bass}`]);
});

test("test_the_riaa_subsonic_pole_attenuates_the_lowest_bass", () => {
  const on = db({ kind: "riaa", args: { subsonic: "1" } }, 10);
  const off = db({ kind: "riaa", args: { subsonic: "0" } }, 10);
  assert.ok(...below(on, off - 3));
});

// --- convolution / WAV reading ----------------------------------------------

// Minimal RIFF/WAVE writer, first channel only — the shape wavSamples parses.
function wavBuffer({ bits = 16, audioFormat = 1, channels = 1, rate = 48000, samples = [] }) {
  const bytesPer = bits / 8;
  const dataSize = samples.length * bytesPer * channels;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  v.setUint32(0, 0x52494646, false); // "RIFF"
  v.setUint32(4, 36 + dataSize, true);
  v.setUint32(8, 0x57415645, false); // "WAVE"
  v.setUint32(12, 0x666d7420, false); // "fmt "
  v.setUint32(16, 16, true);
  v.setUint16(20, audioFormat, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * bytesPer * channels, true);
  v.setUint16(32, bytesPer * channels, true);
  v.setUint16(34, bits, true);
  v.setUint32(36, 0x64617461, false); // "data"
  v.setUint32(40, dataSize, true);
  samples.forEach((x, i) => writeSample(v, 44 + i * bytesPer * channels, x, { bits, audioFormat }));
  return buf;
}

function writeSample(v, at, x, { bits, audioFormat }) {
  if (audioFormat === 3) return v.setFloat32(at, x, true);
  if (bits === 8) return v.setUint8(at, Math.min(255, Math.round(x * 127) + 128)); // unsigned, per RIFF
  if (bits === 16) return v.setInt16(at, Math.min(32767, Math.round(x * 32768)), true);
  if (bits === 32) return v.setInt32(at, Math.min(2147483647, Math.round(x * 2147483648)), true);
  const raw = Math.min(8388607, Math.round(x * 8388608)) & 0xffffff;
  v.setUint8(at, raw & 0xff);
  v.setUint8(at + 1, (raw >> 8) & 0xff);
  v.setUint8(at + 2, (raw >> 16) & 0xff);
  return undefined;
}

// A unit impulse has a flat unity spectrum, so every format that decodes
// correctly plots as 0 dB — one case per PCM width the reader claims to support.
const IMPULSE = [1, 0, 0, 0, 0, 0, 0, 0];
const FORMATS = [
  ["pcm16", { bits: 16 }],
  ["pcm24", { bits: 24 }],
  ["pcm32", { bits: 32 }],
  ["float32", { bits: 32, audioFormat: 3 }],
];

for (const [name, fmt] of FORMATS) {
  test(`test_a_unit_impulse_plots_flat_at_unity: ${name}`, () => {
    const path = `impulse-${name}.wav`;
    registerIr(path, wavBuffer({ ...fmt, samples: IMPULSE }));
    assert.ok(...near(db({ kind: "conv", file: path }, 1000), 0, 0.01));
  });
}

test("test_a_half_scale_impulse_plots_six_db_down", () => {
  registerIr("half.wav", wavBuffer({ bits: 32, audioFormat: 3, samples: [0.5, 0, 0, 0, 0, 0, 0, 0] }));
  assert.ok(...near(db({ kind: "conv", file: "half.wav" }, 1000), -6.02, 0.02));
});

test("test_an_unregistered_convolution_file_is_unplottable", () => {
  assert.equal(stageResponse({ kind: "conv", file: "never-uploaded.wav" }, 1000, FS), null);
});

test("test_a_buffer_that_is_not_a_wav_file_is_unplottable", () => {
  registerIr("garbage.wav", new ArrayBuffer(64));
  assert.equal(stageResponse({ kind: "conv", file: "garbage.wav" }, 1000, FS), null);
});

test("test_a_wav_with_an_unsupported_bit_depth_is_unplottable", () => {
  registerIr("eight-bit.wav", wavBuffer({ bits: 8, samples: IMPULSE }));
  assert.equal(stageResponse({ kind: "conv", file: "eight-bit.wav" }, 1000, FS), null);
});

// --- chain composition ------------------------------------------------------

test("test_an_empty_chain_is_transparent", () => {
  assert.equal(chainResponse([], 1000, FS).db, 0);
});

test("test_an_empty_chain_is_not_partial", () => {
  assert.equal(chainResponse([], 1000, FS).partial, false);
});

test("test_chained_stage_gains_sum_in_decibels", () => {
  const stages = [iir({ type: "peak", f: "1000", q: "1", g: "6" }), iir({ type: "peak", f: "1000", q: "1", g: "3" })];
  assert.ok(...near(chainResponse(stages, 1000, FS).db, 9, 0.05));
});

test("test_a_chain_containing_an_unplottable_stage_is_marked_partial", () => {
  const stages = [iir({ type: "peak", f: "1000", q: "1", g: "6" }), { kind: "conv", file: "never-uploaded.wav" }];
  assert.equal(chainResponse(stages, 1000, FS).partial, true);
});

test("test_a_partial_chain_still_reports_the_gain_of_its_plottable_stages", () => {
  const stages = [iir({ type: "peak", f: "1000", q: "1", g: "6" }), { kind: "conv", file: "never-uploaded.wav" }];
  assert.ok(...near(chainResponse(stages, 1000, FS).db, 6, 0.05));
});

test("test_an_unknown_stage_kind_is_unplottable", () => {
  assert.equal(stageResponse({ kind: "reverb", args: {} }, 1000, FS), null);
});
