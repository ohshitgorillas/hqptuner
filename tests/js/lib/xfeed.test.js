// Behavioral suite for lib/xfeed.js — the Bauer-crossfeed mid/side compensation
// block and its recognizer. Written BEFORE the complexity refactor of
// msRecognize (20).
//
// Same load-bearing property as binaural.test.js: compile -> recognize. Rows
// built from parameters must come back as those parameters.
//
// Measured facts this suite encodes (probe, 2026-07-23):
//   * sFraction does NOT round-trip exactly. compProcess writes each stage gain
//     at 2 dp, so the recovered sum carries up to 0.01 of absolute error — which
//     divided by the tilt sum EXCEEDS the 0.005 half-step of the 1% snap grid.
//     68 of 150 values are off by a step for the jmeier preset. Assert ±0.01.
//   * preampDb accuracy degrades as 10^(-p/20): ~1e-5 dB near 0, ~0.09 dB at
//     -80, and below about -120 dB the gains quantize to zero and the block
//     stops being recognized at all.
//   * Recognizing with different fc/feed than the block was compiled for is not
//     a rejection — eqProcess and preampDb still come back, sFraction is pinned
//     to 1, and `stale` is the only signal that anything is wrong.
//
// fitComp runs a coordinate descent and is memoized per (fc, feed); the fits are
// computed once here rather than per test.

import test from "node:test";
import assert from "node:assert/strict";

import { msCompile, msRecognize, fitComp, BAUER_PRESETS } from "../../../hqptuner/static/lib/xfeed.js";

const { fc, feed } = BAUER_PRESETS.default;
const FIT = fitComp(fc, feed);
const JM = BAUER_PRESETS.jmeier;
const JM_FIT = fitComp(JM.fc, JM.feed);

const EQ = "iir:type=peak;f=1000;q=1;g=-3";

// [ok, message] for spreading into ONE assert.ok — see matrixspec.test.js.
const near = (actual, expected, tol) => [
  Math.abs(actual - expected) <= tol,
  `expected ${expected} ± ${tol}, got ${actual}`,
];

const block = (eq = "", preamp = 0, s = 1, a = 0, b = 1) => msCompile(eq, preamp, FIT, s, a, b);
const rec = (rows) => msRecognize(rows, 0, fc, feed);

// --- shape ------------------------------------------------------------------

test("test_a_compiled_block_is_eight_rows", () => {
  assert.equal(block().length, 8);
});

test("test_a_compiled_block_is_recognized", () => {
  assert.notEqual(rec(block()), null);
});

test("test_every_compiled_row_carries_a_linear_gain", () => {
  assert.ok(block().every((r) => r.gainunit === "Lin"));
});

// --- round trip -------------------------------------------------------------

test("test_an_eq_chain_round_trips_byte_identical", () => {
  assert.equal(rec(block(EQ)).eqProcess, EQ);
});

test("test_a_block_with_no_eq_is_recognized", () => {
  assert.notEqual(rec(block("")), null);
});

test("test_a_block_with_no_eq_reports_an_empty_chain", () => {
  assert.equal(rec(block("")).eqProcess, "");
});

for (const preamp of [0, -2.5, -12, -40]) {
  test(`test_preamp_round_trips: ${preamp} dB`, () => {
    // error scales as 10^(-p/20) off the 6-dp linear gain; 1e-4 covers >= -40 dB
    assert.ok(...near(rec(block(EQ, preamp)).preampDb, preamp, 1e-4));
  });
}

test("test_a_deep_preamp_degrades_but_still_recovers", () => {
  assert.ok(...near(rec(block(EQ, -80)).preampDb, -80, 0.2));
});

test("test_a_preamp_below_the_gain_resolution_is_not_recognized", () => {
  assert.equal(rec(block(EQ, -140)), null);
});

test("test_a_faithful_round_trip_is_not_stale", () => {
  assert.equal(rec(block(EQ, -2.5, 1)).stale, false);
});

// --- strength (sFraction) ---------------------------------------------------
// The 2-dp stage gains mean recovery is only good to one 1% step. This is the
// single fact most likely to break a naively-written suite.

for (const s of [0.25, 0.5, 0.75, 1, 1.25, 1.5]) {
  test(`test_strength_round_trips_within_one_percent_step: ${s}`, () => {
    assert.ok(...near(rec(block(EQ, 0, s)).sFraction, s, 0.01));
  });
}

test("test_full_strength_round_trips_exactly", () => {
  assert.equal(rec(block(EQ, 0, 1)).sFraction, 1);
});

test("test_strength_recovery_stays_within_one_step_across_the_whole_range", () => {
  // jmeier is the worst preset for this — 68/150 values land off-grid
  const jm = (s) => msRecognize(msCompile("", 0, JM_FIT, s, 0, 1), 0, JM.fc, JM.feed);
  const worst = Array.from({ length: 150 }, (_, i) => (i + 1) / 100)
    .map((s) => Math.abs(jm(s).sFraction - s))
    .reduce((a, b) => Math.max(a, b), 0);
  assert.ok(...near(worst, 0, 0.01 + 1e-9)); // exactly one step, plus float slack
});

// --- recognizing against the wrong crossfeed settings ------------------------

test("test_a_block_built_for_other_settings_is_marked_stale", () => {
  assert.equal(msRecognize(block(EQ, -2.5), 0, JM.fc, JM.feed).stale, true);
});

test("test_a_stale_block_still_returns_its_eq_chain", () => {
  assert.equal(msRecognize(block(EQ, -2.5), 0, JM.fc, JM.feed).eqProcess, EQ);
});

test("test_a_stale_block_pins_its_strength_to_full", () => {
  assert.equal(msRecognize(block(EQ, 0, 0.5), 0, JM.fc, JM.feed).sFraction, 1);
});

test("test_unusable_crossfeed_settings_mark_the_block_stale", () => {
  assert.equal(msRecognize(block(EQ), 0, NaN, NaN).stale, true);
});

// --- structural rejection ---------------------------------------------------

test("test_a_short_block_is_not_recognized", () => {
  assert.equal(rec(block().slice(0, 7)), null);
});

test("test_an_empty_row_set_is_not_recognized", () => {
  assert.equal(rec([]), null);
});

test("test_a_negative_offset_is_not_recognized", () => {
  assert.equal(msRecognize(block(), -8, fc, feed), null);
});

test("test_a_missing_offset_is_not_recognized", () => {
  assert.equal(msRecognize(block(), undefined, fc, feed), null);
});

test("test_a_block_at_a_later_offset_is_recognized", () => {
  const padded = [...block(""), ...block(EQ)];
  assert.equal(msRecognize(padded, 8, fc, feed).eqProcess, EQ);
});

test("test_a_block_feeding_both_halves_from_one_source_is_not_recognized", () => {
  // degenerate: no stereo pair to cross-feed. The structural recognizer refuses
  // its equivalent, and this one used to accept it.
  assert.equal(rec(msCompile("", 0, FIT, 1, 0, 0)), null);
});

test("test_a_row_with_a_decibel_gain_unit_is_not_recognized", () => {
  assert.equal(rec(block().map((r, i) => (i === 5 ? { ...r, gainunit: "dB" } : r))), null);
});

test("test_an_all_zero_block_is_not_recognized", () => {
  assert.equal(rec(block().map((r) => ({ ...r, gain: "0.000000" }))), null);
});

test("test_a_perturbed_gain_is_not_recognized", () => {
  assert.equal(rec(block().map((r, i) => (i === 4 ? { ...r, gain: String(Number(r.gain) * 1.001) } : r))), null);
});

test("test_a_gain_perturbed_below_tolerance_is_still_recognized", () => {
  assert.notEqual(rec(block().map((r, i) => (i === 4 ? { ...r, gain: String(Number(r.gain) + 5e-7) } : r))), null);
});

test("test_an_edited_source_channel_is_not_recognized", () => {
  assert.equal(rec(block().map((r, i) => (i === 2 ? { ...r, source: "7" } : r))), null);
});

test("test_an_edited_mixdown_is_not_recognized", () => {
  assert.equal(rec(block().map((r, i) => (i === 5 ? { ...r, mixdown: "7" } : r))), null);
});

test("test_an_inverted_sign_pattern_is_not_recognized", () => {
  const rows = block();
  assert.equal(rec([rows[0], rows[2], rows[1], ...rows.slice(3)]), null);
});

test("test_disagreeing_eq_rows_are_not_recognized", () => {
  const rows = block(EQ);
  assert.equal(rec(rows.map((r, i) => (i === 6 ? { ...r, process: `${r.process},riaa` } : r))), null);
});

test("test_disagreeing_compensation_rows_are_not_recognized", () => {
  const rows = block(EQ);
  assert.equal(rec(rows.map((r, i) => (i === 5 ? { ...r, process: `${r.process},riaa` } : r))), null);
});

test("test_rows_carrying_only_eq_and_no_compensation_are_not_recognized", () => {
  const rows = block(EQ);
  assert.equal(rec(rows.map((r) => ({ ...r, process: EQ }))), null);
});

test("test_a_compensation_suffix_that_is_not_two_shelves_is_not_recognized", () => {
  const rows = block("");
  assert.equal(rec(rows.map((r, i) => ([0, 1, 4, 5].includes(i) ? { ...r, process: "riaa" } : r))), null);
});

// --- malformed rows decline rather than throw --------------------------------
// Rows reaching the recognizer are whatever was last hand-edited. Declining
// drops the badge; throwing takes down the render path the recognizer runs in.

test("test_a_row_with_a_non_string_process_is_not_recognized", () => {
  assert.equal(rec(block(EQ).map((r, i) => (i === 2 ? { ...r, process: 42 } : r))), null);
});

test("test_a_null_row_is_not_recognized", () => {
  assert.equal(rec(block(EQ).map((r, i) => (i === 4 ? null : r))), null);
});

test("test_compensation_rows_missing_their_chain_are_not_recognized", () => {
  // the chain read that used to throw: eqProcess truthy, compFull undefined
  const rows = block(EQ).map((r, i) => ([0, 1, 4, 5].includes(i) ? { ...r, process: undefined } : r));
  assert.equal(rec(rows), null);
});

test("test_a_block_with_no_chains_at_all_is_not_recognized", () => {
  assert.equal(rec(block(EQ).map((r) => ({ ...r, process: undefined }))), null);
});

// --- the fit itself ---------------------------------------------------------

for (const [name, p] of Object.entries(BAUER_PRESETS)) {
  test(`test_the_compensation_fit_is_accurate_for_preset: ${name}`, () => {
    assert.ok(...near(fitComp(p.fc, p.feed).errDb, 0, 0.05));
  });
}

test("test_every_bauer_preset_compiles_to_a_recognizable_block", () => {
  const ok = Object.values(BAUER_PRESETS).every((p) => {
    const rows = msCompile(EQ, 0, fitComp(p.fc, p.feed), 1, 0, 1);
    return msRecognize(rows, 0, p.fc, p.feed) !== null;
  });
  assert.ok(ok, "expected all three Bauer presets to round-trip");
});
