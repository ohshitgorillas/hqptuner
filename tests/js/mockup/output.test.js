// Behavioral suite for mockup/scripts/model/output.js: which tiers belong to a rate family, how an engine device string
// splits into its group, main and detail parts, how a device list falls under its group headers, and where a value sits
// along a range as a percentage.
//
// Tiers and device lists are tables the test writes; no shipped data supplies an input or an expected value.
//
// Run: node --test tests/js/mockup/output.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { deviceParts, groupDevices, percentOf, tierIndex } from "../../../mockup/scripts/model/output.js";
import { near } from "../support/near.js";

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
  assert.deepEqual(groupDevices("network", NET).map((g) => g.group), ["den", "attic"]);
});

test("test_a_card_that_returns_after_another_gets_a_new_header", () => {
  assert.deepEqual(groupDevices("alsa", ALSA).map((g) => g.group), ["card0", "card1", "card0"]);
});

test("test_a_group_holds_the_list_positions_of_its_devices", () => {
  assert.deepEqual(groupDevices("alsa", ALSA)[0].rows.map((r) => r.i), [0, 1]);
});

test("test_a_returning_group_holds_its_own_list_position", () => {
  assert.deepEqual(groupDevices("alsa", ALSA)[2].rows.map((r) => r.i), [3]);
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
