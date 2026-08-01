// Behavioral suite for scripts/eqlab/guidance.js — the advisory flags raised
// over a change set. Guidance NEVER rejects, clamps or alters a value: a value
// outside guidance is reported and kept. Written blind from a spec block: no
// eqlab source was read.
//
// Split out of the former eqlab.test.js; every test here is unchanged.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-guidance.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { applyChanges } from "../../../scripts/eqlab/chain.js";
import { guidanceFlags } from "../../../scripts/eqlab/guidance.js";
import { band, argNum } from "../support/eqlab-helpers.js";

const policyFlags = (flags) => flags.filter((f) => f.severity === "policy");
const guidanceOnly = (flags) => flags.filter((f) => f.severity === "guidance");
const flagsFor = (result) => guidanceFlags(result.edits, result.stages);

// The policy limit is ±6.0 dB of CHANGE per turn; there is no absolute gain
// ceiling (the ±12 dB clamp went on 2026-07-30). Amending from g=0 cannot tell
// the two apart, so both of these start somewhere else.
const BIG_MOVE = applyChanges([band(2090, -4, 3)], { amend: [{ select: 2090, g: 5 }] });
const SMALL_MOVE_HIGH_GAIN = applyChanges([band(2090, 8, 3)], { amend: [{ select: 2090, g: 9 }] });

test("test_a_gain_change_beyond_six_decibels_raises_a_policy_flag", () => {
  assert.equal(policyFlags(flagsFor(BIG_MOVE)).length, 1);
});

test("test_a_small_change_to_a_high_absolute_gain_raises_no_policy_flag", () => {
  assert.equal(policyFlags(flagsFor(SMALL_MOVE_HIGH_GAIN)).length, 0);
});

test("test_a_policy_flag_names_the_frequency_of_the_band_it_is_about", () => {
  const flag = policyFlags(flagsFor(BIG_MOVE))[0];
  assert.ok(flag.detail.includes("2090"), `expected the band frequency in ${flag.detail}`);
});

test("test_a_gain_change_of_exactly_six_decibels_is_inside_policy", () => {
  const edge = applyChanges([band(2090, 0, 3)], { amend: [{ select: 2090, g: 6 }] });
  assert.equal(policyFlags(flagsFor(edge)).length, 0);
});

test("test_an_appended_band_beyond_six_decibels_raises_a_policy_flag", () => {
  const loud = applyChanges([band(1000, 1, 1)], { append: [{ type: "peak", f: 4000, q: 2, g: 7 }] });
  assert.equal(policyFlags(flagsFor(loud)).length, 1);
});

const WIDE_Q = applyChanges([band(1000, 1, 1)], { append: [{ type: "peak", f: 3000, q: 10, g: 1 }] });

test("test_a_q_above_the_guidance_window_is_reported_as_guidance", () => {
  assert.equal(guidanceOnly(flagsFor(WIDE_Q)).length, 1);
});

test("test_a_q_below_the_guidance_window_is_reported_as_guidance", () => {
  const narrow = applyChanges([band(1000, 1, 1)], { amend: [{ select: 1000, q: 0.1 }] });
  assert.equal(guidanceOnly(flagsFor(narrow)).length, 1);
});

test("test_a_q_at_the_top_of_the_guidance_window_is_inside_guidance", () => {
  const edge = applyChanges([band(1000, 1, 1)], { amend: [{ select: 1000, q: 6 }] });
  assert.equal(guidanceOnly(flagsFor(edge)).length, 0);
});

test("test_a_q_at_the_bottom_of_the_guidance_window_is_inside_guidance", () => {
  const edge = applyChanges([band(1000, 1, 1)], { amend: [{ select: 1000, q: 0.18248 }] });
  assert.equal(guidanceOnly(flagsFor(edge)).length, 0);
});

test("test_a_q_outside_the_guidance_window_is_reported_but_never_clamped", () => {
  flagsFor(WIDE_Q);
  assert.equal(argNum(WIDE_Q.stages[WIDE_Q.stages.length - 1], "q"), 10);
});

test("test_a_policy_flag_names_the_rule_it_came_from", () => {
  const rule = policyFlags(flagsFor(BIG_MOVE))[0].rule;
  assert.ok(typeof rule === "string" && rule.length > 0, `expected a rule name, got ${JSON.stringify(rule)}`);
});

test("test_a_guidance_flag_comes_from_a_different_rule_than_a_policy_flag", () => {
  assert.notEqual(guidanceOnly(flagsFor(WIDE_Q))[0].rule, policyFlags(flagsFor(BIG_MOVE))[0].rule);
});

test("test_a_change_set_inside_guidance_raises_nothing", () => {
  const calm = applyChanges([band(2090, 0, 3)], { amend: [{ select: 2090, g: 2, q: 3 }] });
  assert.deepEqual(guidanceFlags(calm.edits, calm.stages), []);
});
