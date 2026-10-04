// Behavioral suite for mockup/scripts/model/station.js: the decisions the Station builder's steps make, each a value in
// and a value out. Which steps a record skips, what the rail and the overview read for each part, the Device step's
// filtered and grouped list, the Connection answer's limits, the Rates step's dial and 48k-family DSD readout, the
// Hardware step's questions, and the verdict of each mock check.
//
// Records, device lists, tiers, connections and step tables are tables this file writes; no shipped data supplies an
// input or an expected value.
//
// Run: node --test tests/js/mockup/station.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  stepContext,
  skipOf,
  summaryOf,
  listingState,
  deadListings,
  deviceView,
  withConnection,
  ratesPhase,
  rateView,
  dialLimits,
  hardwareView,
  optionLabel,
  ipv6Verdict,
  usbVerdict,
  dsd48Verdict,
} from "../../../../mockup/scripts/model/station.js";

/** @typedef {import("../../../../mockup/scripts/model/station.js").Rec} Rec */
/** @typedef {import("../../../../mockup/scripts/model/station.js").Hw} Hw */
/** @typedef {import("../../../../mockup/scripts/model/station.js").Iface} Iface */

//: Network listings: one host's DDC pair (two listings for one DAC), then a second host's card.
const NET = ["den: ddc: usb", "den: dac: i2s", "loft: hat: spdif"];
//: ALSA listings: two cards.
const ALSA = ["card0: hw0", "card1: hw0"];

//: A machine without a GPU or E-cores.
const CPU = /** @type {Hw} */ ({ gpu: false, ecores: false, gpus: "1" });
//: A machine with one GPU.
const GPU = /** @type {Hw} */ ({ gpu: true, ecores: false, gpus: "1" });

//: Steps whose skip rules echo what they read, so a test sees the context a step is handed.
const STEPS = [
  { id: "plain" },
  { id: "backend", skip: (/** @type {{ backend: string }} */ x) => x.backend },
  { id: "count", skip: (/** @type {{ listings: number }} */ x) => String(x.listings) },
  { id: "iface", skip: (/** @type {{ iface: string }} */ x) => x.iface },
  { id: "gpu", skip: (/** @type {{ gpu: boolean }} */ x) => (x.gpu ? "gpu" : "") },
];

//: Connections: one that fixes nothing, one that fixes PCM to tier 1 and SDM to tier 3, one without DSD.
const IFACES = /** @type {Iface[]} */ ([
  { v: "usb" },
  { v: "coax", fixed: { pcm: 1, sdm: 3, dsd: "dop", dsd48: "44k" } },
  { v: "optical", fixed: { pcm: 0, sdm: null, dsd: "dop", dsd48: "44k" } },
]);

//: Three PCM tiers, then three SDM tiers; the last one the device cannot carry.
const TIERS = [
  { family: "pcm" },
  { family: "pcm" },
  { family: "pcm" },
  { family: "sdm" },
  { family: "sdm" },
  { family: "sdm", unavailable: true },
];

//: Hardware settings Save writes: convolution offload with the E-core pool.
const POOLED = { cuda: "convolution", ecores: "pool" };
//: Hardware settings Save writes: no offload, default E-core allocation.
const PLAIN = { cuda: "0", ecores: "default" };

//: An option table.
const OPTIONS = [
  { v: "0", label: "off" },
  { v: "1", label: "on" },
];

//: The limits a device announces.
const ANNOUNCED = { pcm: 2, sdm: 4 };

/**
 * A network record with nothing answered, `over` written on top.
 *
 * @param {Partial<Rec>} [over]
 * @returns {Rec}
 */
const rec = (over = {}) => ({
  backend: "network",
  listings: [],
  resolved: null,
  ipv6: "",
  v6: "v4",
  iface: "",
  detected: false,
  limits: { pcm: 2, sdm: 4 },
  dsd: "native",
  dsd48: "44k",
  bits: 0,
  gaincomp: 0,
  volume: "",
  iso: "1",
  ...over,
});

//: The DDC pair, resolved to its second listing.
const PAIR = rec({ listings: [NET[0], NET[1]], resolved: NET[1] });

/**
 * The Device step for a record, every listing offered and nothing hidden unless `over` says so.
 *
 * @param {Partial<{ kind: string, all: string[], rec: Rec, hidden: Set<string>, naaSeen: boolean, bringUp: boolean }>} over
 */
const device = (over) => deviceView({ kind: "network", all: NET, rec: rec(), hidden: new Set(), naaSeen: true, bringUp: false, ...over });

// ── stepContext / skipOf ─────────────────────────────────────────────────

test("test_step_context_counts_the_listings_picked", () => {
  assert.equal(stepContext(rec({ listings: [NET[0], NET[1]] }), CPU).listings, 2);
});

test("test_skip_reads_the_record_backend", () => {
  assert.equal(skipOf(STEPS, "backend", rec({ backend: "alsa" }), CPU), "alsa");
});

test("test_skip_reads_the_listing_count", () => {
  assert.equal(skipOf(STEPS, "count", rec({ listings: [NET[2]] }), CPU), "1");
});

test("test_skip_reads_the_connection", () => {
  assert.equal(skipOf(STEPS, "iface", rec({ iface: "coax" }), CPU), "coax");
});

test("test_skip_reads_the_machine_gpu", () => {
  assert.equal(skipOf(STEPS, "gpu", rec(), GPU), "gpu");
});

test("test_step_without_a_skip_rule_applies", () => {
  assert.equal(skipOf(STEPS, "plain", rec({ backend: "alsa" }), CPU), "");
});

// ── summaryOf ────────────────────────────────────────────────────────────

test("test_summary_device_is_the_resolved_listing", () => {
  assert.equal(summaryOf("", PAIR, PLAIN).device, NET[1]);
});

test("test_summary_device_is_the_only_listing_picked", () => {
  assert.equal(summaryOf("", rec({ listings: [NET[2]] }), PLAIN).device, NET[2]);
});

test("test_summary_device_is_none_for_an_unresolved_pair", () => {
  assert.equal(summaryOf("", rec({ listings: [NET[0], NET[1]] }), PLAIN).device, null);
});

test("test_summary_counts_the_listings_picked", () => {
  assert.equal(summaryOf("", rec({ listings: [NET[0], NET[1]] }), PLAIN).listings, 2);
});

test("test_summary_reads_resolved_for_a_resolved_pair", () => {
  assert.equal(summaryOf("", PAIR, PLAIN).resolved, true);
});

test("test_summary_discovery_is_the_answered_value", () => {
  assert.equal(summaryOf("", rec({ ipv6: "yes", v6: "v6" }), PLAIN).discovery, "v6");
});

test("test_summary_discovery_is_none_until_ipv6_is_answered", () => {
  assert.equal(summaryOf("", rec({ v6: "v6" }), PLAIN).discovery, null);
});

test("test_summary_limits_are_none_until_connection_is_answered", () => {
  assert.equal(summaryOf("", rec(), PLAIN).limits, null);
});

test("test_summary_limits_are_the_record_limits_once_connected", () => {
  assert.deepEqual(summaryOf("", rec({ iface: "usb", limits: { pcm: 1, sdm: 5 } }), PLAIN).limits, { pcm: 1, sdm: 5 });
});

test("test_summary_bits_are_the_record_bits", () => {
  assert.equal(summaryOf("", rec({ bits: 20 }), PLAIN).bits, 20);
});

test("test_summary_gain_is_the_record_gain_compensation", () => {
  assert.equal(summaryOf("", rec({ gaincomp: -2.5 }), PLAIN).gain, -2.5);
});

test("test_summary_heavily_clipped_answer_reads_six_db_headroom", () => {
  assert.equal(summaryOf("", rec({ iso: "2" }), PLAIN).headroom, -6);
});

test("test_summary_lightly_clipped_answer_reads_three_db_headroom", () => {
  assert.equal(summaryOf("", rec({ iso: "1" }), PLAIN).headroom, -3);
});

test("test_summary_cuda_is_the_offload_save_writes", () => {
  assert.equal(summaryOf("", rec(), POOLED).cuda, "convolution");
});

test("test_summary_reads_ecores_when_save_writes_the_pool", () => {
  assert.equal(summaryOf("", rec(), POOLED).ecores, true);
});

test("test_summary_reads_no_ecores_for_the_default_allocation", () => {
  assert.equal(summaryOf("", rec(), PLAIN).ecores, false);
});

// ── listingState / deadListings ──────────────────────────────────────────

test("test_listing_left_by_a_resolved_pair_is_dead", () => {
  assert.equal(listingState(PAIR, NET[0]).dead, true);
});

test("test_resolved_listing_is_locked_in", () => {
  assert.equal(listingState(PAIR, NET[1]).locked, true);
});

test("test_resolved_listing_is_not_dead", () => {
  assert.equal(listingState(PAIR, NET[1]).dead, false);
});

test("test_picked_listing_is_on", () => {
  assert.equal(listingState(PAIR, NET[0]).on, true);
});

test("test_unpicked_listing_is_not_dead", () => {
  assert.equal(listingState(PAIR, NET[2]).dead, false);
});

test("test_dead_listings_are_those_a_resolved_pair_left", () => {
  assert.deepEqual(deadListings([PAIR, rec({ listings: [NET[2]] })]), [NET[0]]);
});

// ── deviceView ───────────────────────────────────────────────────────────

test("test_device_list_hides_a_dead_listing_the_record_did_not_pick", () => {
  assert.equal(device({ hidden: new Set([NET[0]]) }).found, 2);
});

test("test_device_list_keeps_a_dead_listing_the_record_picked", () => {
  assert.equal(device({ hidden: new Set([NET[0]]), rec: PAIR }).found, 3);
});

test("test_device_list_offers_no_naa_before_devices_are_refreshed", () => {
  assert.equal(device({ naaSeen: false }).found, 0);
});

test("test_device_step_opens_the_bring_up_when_no_naa_shows", () => {
  assert.equal(device({ naaSeen: false }).bringUp, true);
});

test("test_device_step_opens_the_bring_up_on_demand", () => {
  assert.equal(device({ bringUp: true }).bringUp, true);
});

test("test_device_step_shows_the_list_when_naas_show", () => {
  assert.equal(device({}).bringUp, false);
});

test("test_alsa_list_shows_before_devices_are_refreshed", () => {
  assert.equal(device({ kind: "alsa", all: ALSA, naaSeen: false }).found, 2);
});

test("test_alsa_step_never_opens_the_bring_up", () => {
  assert.equal(device({ kind: "alsa", all: [], bringUp: true }).bringUp, false);
});

test("test_device_list_groups_under_each_host", () => {
  assert.deepEqual(device({}).groups.map((g) => g.group), ["den", "loft"]);
});

test("test_device_row_carries_its_listing_state", () => {
  assert.equal(device({ rec: PAIR }).groups[0].rows[0].dead, true);
});

// ── withConnection ───────────────────────────────────────────────────────

test("test_fixed_connection_writes_its_limits", () => {
  assert.deepEqual(withConnection(rec(), IFACES, "coax").limits, { pcm: 1, sdm: 3 });
});

test("test_fixed_connection_writes_its_dsd_mode", () => {
  assert.equal(withConnection(rec(), IFACES, "coax").dsd, "dop");
});

test("test_open_connection_keeps_the_record_limits", () => {
  assert.deepEqual(withConnection(rec({ limits: { pcm: 2, sdm: 5 } }), IFACES, "usb").limits, { pcm: 2, sdm: 5 });
});

test("test_connection_answer_is_written", () => {
  assert.equal(withConnection(rec(), IFACES, "usb").iface, "usb");
});

test("test_connection_answer_asks_the_48k_check_again", () => {
  assert.equal(withConnection(rec({ iface: "coax", detected: true }), IFACES, "usb").detected, false);
});

test("test_connection_answer_leaves_the_record_as_it_was", () => {
  const before = rec();
  withConnection(before, IFACES, "coax");
  assert.equal(before.iface, "");
});

// ── ratesPhase ───────────────────────────────────────────────────────────

test("test_rates_wait_for_the_connection", () => {
  assert.equal(ratesPhase(rec(), undefined), "unanswered");
});

test("test_undetected_usb_owes_the_48k_check", () => {
  assert.equal(ratesPhase(rec({ iface: "usb" }), undefined), "detect");
});

test("test_running_48k_check_holds_the_rates", () => {
  assert.equal(ratesPhase(rec({ iface: "usb" }), { done: false }), "checking");
});

test("test_finished_48k_check_shows_the_rates", () => {
  assert.equal(ratesPhase(rec({ iface: "usb" }), { done: true }), "ready");
});

test("test_fixed_connection_shows_the_rates_without_a_check", () => {
  assert.equal(ratesPhase(rec({ iface: "coax" }), undefined), "ready");
});

// ── rateView ─────────────────────────────────────────────────────────────

test("test_fixed_connection_caps_pcm_above_its_tier", () => {
  assert.equal(rateView(rec({ iface: "coax" }), IFACES, TIERS).tiers[2].unavailable, true);
});

test("test_fixed_connection_leaves_its_own_pcm_tier", () => {
  assert.equal(rateView(rec({ iface: "coax" }), IFACES, TIERS).tiers[1].unavailable, false);
});

test("test_fixed_connection_caps_sdm_above_its_tier", () => {
  assert.equal(rateView(rec({ iface: "coax" }), IFACES, TIERS).tiers[4].unavailable, true);
});

test("test_connection_without_dsd_takes_the_whole_sdm_band", () => {
  assert.equal(rateView(rec({ iface: "optical", limits: { pcm: 0, sdm: null } }), IFACES, TIERS).tiers[3].unavailable, true);
});

test("test_open_connection_leaves_every_pcm_tier", () => {
  assert.equal(rateView(rec({ iface: "usb" }), IFACES, TIERS).tiers[2].unavailable, false);
});

test("test_tier_the_device_cannot_carry_stays_unavailable", () => {
  assert.equal(rateView(rec({ iface: "usb" }), IFACES, TIERS).tiers[5].unavailable, true);
});

test("test_record_without_dsd_reads_no_dsd", () => {
  assert.equal(rateView(rec({ iface: "optical", limits: { pcm: 0, sdm: null } }), IFACES, TIERS).noDsd, true);
});

test("test_dial_without_dsd_rests_the_sdm_hand_on_the_lowest_sdm_tier", () => {
  assert.equal(rateView(rec({ iface: "optical", limits: { pcm: 0, sdm: null } }), IFACES, TIERS).dial.sdm, 3);
});

test("test_dial_sdm_hand_sits_on_the_record_limit", () => {
  assert.equal(rateView(rec({ iface: "usb", limits: { pcm: 1, sdm: 4 } }), IFACES, TIERS).dial.sdm, 4);
});

test("test_dial_pcm_hand_sits_on_the_record_limit", () => {
  assert.equal(rateView(rec({ iface: "usb", limits: { pcm: 1, sdm: 4 } }), IFACES, TIERS).dial.pcm, 1);
});

test("test_48k_dsd_reads_yes_when_found", () => {
  assert.equal(rateView(rec({ iface: "usb", dsd48: "48k" }), IFACES, TIERS).dsd48, true);
});

test("test_48k_dsd_reads_no_without_dsd", () => {
  assert.equal(rateView(rec({ iface: "usb", dsd48: "48k", limits: { pcm: 1, sdm: null } }), IFACES, TIERS).dsd48, false);
});

// ── dialLimits ───────────────────────────────────────────────────────────

test("test_dial_value_sets_both_limits", () => {
  assert.deepEqual(dialLimits("2|4", false), { pcm: 2, sdm: 4 });
});

test("test_dial_value_keeps_no_dsd_on_a_record_without_it", () => {
  assert.deepEqual(dialLimits("2|4", true), { pcm: 2, sdm: null });
});

// ── hardwareView / optionLabel ───────────────────────────────────────────

test("test_gpu_questions_show_with_a_gpu", () => {
  assert.equal(hardwareView(GPU).gpu, true);
});

test("test_two_cards_need_a_gpu", () => {
  assert.equal(hardwareView({ ...CPU, gpus: "2" }).twoCards, false);
});

test("test_two_gpus_show_the_card_indices", () => {
  assert.equal(hardwareView({ ...GPU, gpus: "2" }).twoCards, true);
});

test("test_two_gpus_hide_the_power_line", () => {
  assert.equal(hardwareView({ ...GPU, gpus: "2" }).power, false);
});

test("test_one_gpu_shows_the_power_line", () => {
  assert.equal(hardwareView(GPU).power, true);
});

test("test_ecores_show_their_paragraph", () => {
  assert.equal(hardwareView({ ...CPU, ecores: true }).ecoresManual, true);
});

test("test_option_label_names_the_value", () => {
  assert.equal(optionLabel(OPTIONS, "1"), "on");
});

test("test_option_label_falls_back_to_the_value", () => {
  assert.equal(optionLabel(OPTIONS, "9"), "9");
});

// ── ipv6Verdict ──────────────────────────────────────────────────────────

test("test_ipv6_check_that_keeps_the_device_turns_discovery_to_ipv6", () => {
  assert.equal(ipv6Verdict(false).v6, "v6");
});

test("test_ipv6_check_that_loses_the_device_keeps_discovery_on_ipv4", () => {
  assert.equal(ipv6Verdict(true).v6, "v4");
});

test("test_ipv6_check_that_keeps_the_device_passes", () => {
  assert.equal(ipv6Verdict(false).ok, true);
});

// ── usbVerdict ───────────────────────────────────────────────────────────

test("test_usb_check_locks_in_the_listing_latest_in_the_list", () => {
  assert.equal(usbVerdict(null, [NET[2], NET[0]], NET).resolved, NET[2]);
});

test("test_usb_check_orders_by_the_list_not_by_the_pick", () => {
  assert.equal(usbVerdict(null, [NET[1], NET[0]], NET).resolved, NET[1]);
});

test("test_usb_check_passes_without_a_failure", () => {
  assert.equal(usbVerdict(null, [NET[0], NET[1]], NET).ok, true);
});

test("test_failed_usb_check_locks_in_nothing", () => {
  assert.equal(usbVerdict("gone", [NET[0], NET[1]], NET).resolved, null);
});

// ── dsd48Verdict ─────────────────────────────────────────────────────────

test("test_48k_check_that_finds_48k_dsd_reads_48k", () => {
  assert.equal(dsd48Verdict(rec(), true, ANNOUNCED).dsd48, "48k");
});

test("test_48k_check_that_finds_none_reads_44k", () => {
  assert.equal(dsd48Verdict(rec({ dsd48: "48k" }), false, ANNOUNCED).dsd48, "44k");
});

test("test_48k_check_marks_the_record_detected", () => {
  assert.equal(dsd48Verdict(rec(), true, ANNOUNCED).detected, true);
});

test("test_48k_check_writes_native_dsd", () => {
  assert.equal(dsd48Verdict(rec({ dsd: "dop" }), true, ANNOUNCED).dsd, "native");
});

test("test_48k_check_writes_the_announced_limits", () => {
  assert.deepEqual(dsd48Verdict(rec({ limits: { pcm: 0, sdm: null } }), true, ANNOUNCED).limits, ANNOUNCED);
});
