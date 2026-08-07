// Behavioral suite for lib/binaural/compile.js and lib/binaural/recognize.js — the
// structural crossfeed compiler and its recognizer. Written BEFORE the complexity refactor of recognizeRows (33).
//
// The load-bearing property is compile -> recognize: rows built from parameters
// P must be recognized back as P. It cannot be satisfied by anything except
// correct behavior, and it is immune to however the recognizer is restructured.
//
// Measured facts this suite encodes (probe, 2026-07-23) — a suite written from
// the signatures alone gets all three wrong:
//   * Snapped floats carry binary residue: lambda 0.7 -> 0.7000000000000001,
//     headRadius 0.0875 -> 0.08750000000000001. Never assert with ===.
//   * The snap grids are ADMISSION requirements, not output rounding. The
//     recognizer re-derives all 16 gains from the snapped controls and rejects
//     at 1e-6, which is far tighter than the snap half-steps — so an off-grid
//     lambda/angle/preampDb is REFUSED, not rounded. headRadius is the
//     exception: it never enters the gain coefficients.
//   * angle 0 emits no delay stage at all, so it compiles but never recognizes.

import test from "node:test";
import assert from "node:assert/strict";

import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { recognizeRows } from "../../../hqptuner/static/lib/binaural/recognize.js";
import { PRESETS } from "../../../hqptuner/static/lib/binaural-setup.js";

/**
 * @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../../../hqptuner/static/lib/binaural/recognize.js").StructuralRecognition} StructuralRecognition
 * @typedef {NonNullable<Parameters<typeof compileRows>[0]>} BinauralParams
 */

// [ok, message] for spreading into ONE assert.ok — see matrixspec.test.js.
/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} [tol]
 * @returns {[boolean, string]}
 */
const near = (actual, expected, tol = 1e-9) => [
  Math.abs(actual - expected) <= tol,
  `expected ${expected} ± ${tol}, got ${actual}`,
];

/**
 * @param {BinauralParams} [params]
 * @returns {StructuralRecognition | null}
 */
const rt = (params) => recognizeRows(compileRows(params));

// The recognition of a block these cases build is read straight through; a
// block that declines is asserted on as null through `rt` instead.
/**
 * @param {BinauralParams} [params]
 * @returns {StructuralRecognition}
 */
const got = (params) => /** @type {StructuralRecognition} */ (rt(params));

// Rows a hand edit can leave behind: the malformed-row cases feed the
// recognizer shapes its declared input does not admit, which is the point.
/**
 * @param {unknown} rows
 * @returns {PipelineRow[]}
 */
const asRows = (rows) => /** @type {PipelineRow[]} */ (rows);

// PRESETS carry no `name`, so every preset names its test by its JSON.
/**
 * @param {(typeof PRESETS)[number]} preset
 * @returns {string}
 */
const presetName = (preset) => preset.label;

// --- shape ------------------------------------------------------------------

test("test_a_compiled_block_is_sixteen_rows", () => {
  assert.equal(compileRows().length, 16);
});

test("test_a_default_block_is_recognized", () => {
  assert.notEqual(rt({}), null);
});

test("test_every_compiled_row_carries_a_linear_gain", () => {
  assert.ok(compileRows().every((r) => r.gainunit === "Lin"));
});

// --- round trip of each control ---------------------------------------------

for (const angle of [0.5, 15, 22, 30, 45, 59.5]) {
  test(`test_speaker_angle_round_trips: ${angle}`, () => {
    assert.ok(...near(got({ angle }).angle, angle, 1e-9));
  });
}

for (const lambda of [0, 0.25, 0.5, 0.7, 1]) {
  test(`test_centre_character_round_trips: ${lambda}`, () => {
    assert.ok(...near(got({ lambda }).lambda, lambda, 1e-9));
  });
}

for (const headRadius of [0.075, 0.0875, 0.095, 0.08753]) {
  test(`test_head_radius_round_trips: ${headRadius}`, () => {
    // recovered through a 1-dp corner frequency, so ~1e-5 m of slack
    assert.ok(...near(got({ headRadius }).headRadius, headRadius, 1e-5));
  });
}

test("test_a_scalar_preamp_round_trips_to_both_ears", () => {
  assert.ok(...near(got({ preampDb: -3.5 }).preampDb.left, -3.5, 1e-9));
});

test("test_an_asymmetric_preamp_is_carried_per_ear", () => {
  assert.ok(...near(got({ preampDb: { left: -1.25, right: -2.5 } }).preampDb.right, -2.5, 1e-9));
});

test("test_a_shared_eq_chain_round_trips_byte_identical", () => {
  const eq = "iir:type=peak;f=1000;q=1;g=-3";
  assert.equal(got({ eqProcess: eq }).eqProcess.left, eq);
});

test("test_an_asymmetric_eq_is_carried_per_ear", () => {
  const eq = { left: "iir:type=peak;f=1000;q=1;g=-3", right: "iir:type=peak;f=2000;q=1;g=-6" };
  assert.equal(got({ eqProcess: eq }).eqProcess.right, eq.right);
});

test("test_a_scalar_eq_is_reported_per_ear", () => {
  // shape is deliberately not preserved: scalar in, {left, right} out
  const eq = "iir:type=peak;f=1000;q=1;g=-3";
  assert.equal(got({ eqProcess: eq }).eqProcess.right, eq);
});

for (const preset of PRESETS) {
  test(`test_preset_round_trips: ${presetName(preset)}`, () => {
    assert.notEqual(rt(preset), null);
  });
}

test("test_any_distinct_channel_pair_is_recognized", () => {
  assert.notEqual(rt({ srcA: 2, srcB: 3 }), null);
});

// --- the snap grids are admission requirements -------------------------------
// On-grid within a hair is accepted and snapped; off-grid is REFUSED outright,
// because the recognizer re-derives all 16 gains from the snapped value.

test("test_a_lambda_a_hair_off_grid_is_accepted", () => {
  assert.ok(...near(got({ lambda: 0.700001 }).lambda, 0.7, 1e-9));
});

test("test_a_lambda_well_off_grid_is_refused", () => {
  assert.equal(rt({ lambda: 0.12345 }), null);
});

test("test_an_angle_a_hair_off_grid_is_accepted", () => {
  assert.ok(...near(got({ angle: 30.0001 }).angle, 30, 1e-9));
});

test("test_an_angle_well_off_grid_is_refused", () => {
  assert.equal(rt({ angle: 33.333 }), null);
});

test("test_a_preamp_well_off_grid_is_refused", () => {
  assert.equal(rt({ preampDb: -3.14159 }), null);
});

test("test_an_off_grid_head_radius_is_accepted_and_snapped", () => {
  // head radius never enters the gain coefficients, so it is the one control
  // the 1e-6 gain re-check does not police
  assert.ok(...near(got({ headRadius: 0.087534 }).headRadius, 0.08753, 1e-9));
});

// --- domain limits ----------------------------------------------------------

test("test_a_zero_speaker_angle_is_not_recognized", () => {
  // itd is 0, so no delay stage is emitted and the block has no structure
  assert.equal(rt({ angle: 0 }), null);
});

test("test_a_negative_speaker_angle_is_not_recognized", () => {
  assert.equal(rt({ angle: -30 }), null);
});

test("test_a_speaker_angle_past_the_model_limit_is_not_recognized", () => {
  // beyond ~60 deg the far-ear path folds back and the two independent angle
  // recoveries disagree
  assert.equal(rt({ angle: 75 }), null);
});

test("test_a_negative_centre_character_is_not_recognized", () => {
  assert.equal(rt({ lambda: -1 }), null);
});

test("test_a_deep_preamp_still_round_trips", () => {
  assert.ok(...near(got({ preampDb: -120 }).preampDb.left, -120, 1e-3));
});

test("test_a_preamp_below_the_gain_resolution_is_not_recognized", () => {
  // every 9-decimal gain quantizes to zero, leaving nothing to recover
  assert.equal(rt({ preampDb: -300 }), null);
});

// --- structural rejection ---------------------------------------------------

test("test_a_block_feeding_both_ears_from_one_source_is_not_recognized", () => {
  assert.equal(rt({ srcA: 0, srcB: 0 }), null);
});

test("test_a_short_block_is_not_recognized", () => {
  assert.equal(recognizeRows(compileRows().slice(0, 15)), null);
});

test("test_an_empty_row_set_is_not_recognized", () => {
  assert.equal(recognizeRows([]), null);
});

test("test_a_negative_offset_is_not_recognized", () => {
  assert.equal(recognizeRows(compileRows(), -16), null);
});

test("test_a_block_at_a_later_offset_is_recognized", () => {
  const padded = [...compileRows({ angle: 45 }), ...compileRows({ angle: 22 })];
  const found = /** @type {StructuralRecognition} */ (recognizeRows(padded, 16));
  assert.ok(...near(found.angle, 22, 1e-9));
});

test("test_a_row_with_a_decibel_gain_unit_is_not_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 9 ? { ...r, gainunit: "dB" } : r));
  assert.equal(recognizeRows(rows), null);
});

test("test_a_perturbed_gain_is_not_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 12 ? { ...r, gain: String(Number(r.gain) + 1e-5) } : r));
  assert.equal(recognizeRows(rows), null);
});

test("test_a_gain_perturbed_below_tolerance_is_still_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 12 ? { ...r, gain: String(Number(r.gain) + 5e-7) } : r));
  assert.notEqual(recognizeRows(rows), null);
});

test("test_reordered_rows_are_not_recognized", () => {
  const rows = compileRows();
  const swapped = [rows[1], rows[0], ...rows.slice(2)];
  assert.equal(recognizeRows(swapped), null);
});

test("test_an_edited_source_channel_is_not_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 2 ? { ...r, source: "7" } : r));
  assert.equal(recognizeRows(rows), null);
});

test("test_an_edited_mixdown_is_not_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 5 ? { ...r, mixdown: "7" } : r));
  assert.equal(recognizeRows(rows), null);
});

test("test_a_mismatched_shadow_corner_is_not_recognized", () => {
  const rows = compileRows();
  const bad = rows.map((r, i) => (i === 1 ? { ...r, process: r.process.replace(/f=[\d.]+/, "f=1200.0") } : r));
  assert.equal(recognizeRows(bad), null);
});

test("test_a_mismatched_interaural_delay_is_not_recognized", () => {
  const rows = compileRows();
  const bad = rows.map((r, i) => (i === 3 ? { ...r, process: r.process.replace(/t=[\d.]+/, "t=0.000999999") } : r));
  assert.equal(recognizeRows(bad), null);
});

test("test_ears_compiled_with_different_centre_character_are_not_recognized", () => {
  const a = compileRows({ lambda: 0.7 });
  const b = compileRows({ lambda: 0.5 });
  assert.equal(recognizeRows([...a.slice(0, 8), ...b.slice(8)]), null);
});

// --- EQ chains the block cannot carry ----------------------------------------
// The recognizer splits each chain as [lp1?][delay?][eq...]. An EQ whose FIRST
// stage is itself an lp1 or a delay is eaten as the block's own structure.

test("test_an_eq_beginning_with_a_first_order_lowpass_is_not_recognized", () => {
  assert.equal(rt({ eqProcess: "iir:type=lp1;f=50" }), null);
});

test("test_an_eq_beginning_with_a_delay_is_not_recognized", () => {
  assert.equal(rt({ eqProcess: "delay:t=0.002" }), null);
});

test("test_an_eq_with_a_first_order_lowpass_later_in_the_chain_is_recognized", () => {
  assert.notEqual(rt({ eqProcess: "iir:type=peak;f=1000;q=1;g=-3,iir:type=lp1;f=50" }), null);
});

// --- malformed rows decline rather than throw --------------------------------
// Rows reaching the recognizer are whatever was last hand-edited. Declining
// drops the badge; throwing takes down the render path the recognizer runs in.

test("test_a_row_with_a_non_string_process_is_not_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 3 ? { ...r, process: 42 } : r));
  assert.equal(recognizeRows(asRows(rows)), null);
});

test("test_a_null_row_is_not_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 5 ? null : r));
  assert.equal(recognizeRows(asRows(rows)), null);
});

test("test_a_missing_row_is_not_recognized", () => {
  const rows = compileRows().map((r, i) => (i === 0 ? undefined : r));
  assert.equal(recognizeRows(asRows(rows)), null);
});

test("test_a_row_whose_process_is_absent_is_still_legal", () => {
  // a bare flat row carries no chain; that is not malformed
  const rows = compileRows().map((r) => (r.process === "" ? { ...r, process: null } : r));
  assert.notEqual(recognizeRows(asRows(rows)), null);
});

// --- defaults ---------------------------------------------------------------

test("test_the_default_speaker_angle_is_recovered_from_a_default_block", () => {
  assert.ok(...near(got({}).angle, SPEAKER_ANGLE, 1e-9));
});

test("test_the_default_head_radius_is_recovered_from_a_default_block", () => {
  assert.ok(...near(got({}).headRadius, HEAD_RADIUS, 1e-5));
});
