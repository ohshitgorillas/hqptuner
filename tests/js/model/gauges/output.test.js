// Behavioral suite for hqptuner/static/model/gauges/output.js: which tiers belong to a rate family, where each tier and band
// sits on the rate dial and which tier a pointer lands on, how a needle settles inside its band, how an engine device
// string splits into its group, main and detail parts, how a device list falls under its group headers, where a value sits along a range as a percentage, and which drawing x a
// pointer falls on when the drawing is fitted and centered inside its glass.
//
// Tiers, dial geometry and device lists are tables the test writes; no shipped data supplies an input or an expected
// value.
//
// Run: node --test tests/js/model/gauges/output.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  bandEdges,
  bandSpan,
  deviceParts,
  dialScale,
  drawingX,
  groupDevices,
  minorTicks,
  moveNeedle,
  nearestTier,
  percentOf,
  seamX,
  tierIndex,
} from "../../../../hqptuner/static/model/gauges/output.js";
import { near } from "../../support/near.js";

//: Tolerance for values the float arithmetic may round in the last place.
const EPS = 1e-9;

//: Three PCM tiers, then two SDM tiers.
const BANDS = [{ family: "pcm" }, { family: "pcm" }, { family: "pcm" }, { family: "sdm" }, { family: "sdm" }];
//: Families interleaved, so a family's tiers are not one run.
const MIXED = [{ family: "pcm" }, { family: "sdm" }, { family: "pcm" }];

//: Network devices: two cards on one host, then one on another.
const NET = ["den: dac-a: usb", "den: dac-b: i2s", "attic: dac-c: usb"];
//: ALSA devices whose card returns after another card's row.
const ALSA = ["card0: hw0", "card0: hw1", "card1: hw0", "card0: hw2"];

//: A dial 120 wide whose first tier sits at 10: five tiers are 25 apart.
const DIAL = { width: 120, x0: 10 };
//: Where each of the five BANDS tiers sits on that dial.
const DIAL_XS = [10, 35, 60, 85, 110];
//: The scale of that dial over the five BANDS tiers.
const SCALE = dialScale(BANDS.length, DIAL.width, DIAL.x0);
//: The PCM band of BANDS, and the inset its rule keeps from the edges of its outer tiers' cells.
const PCM_SPAN = { lo: 0, hi: 2 };
const INSET = 8;
//: Quarter steps between the PCM band's rule ends (5.5 … 64.5) that miss every tier.
const PCM_MINOR = [16.25, 22.5, 28.75, 41.25, 47.5, 53.75];

//: The drawing's viewBox, and the x of its first tier in drawing units.
const VIEWBOX = { w: 806, h: 106 };
const FIRST_TIER_X = 38;
//: A glass wider than the drawing at equal height: scale 1, a 143px margin each side.
const WIDE_GLASS = { left: 0, width: 1092, height: 106 };
//: A glass the drawing fills exactly: scale 1, no margin.
const EXACT_GLASS = { left: 0, width: 806, height: 106 };
//: The wide glass moved 100px right in the page.
const SHIFTED_GLASS = { left: 100, width: 1092, height: 106 };
//: A glass of the drawing's width at half its height: scale 0.5, 403 wide, a 201.5px margin each side.
const SHORT_GLASS = { left: 0, width: 806, height: 53 };
//: A glass of half the drawing's width at full height: scale 0.5, no horizontal margin.
const NARROW_GLASS = { left: 0, width: 403, height: 106 };
//: (220 - 201.5) / 0.5 in the short glass.
const SHORT_GLASS_X = 37;

// ── tierIndex ────────────────────────────────────────────────────────────

test("test_tier_index_lists_the_pcm_band_in_tier_order", () => {
  assert.deepEqual(tierIndex(BANDS, "pcm"), [0, 1, 2]);
});

test("test_tier_index_lists_the_sdm_band_in_tier_order", () => {
  assert.deepEqual(tierIndex(BANDS, "sdm"), [3, 4]);
});

test("test_tier_index_skips_the_other_family_between_its_tiers", () => {
  assert.deepEqual(tierIndex(MIXED, "pcm"), [0, 2]);
});

// ── dial geometry ────────────────────────────────────────────────────────

test("test_dial_tiers_sit_evenly_from_the_first_tier_to_the_mirrored_far_edge", () => {
  assert.deepEqual(SCALE.xs, DIAL_XS);
});

test("test_dial_pitch_is_the_distance_between_neighbouring_tiers", () => {
  assert.equal(SCALE.dx, 25);
});

test("test_band_span_runs_from_the_first_to_the_last_tier_of_its_family", () => {
  assert.deepEqual(bandSpan(BANDS, "sdm"), { lo: 3, hi: 4 });
});

test("test_seam_sits_half_way_between_the_last_pcm_and_first_sdm_tier", () => {
  assert.equal(seamX(SCALE, BANDS), 72.5);
});

test("test_band_rule_starts_its_inset_inside_the_first_tier_cell", () => {
  assert.equal(bandEdges(SCALE, PCM_SPAN, INSET).x1, 5.5);
});

test("test_band_rule_ends_its_inset_inside_the_last_tier_cell", () => {
  assert.equal(bandEdges(SCALE, PCM_SPAN, INSET).x2, 64.5);
});

test("test_minor_ticks_fall_on_quarter_steps_inside_the_rule_and_off_the_tiers", () => {
  assert.deepEqual(minorTicks(SCALE, PCM_SPAN, bandEdges(SCALE, PCM_SPAN, INSET)), PCM_MINOR);
});

test("test_a_pointer_short_of_half_way_lands_on_the_tier_before", () => {
  assert.equal(nearestTier(SCALE, 47), 1);
});

test("test_a_pointer_past_half_way_lands_on_the_tier_after", () => {
  assert.equal(nearestTier(SCALE, 48), 2);
});

test("test_a_pointer_past_the_last_tier_lands_beyond_the_scale", () => {
  assert.equal(nearestTier(SCALE, 140), 5);
});

// ── moveNeedle ───────────────────────────────────────────────────────────

test("test_a_needle_sent_below_its_band_stops_at_the_band_s_first_tier", () => {
  assert.equal(moveNeedle(bandSpan(BANDS, "sdm"), 4, 1).i, 3);
});

test("test_a_needle_sent_above_its_band_stops_at_the_band_s_last_tier", () => {
  assert.equal(moveNeedle(PCM_SPAN, 0, 4).i, 2);
});

test("test_a_needle_sent_inside_its_band_goes_to_that_tier", () => {
  assert.equal(moveNeedle(PCM_SPAN, 0, 1).i, 1);
});

test("test_a_needle_sent_to_another_tier_has_moved", () => {
  assert.equal(moveNeedle(PCM_SPAN, 0, 1).moved, true);
});

test("test_a_needle_clamped_back_onto_its_own_tier_has_not_moved", () => {
  assert.equal(moveNeedle(PCM_SPAN, 2, 4).moved, false);
});

// ── deviceParts ──────────────────────────────────────────────────────────

test("test_network_device_groups_under_its_host", () => {
  assert.equal(deviceParts("network", "den: dac-a: usb").group, "den");
});

test("test_network_device_names_its_card", () => {
  assert.equal(deviceParts("network", "den: dac-a: usb").main, "dac-a");
});

test("test_network_device_details_its_interface", () => {
  assert.equal(deviceParts("network", "den: dac-a: usb").detail, "usb");
});

test("test_network_device_detail_keeps_every_field_after_the_card", () => {
  assert.equal(deviceParts("network", "den: dac-a: usb: 2").detail, "usb: 2");
});

test("test_network_device_with_only_a_host_names_the_host", () => {
  assert.equal(deviceParts("network", "den").main, "den");
});

test("test_alsa_device_groups_under_its_card", () => {
  assert.equal(deviceParts("alsa", "card0: hw0").group, "card0");
});

test("test_alsa_device_names_its_interface", () => {
  assert.equal(deviceParts("alsa", "card0: hw0").main, "hw0");
});

test("test_alsa_device_name_keeps_every_field_after_the_card", () => {
  assert.equal(deviceParts("alsa", "card0: hw0: sub1").main, "hw0: sub1");
});

test("test_alsa_device_with_only_a_card_names_the_card", () => {
  assert.equal(deviceParts("alsa", "card0").main, "card0");
});

// ── groupDevices ─────────────────────────────────────────────────────────

test("test_network_devices_fall_under_one_header_per_host", () => {
  assert.deepEqual(
    groupDevices("network", NET).map((g) => g.group),
    ["den", "attic"],
  );
});

test("test_a_card_that_returns_after_another_gets_a_new_header", () => {
  assert.deepEqual(
    groupDevices("alsa", ALSA).map((g) => g.group),
    ["card0", "card1", "card0"],
  );
});

test("test_a_group_holds_the_list_positions_of_its_devices", () => {
  assert.deepEqual(
    groupDevices("alsa", ALSA)[0].rows.map((r) => r.i),
    [0, 1],
  );
});

test("test_a_returning_group_holds_its_own_list_position", () => {
  assert.deepEqual(
    groupDevices("alsa", ALSA)[2].rows.map((r) => r.i),
    [3],
  );
});

test("test_a_grouped_device_keeps_its_device_string", () => {
  assert.equal(groupDevices("network", NET)[0].rows[1].str, "den: dac-b: i2s");
});

test("test_a_grouped_device_carries_its_split_name", () => {
  assert.equal(groupDevices("network", NET)[1].rows[0].main, "dac-c");
});

test("test_a_grouped_device_carries_its_split_detail", () => {
  assert.equal(groupDevices("network", NET)[0].rows[1].detail, "i2s");
});

// ── percentOf ────────────────────────────────────────────────────────────

test("test_the_middle_of_the_range_is_half_way", () => {
  assert.equal(percentOf(-30, -60, 0), 50);
});

test("test_the_top_of_the_range_is_the_whole_way", () => {
  assert.equal(percentOf(0, -60, 0), 100);
});

test("test_a_range_above_zero_measures_from_its_own_minimum", () => {
  assert.ok(...near(percentOf(-15, -60, 12), 62.5, EPS));
});

test("test_a_value_past_the_top_is_not_clamped", () => {
  assert.ok(...near(percentOf(6, -60, 0), 110, EPS));
});

// ── drawingX ─────────────────────────────────────────────────────────────

test("test_a_pointer_in_a_wide_glass_is_measured_from_the_centered_drawing_s_edge", () => {
  assert.equal(drawingX(181, WIDE_GLASS, VIEWBOX), FIRST_TIER_X);
});

test("test_a_pointer_in_a_glass_the_drawing_fills_maps_one_to_one", () => {
  assert.equal(drawingX(FIRST_TIER_X, EXACT_GLASS, VIEWBOX), FIRST_TIER_X);
});

test("test_a_pointer_is_measured_from_the_glass_s_left_edge_in_the_page", () => {
  assert.equal(drawingX(281, SHIFTED_GLASS, VIEWBOX), FIRST_TIER_X);
});

test("test_a_short_glass_scales_the_drawing_by_its_height_and_centers_it", () => {
  assert.equal(drawingX(220, SHORT_GLASS, VIEWBOX), SHORT_GLASS_X);
});

test("test_a_narrow_glass_scales_the_drawing_by_its_width", () => {
  assert.equal(drawingX(19, NARROW_GLASS, VIEWBOX), FIRST_TIER_X);
});

test("test_a_pointer_in_the_left_margin_falls_before_the_drawing_unclamped", () => {
  assert.equal(drawingX(100, WIDE_GLASS, VIEWBOX), -43);
});

test("test_a_pointer_in_the_right_margin_falls_past_the_drawing_unclamped", () => {
  assert.equal(drawingX(1000, WIDE_GLASS, VIEWBOX), 857);
});
