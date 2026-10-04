// Behavioral suite for mockup/scripts/model/output.js: which tiers belong to a rate family, where each tier and band
// sits on the rate dial and which tier a pointer lands on, how a needle settles inside its band, which rates the output
// tuner marks pinned and playing, how an engine device string splits into its group, main and detail parts, how a
// device list falls under its group headers, and where a value sits along a range as a percentage.
//
// Tiers, dial geometry and device lists are tables the test writes; no shipped data supplies an input or an expected
// value.
//
// Run: node --test tests/js/mockup/output.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  bandEdges,
  bandSpan,
  deviceParts,
  dialScale,
  groupDevices,
  minorTicks,
  moveNeedle,
  nearestTier,
  percentOf,
  seamX,
  tierIndex,
  tunerColumns,
} from "../../../../mockup/scripts/model/output.js";
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

//: Rate families in the order the tuner lists them.
const FAMS = ["f44", "f48"];
//: One PCM tier, then three SDM tiers, the last of which the device cannot carry.
const TUNER = [{ family: "pcm" }, { family: "sdm" }, { family: "sdm" }, { family: "sdm", unavailable: true }];
//: The SDM band runs tier 1 from a 48k-family source.
const PLAYING_1 = { run: "sdm", tier: 1, src: 0, fam: "f48" };

/**
 * `tier:family` for every rate the columns mark with `key`, in column order.
 *
 * @param {import("../../../../mockup/scripts/model/output.js").TunerColumn[]} cols
 * @param {"pinned" | "playing"} key
 * @returns {string[]}
 */
const marked = (cols, key) =>
  cols.flatMap((c) => c.cells.filter((cell) => cell[key]).map((cell) => `${c.i}:${cell.fam}`));

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

// ── tunerColumns ─────────────────────────────────────────────────────────

test("test_tuner_shows_one_column_per_tier_of_the_running_band", () => {
  assert.deepEqual(
    tunerColumns(TUNER, PLAYING_1, null, FAMS).map((c) => c.i),
    [1, 2, 3],
  );
});

test("test_tuner_column_carries_the_tier_s_unavailability", () => {
  assert.deepEqual(
    tunerColumns(TUNER, PLAYING_1, null, FAMS).map((c) => c.unavailable),
    [false, false, true],
  );
});

test("test_tuner_cells_list_the_families_in_the_order_given", () => {
  assert.deepEqual(
    tunerColumns(TUNER, PLAYING_1, null, FAMS)[0].cells.map((c) => c.fam),
    FAMS,
  );
});

test("test_tuner_marks_only_the_pinned_rate_pinned", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, PLAYING_1, { tier: 2, fam: "f44" }, FAMS), "pinned"), ["2:f44"]);
});

test("test_tuner_marks_nothing_pinned_without_a_pin", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, PLAYING_1, null, FAMS), "pinned"), []);
});

test("test_unpinned_tuner_plays_the_source_family_of_the_output_tier", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, PLAYING_1, null, FAMS), "playing"), ["1:f48"]);
});

test("test_pinned_tuner_plays_the_pin_s_family", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, PLAYING_1, { tier: 1, fam: "f44" }, FAMS), "playing"), ["1:f44"]);
});

test("test_tuner_marks_nothing_playing_without_a_source", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, { ...PLAYING_1, src: null }, null, FAMS), "playing"), []);
});

test("test_tuner_marks_nothing_playing_without_an_output_tier", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, { ...PLAYING_1, tier: null }, null, FAMS), "playing"), []);
});

test("test_tuner_never_marks_an_unavailable_tier_playing", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, { ...PLAYING_1, tier: 3 }, null, FAMS), "playing"), []);
});

test("test_tuner_never_marks_an_unavailable_tier_pinned", () => {
  assert.deepEqual(marked(tunerColumns(TUNER, PLAYING_1, { tier: 3, fam: "f48" }, FAMS), "pinned"), []);
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
