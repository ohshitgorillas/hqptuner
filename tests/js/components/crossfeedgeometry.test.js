// Behavioral suite for components/xfeed/Geometry.js — the top-down speaker
// diagram on the structural crossfeed card.
//
// The component is a pure function of its two props ({angle, headRadius}) with
// no handlers and no store reads, so the whole contract is SSR-fillable: every
// case renders and asserts on the emitted SVG. Coordinates asserted here are
// contract facts of the drawing — the fixed speaker radius, the ±30° stereo
// convention, the clamped head band — not incidental pixels: each one is the
// documented reason a constant exists in the source.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/crossfeedgeometry.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { CrossfeedGeometry } from "../../../hqptuner/static/components/xfeed/Geometry.js";

const draw = (angle = 30, headRadius = 0.0875) =>
  render(html`<${CrossfeedGeometry} angle=${angle} headRadius=${headRadius} />`);

/**
 * @param {string} out
 * @param {string} needle
 */
const count = (out, needle) => out.split(needle).length - 1;

// --- frame ---------------------------------------------------------------------

// The diagram's screen-reader sentence is owner-owned copy with no machine
// identity beside it, so the case that pinned its wording is gone
// (docs/testing.md rule 9). The angle it announces is still pinned below.

test("test_the_angle_label_prints_the_angle_in_degrees", () => {
  assert.ok(draw(45).includes("45°"));
});

// --- speakers ------------------------------------------------------------------

test("test_two_speakers_are_drawn", () => {
  assert.equal(count(draw(), 'class="spk"'), 2);
});

test("test_the_right_speaker_sits_toed_in_at_the_speaker_angle", () => {
  assert.ok(draw(30).includes("translate(222.0 67.9) rotate(30.0)"));
});

test("test_the_left_speaker_mirrors_at_the_negative_angle", () => {
  assert.ok(draw(30).includes("translate(118.0 67.9) rotate(-30.0)"));
});

test("test_a_wider_angle_swings_the_speaker_round_the_same_arc", () => {
  // radius stays 104 — the angle control moves speakers along the arc, not away
  assert.ok(draw(60).includes("translate(260.1 106.0) rotate(60.0)"));
});

// --- the head ------------------------------------------------------------------

test("test_the_head_scales_with_the_head_radius", () => {
  assert.ok(draw(30, 0.0875).includes('r="20.6" class="spk-head"'));
});

test("test_an_oversized_head_clamps_to_the_drawable_band", () => {
  assert.ok(draw(30, 0.2).includes('r="25.0" class="spk-head"'));
});

test("test_a_tiny_head_clamps_to_the_minimum", () => {
  assert.ok(draw(30, 0.01).includes('r="15.0" class="spk-head"'));
});

test("test_the_ears_sit_on_the_head_rim", () => {
  assert.ok(draw(30, 0.0875).includes("M149.4 156 a3 3 0 0 0 0 5"));
});

test("test_the_nose_points_up_from_the_head", () => {
  assert.ok(draw(30, 0.0875).includes("M167 137.4 L170 133.4 L173 137.4"));
});

// --- the angle arc -------------------------------------------------------------

test("test_the_angle_arc_sweeps_clockwise_from_the_forward_axis", () => {
  assert.ok(draw(30).includes("M170.0 112.0 A46 46 0 0 1"));
});

test("test_the_angle_arc_ends_on_the_speaker_ray", () => {
  assert.ok(draw(30).includes("A46 46 0 0 1 193.0 118.2"));
});

// --- near and far paths ----------------------------------------------------------

test("test_two_near_paths_run_straight_to_the_ears", () => {
  assert.equal(count(draw(), 'class="spk-near"'), 2);
});

test("test_the_near_path_is_a_straight_line_from_speaker_to_ear", () => {
  assert.ok(draw(30, 0.0875).includes('M118.0 67.9 L149.4 158.0" class="spk-near"'));
});

test("test_two_far_ear_paths_wrap_the_head", () => {
  assert.equal(count(draw(), 'class="spk-far"'), 2);
});

test("test_the_far_path_is_one_unbroken_cubic_curve", () => {
  // one M, one C, no straight segment and no join — sound bending has no corner
  assert.match(draw(), /d="M[-\d. ]+C[-\d. ]+" class="spk-far"/);
});

test("test_the_left_speakers_far_path_lands_on_the_right_ear", () => {
  assert.ok(draw(30, 0.0875).includes('190.6 158.0" class="spk-far"'));
});

test("test_the_right_speakers_far_path_wraps_round_to_the_left_ear", () => {
  assert.ok(draw(30, 0.0875).includes('149.4 158.0" class="spk-far"'));
});
