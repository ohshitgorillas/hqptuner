// Behavioral suite for eqlab v2 S6 — confidence annotation, sub-20 Hz shelf
// headroom, and the extended guidance flags. Written blind from a spec block:
// no eqlab source was read.
//
// The headroom chain is a low shelf at 25 Hz: an RBJ low shelf keeps rising
// below the 20 Hz plot floor toward its full gain, so its true maximum sits
// under 20 Hz and `preamp_db_full` must dig deeper than `preamp_db`.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-confidence.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { applyChanges } from "../../../scripts/eqlab/chain.js";
import { guidanceFlags, headroomFlags } from "../../../scripts/eqlab/guidance.js";
import { preampDb, preampDbFull } from "../../../scripts/eqlab/metrics.js";
import { probe, evaluateJob } from "../../../scripts/eqlab/jobs.js";
import { searchJob } from "../../../scripts/eqlab/search.js";
import { FS, near, below, band, curve, argNum } from "../support/eqlab-helpers.js";

const HEADROOM = "sub-20 Hz headroom";
const HIGH_Q = "high-Q large step";
const FIT_HIGH = "fitting above 8 kHz";
const RESEAT = "inside measurement reseat variance";
const QUALIFIED = "above rig's qualified range";

const ruleOf = (flags, rule) => flags.filter((f) => f.rule === rule);
const flagsOf = (result) => guidanceFlags(result.edits, result.stages);

// [ok, message] for one assert.ok: the value is already rounded to 2 dp.
const twoDp = (x) => [Math.abs(x * 100 - Math.round(x * 100)) < 1e-9, `expected a 2 dp value, got ${x}`];

// --- chain panels: preamp_db_full beside preamp_db ---------------------------

const PEAK = [band(1000, 3, 1)];
const PEAK_CTX = { stages: PEAK, fs: FS, metrics: { spot: { kind: "at", f: 1000 } } };
const PEAK_EV = evaluateJob({ changes: { amend: [{ select: 1000, g: 3 }] } }, PEAK_CTX);

const SHELF = [band(25, 6, 0.71, "lshelf")];
const SHELF_CTX = { stages: SHELF, fs: FS, metrics: { spot: { kind: "at", f: 100 } } };
const SHELF_EV = evaluateJob({ changes: { amend: [{ select: 25, g: 6 }] } }, SHELF_CTX);

const PROBE = probe({}, PEAK_CTX);

test("test_a_probe_panel_carries_preamp_db_full_beside_preamp_db", () => {
  assert.equal(PROBE.preamp_db_full, PROBE.preamp_db);
});

test("test_a_probe_panel_carries_no_flags_array", () => {
  assert.ok(!("flags" in PROBE), `expected no flags key, got ${Object.keys(PROBE)}`);
});

test("test_a_panels_full_preamp_is_rounded_to_two_decimals", () => {
  assert.ok(...twoDp(SHELF_EV.before.preamp_db_full));
});

test("test_a_panels_bounded_preamp_is_rounded_to_two_decimals", () => {
  assert.ok(...twoDp(SHELF_EV.before.preamp_db));
});

test("test_a_chain_peaking_inside_the_audio_band_has_equal_full_and_bounded_preamp", () => {
  assert.equal(PEAK_EV.before.preamp_db_full, PEAK_EV.before.preamp_db);
});

test("test_a_shelf_rising_below_20_hz_pulls_the_full_preamp_under_the_bounded_one", () => {
  assert.ok(...below(SHELF_EV.before.preamp_db_full, SHELF_EV.before.preamp_db));
});

test("test_the_after_panel_of_a_surviving_shelf_carries_the_deeper_full_preamp", () => {
  assert.ok(...below(SHELF_EV.after.preamp_db_full, SHELF_EV.after.preamp_db));
});

test("test_the_full_preamp_reaches_the_shelfs_full_gain_asymptote", () => {
  const full = preampDbFull(SHELF, FS, preampDb(curve(SHELF)));
  assert.ok(...near(full, -6, 0.2));
});

// --- headroom flag -----------------------------------------------------------

test("test_equal_preamp_values_raise_no_headroom_flag", () => {
  assert.deepEqual(headroomFlags(-3, -3), []);
});

test("test_differing_preamp_values_raise_the_sub_20_hz_headroom_rule", () => {
  assert.equal(headroomFlags(-5.5, -6)[0].rule, HEADROOM);
});

test("test_a_headroom_flag_carries_guidance_severity", () => {
  assert.equal(headroomFlags(-5.5, -6)[0].severity, "guidance");
});

test("test_a_headroom_flag_detail_names_the_bounded_preamp", () => {
  const detail = headroomFlags(-5.5, -6)[0].detail;
  assert.ok(detail.includes("-5.5"), `expected -5.5 in ${detail}`);
});

test("test_a_headroom_flag_detail_names_the_full_preamp", () => {
  const detail = headroomFlags(-5.5, -6)[0].detail;
  assert.ok(detail.includes("-6"), `expected -6 in ${detail}`);
});

test("test_an_evaluate_over_a_sub_20_shelf_carries_the_headroom_flag", () => {
  assert.equal(ruleOf(SHELF_EV.flags, HEADROOM).length, 1);
});

test("test_an_evaluate_over_an_in_band_chain_carries_no_headroom_flag", () => {
  assert.equal(ruleOf(PEAK_EV.flags, HEADROOM).length, 0);
});

const SHELF_SEARCH = searchJob(
  {
    space: { append: { type: "lshelf", f: 25, q: 0.71, g: 6 } },
    constraints: [],
    objective: "maximize spot",
    top: 5,
  },
  { stages: [band(1000, 0, 1)], fs: FS, metrics: { spot: { kind: "at", f: 1000 } } },
);

test("test_a_search_survivor_over_a_sub_20_shelf_carries_the_headroom_flag", () => {
  assert.equal(ruleOf(SHELF_SEARCH.top[0].flags, HEADROOM).length, 1);
});

test("test_a_search_survivor_carries_the_deeper_full_preamp_beside_the_bounded_one", () => {
  assert.ok(...below(SHELF_SEARCH.top[0].preamp_db_full, SHELF_SEARCH.top[0].preamp_db));
});

// --- high-Q large step -------------------------------------------------------
//
// Floor is ±1.5 dB at Q=1 → ±3 dB at Q=10 → ±5 dB at Q=50, linear in log10(Q),
// clamped outside [1, 50]; only bands with q >= 2.5 participate, strictly
// greater than the floor fires. Q=3 floor ≈ 2.22 dB, Q=10 floor = 3 dB.

const BASE_1K = [band(1000, 0, 1)];
const appended = (bandSpec) => applyChanges(BASE_1K, { append: [bandSpec] });

test("test_appending_a_high_q_band_with_a_large_gain_raises_the_high_q_rule", () => {
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 3, g: 5 })), HIGH_Q).length, 1);
});

test("test_a_high_q_flag_carries_guidance_severity", () => {
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 3, g: 5 })), HIGH_Q)[0].severity, "guidance");
});

test("test_appending_a_high_q_band_with_a_small_gain_raises_no_high_q_flag", () => {
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 3, g: 2 })), HIGH_Q).length, 0);
});

test("test_a_low_q_band_never_raises_the_high_q_rule", () => {
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 1, g: 5 })), HIGH_Q).length, 0);
});

test("test_a_band_without_a_q_parameter_never_raises_the_high_q_rule", () => {
  assert.equal(ruleOf(flagsOf(appended({ type: "lshelf", f: 100, g: 5 })), HIGH_Q).length, 0);
});

test("test_a_step_just_over_the_interpolated_q_three_floor_fires", () => {
  // Floor at q=3 interpolates to ≈ 2.22 dB — a 2.3 dB step is over it while
  // staying under both endpoint figures' midpoint, so only the curve explains it.
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 3, g: 2.3 })), HIGH_Q).length, 1);
});

test("test_a_step_under_the_q_fifty_floor_does_not_fire", () => {
  // Floor at q=50 is the 5 dB endpoint; a 4.5 dB step sits under it even
  // though it would clear any lower-Q floor.
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 50, g: 4.5 })), HIGH_Q).length, 0);
});

test("test_a_gain_step_exactly_at_the_floor_does_not_fire", () => {
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 10, g: 3 })), HIGH_Q).length, 0);
});

test("test_the_floor_clamps_at_the_q_fifty_figure_for_larger_q", () => {
  // Unclamped extrapolation to q=100 would put the floor near 5.9 dB; the
  // clamped floor is 5 dB, so a 5.5 dB step fires only under the clamp.
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 100, g: 5.5 })), HIGH_Q).length, 1);
});

test("test_a_q_just_under_the_gate_never_raises_the_high_q_rule", () => {
  assert.equal(ruleOf(flagsOf(appended({ type: "peak", f: 2000, q: 2.4, g: 5 })), HIGH_Q).length, 0);
});

test("test_an_amend_counts_the_gain_delta_not_the_absolute_gain", () => {
  // From -1 to 2: the landing gain (2 dB) is under the q=3 floor, the step
  // (3 dB) is over it — firing proves the delta is what is measured.
  const moved = applyChanges([band(2000, -1, 3)], { amend: [{ select: 2000, g: 2 }] });
  assert.equal(ruleOf(flagsOf(moved), HIGH_Q).length, 1);
});

test("test_removing_a_high_q_band_counts_minus_its_gain_as_the_step", () => {
  const removed = applyChanges([band(2000, 5, 3)], { replace: [{ remove: [2000], with: [] }] });
  assert.equal(ruleOf(flagsOf(removed), HIGH_Q).length, 1);
});

test("test_a_replace_with_band_counts_its_own_gain_as_the_step", () => {
  const swapped = applyChanges(BASE_1K, {
    replace: [{ remove: [1000], with: [{ type: "peak", f: 2000, q: 3, g: 5 }] }],
  });
  assert.equal(ruleOf(flagsOf(swapped), HIGH_Q).length, 1);
});

// --- fitting above 8 kHz -----------------------------------------------------

const removal = (fitRange) =>
  applyChanges(BASE_1K, { replace: [{ remove: [1000], with: [], ...(fitRange && { fit_range: fitRange }) }] });

test("test_a_replace_fit_range_ending_above_8_khz_raises_the_fitting_rule", () => {
  assert.equal(ruleOf(flagsOf(removal([500, 10000])), FIT_HIGH).length, 1);
});

test("test_a_fitting_flag_carries_guidance_severity", () => {
  assert.equal(ruleOf(flagsOf(removal([500, 10000])), FIT_HIGH)[0].severity, "guidance");
});

test("test_a_fit_range_ending_exactly_at_8_khz_raises_no_fitting_flag", () => {
  assert.equal(ruleOf(flagsOf(removal([500, 8000])), FIT_HIGH).length, 0);
});

test("test_a_replace_without_a_fit_range_raises_no_fitting_flag", () => {
  assert.equal(ruleOf(flagsOf(removal(null)), FIT_HIGH).length, 0);
});

// --- confidence: measurement reseat variance ---------------------------------

const SMALL_STEP = applyChanges(BASE_1K, { amend: [{ select: 1000, g: 1.5 }] });

test("test_a_small_midrange_gain_step_raises_the_reseat_variance_note", () => {
  assert.equal(ruleOf(flagsOf(SMALL_STEP), RESEAT).length, 1);
});

test("test_a_reseat_note_carries_confidence_severity", () => {
  assert.equal(ruleOf(flagsOf(SMALL_STEP), RESEAT)[0].severity, "confidence");
});

test("test_a_q_only_amend_raises_no_reseat_note", () => {
  const qOnly = applyChanges([band(1000, 2, 1)], { amend: [{ select: 1000, q: 2 }] });
  assert.equal(ruleOf(flagsOf(qOnly), RESEAT).length, 0);
});

test("test_a_two_decibel_step_is_outside_the_reseat_note", () => {
  const atTwo = applyChanges(BASE_1K, { amend: [{ select: 1000, g: 2 }] });
  assert.equal(ruleOf(flagsOf(atTwo), RESEAT).length, 0);
});

test("test_a_band_below_the_reseat_range_raises_no_note", () => {
  const low = applyChanges([band(400, 0, 1)], { amend: [{ select: 400, g: 1 }] });
  assert.equal(ruleOf(flagsOf(low), RESEAT).length, 0);
});

test("test_a_band_above_the_reseat_range_raises_no_note", () => {
  const high = applyChanges([band(6000, 0, 1)], { amend: [{ select: 6000, g: 1 }] });
  assert.equal(ruleOf(flagsOf(high), RESEAT).length, 0);
});

test("test_a_band_at_exactly_500_hz_raises_the_reseat_note", () => {
  const edge = applyChanges([band(500, 0, 1)], { amend: [{ select: 500, g: 1 }] });
  assert.equal(ruleOf(flagsOf(edge), RESEAT).length, 1);
});

test("test_a_band_at_exactly_5000_hz_raises_the_reseat_note", () => {
  const edge = applyChanges([band(5000, 0, 1)], { amend: [{ select: 5000, g: 1 }] });
  assert.equal(ruleOf(flagsOf(edge), RESEAT).length, 1);
});

test("test_a_reseat_note_names_the_band_frequency", () => {
  const detail = ruleOf(flagsOf(SMALL_STEP), RESEAT)[0].detail;
  assert.ok(detail.includes("1000"), `expected the band frequency in ${detail}`);
});

test("test_a_reseat_note_names_the_step_size", () => {
  const detail = ruleOf(flagsOf(SMALL_STEP), RESEAT)[0].detail;
  assert.ok(detail.includes("1.5"), `expected the step size in ${detail}`);
});

test("test_a_reseat_note_makes_no_audibility_claim", () => {
  const detail = ruleOf(flagsOf(SMALL_STEP), RESEAT)[0].detail;
  assert.ok(!/audible|hear/i.test(detail), `expected no audibility language in ${detail}`);
});

// --- confidence: rig's qualified range ---------------------------------------

test("test_any_edit_above_8_khz_raises_the_qualified_range_note", () => {
  // A q-only amend: gain step is 0 and the note must fire regardless.
  const treble = applyChanges([band(9000, 2, 1)], { amend: [{ select: 9000, q: 2 }] });
  assert.equal(ruleOf(flagsOf(treble), QUALIFIED).length, 1);
});

test("test_a_qualified_range_note_carries_confidence_severity", () => {
  const treble = applyChanges([band(9000, 2, 1)], { amend: [{ select: 9000, q: 2 }] });
  assert.equal(ruleOf(flagsOf(treble), QUALIFIED)[0].severity, "confidence");
});

test("test_a_band_at_exactly_8_khz_raises_no_qualified_range_note", () => {
  const edge = applyChanges([band(8000, 0, 1)], { amend: [{ select: 8000, g: 3 }] });
  assert.equal(ruleOf(flagsOf(edge), QUALIFIED).length, 0);
});

// --- confidence never filters or ranks ---------------------------------------
//
// Every candidate in this space carries a reseat note (steps of 0.5–1.5 dB at
// 1 kHz); the best score must still win exactly as before.

const CONF_CTX = { stages: [band(1000, 0, 1)], fs: FS, metrics: { spot: { kind: "at", f: 1000 } } };
const CONF_SEARCH = searchJob(
  { space: { amend: { select: 1000, g: [0.5, 1.5, 0.5], q: 1 } }, constraints: [], objective: "maximize spot", top: 5 },
  CONF_CTX,
);

test("test_a_candidate_carrying_confidence_notes_still_wins_on_score", () => {
  assert.ok(...near(CONF_SEARCH.top[0].score, 1.5, 0.1));
});

test("test_the_winners_flags_include_its_confidence_notes", () => {
  assert.equal(ruleOf(CONF_SEARCH.top[0].flags, RESEAT).length, 1);
});

// --- all new flags are report-only -------------------------------------------

test("test_a_flagged_high_q_append_still_lands_unchanged", () => {
  const loud = appended({ type: "peak", f: 2000, q: 3, g: 5 });
  flagsOf(loud);
  assert.equal(argNum(loud.stages[loud.stages.length - 1], "g"), 5);
});

test("test_a_flagged_small_step_still_lands_unchanged", () => {
  flagsOf(SMALL_STEP);
  assert.equal(argNum(SMALL_STEP.stages[0], "g"), 1.5);
});
