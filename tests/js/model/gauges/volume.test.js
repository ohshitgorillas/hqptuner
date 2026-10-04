// Behavioral suite for hqptuner/static/model/gauges/volume.js: the playback level a request lands on (clamped to the range,
// snapped to the step), Fixed volume and Direct SDM pinning it with Direct SDM first, which ± buttons disable, and where
// the loudness bounds sit along the slider.
//
// Run: node --test tests/js/model/gauges/volume.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  snapLevel,
  fixedPin,
  directPin,
  stepOff,
  volumeView,
  loudSpan,
} from "../../../../hqptuner/static/model/gauges/volume.js";

//: The slider range the test writes: −40 … +10 dB in half-dB steps (neither end zero, so a zero answer is never right).
const CFG = { min: -40, max: 10, step: 0.5 };

//: Pins the test writes: a Fixed volume level and a Direct SDM level, each distinct from the other and from any request.
const FIXED = { level: -20, level_txt: "fixed", text: "rail fixed" };
const DIRECT = { level: -3, level_txt: "direct", text: "rail direct", why: "bypassed" };
const FREE = { fixed: null, direct: null };

// ── snapLevel ───────────────────────────────────────────────────────────────

test("test_snap_level_keeps_a_level_on_the_grid", () => {
  assert.equal(snapLevel(-12.5, CFG), -12.5);
});

test("test_snap_level_rounds_to_the_nearest_step", () => {
  assert.equal(snapLevel(-12.3, CFG), -12.5);
});

test("test_snap_level_clamps_above_the_range_to_its_top", () => {
  assert.equal(snapLevel(14, CFG), 10);
});

test("test_snap_level_clamps_below_the_range_to_its_bottom", () => {
  assert.equal(snapLevel(-75, CFG), -40);
});

// ── fixedPin / directPin ────────────────────────────────────────────────────

test("test_fixed_pin_manual_holds_the_given_level", () => {
  assert.equal(fixedPin("manual", "-9.5", "1")?.level, -9.5);
});

test("test_fixed_pin_auto_first_iso_level_is_minus_three", () => {
  assert.equal(fixedPin("auto", "0", "1")?.level, -3);
});

test("test_fixed_pin_auto_second_iso_level_is_minus_six", () => {
  assert.equal(fixedPin("auto", "0", "2")?.level, -6);
});

test("test_fixed_pin_off_leaves_the_volume_adjustable", () => {
  assert.equal(fixedPin("off", "-9.5", "1"), null);
});

test("test_direct_pin_holds_pcm_volume_at_minus_three", () => {
  assert.equal(directPin(true, "bypassed")?.level, -3);
});

test("test_direct_pin_carries_its_reason", () => {
  assert.equal(directPin(true, "bypassed")?.why, "bypassed");
});

test("test_direct_pin_off_releases_the_volume", () => {
  assert.equal(directPin(false, "bypassed"), null);
});

// ── stepOff ─────────────────────────────────────────────────────────────────

test("test_step_off_disables_down_at_the_bottom", () => {
  assert.equal(stepOff(-40, false, CFG).down, true);
});

test("test_step_off_keeps_up_at_the_bottom", () => {
  assert.equal(stepOff(-40, false, CFG).up, false);
});

test("test_step_off_disables_up_at_the_top", () => {
  assert.equal(stepOff(10, false, CFG).up, true);
});

test("test_step_off_keeps_down_at_the_top", () => {
  assert.equal(stepOff(10, false, CFG).down, false);
});

test("test_step_off_disables_down_while_pinned", () => {
  assert.equal(stepOff(-20, true, CFG).down, true);
});

test("test_step_off_disables_up_while_pinned", () => {
  assert.equal(stepOff(-20, true, CFG).up, true);
});

// ── volumeView ──────────────────────────────────────────────────────────────

test("test_volume_view_free_moves_to_the_snapped_request", () => {
  assert.equal(volumeView(-12.3, -30, FREE, CFG).value, -12.5);
});

test("test_volume_view_free_shows_the_new_level", () => {
  assert.equal(volumeView(-12.3, -30, FREE, CFG).level, -12.5);
});

test("test_volume_view_fixed_keeps_the_adjustable_level", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: null }, CFG).value, -30);
});

test("test_volume_view_fixed_shows_the_fixed_level", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: null }, CFG).level, -20);
});

test("test_volume_view_fixed_windows_print_the_fixed_level_text", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: null }, CFG).txt, "fixed");
});

test("test_volume_view_fixed_rail_prints_the_fixed_mode_text", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: null }, CFG).rail, "rail fixed");
});

test("test_volume_view_free_rail_prints_what_the_windows_print", () => {
  const view = volumeView(-12.5, -30, FREE, CFG);
  assert.equal(view.rail, view.txt);
});

test("test_volume_view_direct_wins_over_fixed", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: DIRECT }, CFG).level, -3);
});

test("test_volume_view_direct_rail_prints_the_direct_text_over_fixed", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: DIRECT }, CFG).rail, "rail direct");
});

test("test_volume_view_direct_carries_its_reason", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: null, direct: DIRECT }, CFG).why, "bypassed");
});

test("test_volume_view_fixed_alone_carries_no_reason", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: null }, CFG).why, "");
});

test("test_volume_view_marks_a_pinned_level_fixed", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: null }, CFG).fixed, true);
});

test("test_volume_view_leaves_a_free_level_unfixed", () => {
  assert.equal(volumeView(-12.5, -30, FREE, CFG).fixed, false);
});

test("test_volume_view_disables_down_when_the_request_lands_on_the_bottom", () => {
  assert.equal(volumeView(-80, -30, FREE, CFG).off.down, true);
});

test("test_volume_view_keeps_up_when_the_request_lands_on_the_bottom", () => {
  assert.equal(volumeView(-80, -30, FREE, CFG).off.up, false);
});

test("test_volume_view_disables_up_while_fixed_at_a_midrange_level", () => {
  assert.equal(volumeView(-12.5, -30, { fixed: FIXED, direct: null }, CFG).off.up, true);
});

// ── loudSpan ────────────────────────────────────────────────────────────────

test("test_loud_span_places_the_low_bound_along_the_range", () => {
  assert.equal(loudSpan(-15, -2.5, CFG).lo, 50);
});

test("test_loud_span_places_the_high_bound_along_the_range", () => {
  assert.equal(loudSpan(-15, -2.5, CFG).hi, 75);
});

test("test_loud_span_spans_the_strip_between_the_bounds", () => {
  assert.equal(loudSpan(-15, -2.5, CFG).width, 25);
});

test("test_loud_span_clamps_a_low_bound_below_the_range_to_its_start", () => {
  assert.equal(loudSpan(-90, -2.5, CFG).lo, 0);
});

test("test_loud_span_clamps_a_high_bound_above_the_range_to_its_end", () => {
  assert.equal(loudSpan(-15, 16, CFG).hi, 100);
});
