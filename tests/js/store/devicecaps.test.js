// Behavioral suite for store/narrow/devicecaps.js — graying the rate menus and the
// mode segment against what the SELECTED OUTPUT DEVICE can actually carry.
//
// The other half of the contract, correcting a setting that already SITS on
// something the device cannot reach, is devicecaps-fallback.test.js. The
// fixtures, the capability shapes and the menu-reading helpers both suites run
// on live in ../support/devicecaps-harness.js.
//
// A device that announced EITHER member of a tier can play that tier, which is
// why some cases below announce a tier by its 44.1k twin alone.
//
// DoP (v1.1) carries DSD inside a PCM carrier at one sixteenth of the DSD rate
// — DSD64 needs 176400, DSD128 needs 352800. Nothing on the wire reports
// whether a device supports DoP, so the user's own switch (`net_dop` on the
// network backend, `alsa_dop` on ALSA) is the only signal there is, and the
// fixtures supply it as an ordinary config field. The two switches are pinned
// in both directions: each fixture that turns one on turns the other off, so a
// store reading `net_dop || alsa_dop` fails rather than passing everywhere.
//
// Every grayed RATE option reads exactly "unavailable" — one word, both menus,
// all three routes to a gray (past the device's PCM ceiling, no native DSD, no
// DoP carrier), because the reason renders appended to the option's own label
// inside a third-width dropdown. The MODE segment is the exception and keeps
// its full sentence: it is a button with room for one, and the only place that
// still explains why.
//
// The governing principle throughout: when the capability cannot speak for the
// control, NOTHING is grayed — combo backend, a device the announcement does
// not describe, no capability at all. And what is grayed is still LISTED: a
// vanished entry reads as "this build does not support it", a grayed one as
// "your hardware cannot do it", so every named tier comes back present.
//
// Policy (docs/testing.md): public API only, one assertion per test, no store
// function stubbed — the exported `config` signal carries the /api/config
// payload exactly as the endpoint serves it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/devicecaps.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { DSD_RATES } from "../../../hqptuner/static/store/schema.js";
import { grayRatesByDevice, grayModesByDevice } from "../../../hqptuner/static/store/narrow/devicecaps.js";
import {
  ALSA_DEVICE,
  DSD64,
  DSD128,
  DSD256,
  DSD512,
  DSD_TIERS,
  GRAYED,
  MODE_OPTIONS,
  NET_DEVICE,
  OTHER_NET_DEVICE,
  PCM_16X,
  PCM_2X,
  PCM_32X,
  PCM_4X,
  PCM_8X,
  PCM_OPTIONS,
  PCM_TIERS,
  PCM_TO_176,
  PCM_TO_192,
  UNTOUCHED,
  caps,
  grayedAmong,
  markedCount,
  marks,
  optionFor,
  reset,
  untouchedAmong,
} from "../support/devicecaps-harness.js";

// `reason` is optional on a MenuOption in general — untouched entries carry
// none — but a case reading it here is always past an assertion that the
// option WAS grayed, so it is always present by the time this runs.
/**
 * @param {import("../support/devicecaps-harness.js").MenuOption[]} options
 * @param {string} value
 * @returns {string}
 */
function reasonOf(options, value) {
  const reason = optionFor(options, value).reason;
  if (reason === undefined) throw new Error(`no reason on ${value}`);
  return reason;
}

// --- the menus' own shape -----------------------------------------------------

test("test_the_pcm_tier_menu_carries_its_values_as_strings", () => {
  // The capability's rates are integers. If the menu ever drifts to numbers,
  // every join in this file starts leaning on coercion — that fails here first.
  assert.deepEqual(new Set(PCM_OPTIONS.map((o) => typeof o.value)), new Set(["string"]));
});

// --- the PCM rate menu against the capability ---------------------------------

test("test_a_pcm_tier_above_what_the_device_announced_is_grayed", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(marks(optionFor(out, PCM_8X)), GRAYED);
});

test("test_every_pcm_tier_above_what_the_device_announced_is_grayed", async () => {
  // A store graying exactly one tier past the cap passes the case above.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(grayedAmong(out, [PCM_8X, PCM_16X, PCM_32X]), [PCM_8X, PCM_16X, PCM_32X]);
});

test("test_a_pcm_tier_grayed_by_the_devices_ceiling_reads_unavailable", async () => {
  // One word, whatever made the tier unreachable: the reason renders appended
  // to the option's own label inside a third-width dropdown, with no room for
  // a sentence. The mode segment is the only place that still explains why.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.equal(optionFor(out, PCM_8X).reason, "unavailable");
});

test("test_a_pcm_tier_the_device_announced_is_not_grayed", async () => {
  // The other half of the judgment: a store that grayed its whole menu passes
  // the cases above and fails this one.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(marks(optionFor(out, PCM_2X)), UNTOUCHED);
});

test("test_the_pcm_tier_sitting_exactly_at_the_announced_cap_is_not_grayed", async () => {
  // The boundary: 192000 is announced, so the 4x tier is reachable. An
  // off-by-one comparison grays the rate the device actually tops out at.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(marks(optionFor(out, PCM_4X)), UNTOUCHED);
});

test("test_a_pcm_tier_announced_only_by_its_44_1k_member_is_not_grayed", async () => {
  // The device announced 176400 and never 192000, and the 4x option's value
  // carries 192000. A store matching the option's own number against the
  // announcement grays a tier the device can play on every 44.1 kHz track.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_176, []) });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(marks(optionFor(out, PCM_4X)), UNTOUCHED);
});

test("test_graying_the_pcm_menu_still_offers_every_tier", async () => {
  // Grayed entries stay LISTED. A store that filtered instead of graying loses
  // three of these six.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(
    PCM_TIERS.filter((v) => out.some((o) => o.value === v)),
    PCM_TIERS,
  );
});

test("test_graying_leaves_the_option_objects_it_was_given_unmarked", async () => {
  // The menus are module-level arrays shared by every caller. An in-place
  // implementation would make every "untouched" case above order-dependent.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(untouchedAmong(PCM_OPTIONS, PCM_TIERS), PCM_TIERS);
});

// --- the DSD rate menu against a native DSD capability ------------------------

test("test_a_native_dsd_tier_the_device_announced_is_not_grayed", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, [3072000, 6144000]) });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD128)), UNTOUCHED);
});

test("test_a_native_dsd_tier_the_device_did_not_announce_is_grayed", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, [3072000, 6144000]) });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD256)), GRAYED);
});

test("test_a_dsd_tier_grayed_for_want_of_native_dsd_reads_unavailable", async () => {
  // Second of the three routes to a gray. A store that grew a chattier reason
  // for any one of them fails here.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, [3072000, 6144000]) });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.equal(optionFor(out, DSD256).reason, "unavailable");
});

test("test_a_dsd_tier_announced_only_by_its_44_1k_member_is_not_grayed", async () => {
  // 22579200 is DSD512's 44.1k twin; the option's value is 24576000.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, [22579200]) });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD512)), UNTOUCHED);
});

// --- no native DSD path -------------------------------------------------------

test("test_with_no_native_dsd_and_dop_off_every_dsd_tier_is_grayed", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(grayedAmong(out, DSD_TIERS), DSD_TIERS);
});

test("test_with_dop_on_dsd64_is_not_grayed_when_the_device_announced_its_carrier", async () => {
  // DoP v1.1 sends DSD64 inside a 176.4 kHz PCM carrier, which PCM_TO_192
  // announces.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: true });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD64)), UNTOUCHED);
});

test("test_with_dop_on_dsd128_is_grayed_when_its_carrier_is_not_announced", async () => {
  // DSD128's carrier is 352800, which a 192 kHz device does not reach.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: true });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD128)), GRAYED);
});

test("test_a_dsd_tier_grayed_for_want_of_a_dop_carrier_reads_unavailable", async () => {
  // The third route to a gray, pinned to the same one word as the other two.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: true });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.equal(optionFor(out, DSD128).reason, "unavailable");
});

test("test_a_dop_switch_staged_as_the_string_one_counts_as_on", async () => {
  // The daemon's form serves booleans; a staged edit is the string "1".
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: "1" });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD64)), UNTOUCHED);
});

test("test_a_dop_switch_staged_as_the_string_zero_counts_as_off", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: "0" });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD64)), GRAYED);
});

// --- the mode segment ---------------------------------------------------------

test("test_the_sdm_mode_is_grayed_when_the_device_has_no_dsd_path", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.deepEqual(marks(optionFor(out, "sdm")), GRAYED);
});

test("test_the_reason_on_a_grayed_sdm_mode_says_the_device_has_no_dsd_path", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.match(reasonOf(out, "sdm"), /dsd/i);
});

test("test_the_reason_on_a_grayed_sdm_mode_points_at_dop", async () => {
  // The other half: naming the problem without naming the way out leaves the
  // user with a dead button and no next move.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.match(reasonOf(out, "sdm"), /dop/i);
});

test("test_the_pcm_mode_is_not_grayed_when_the_device_has_no_dsd_path", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.deepEqual(marks(optionFor(out, "pcm")), UNTOUCHED);
});

test("test_the_auto_mode_is_not_grayed_when_the_device_has_no_dsd_path", async () => {
  // In auto the engine picks the family per track and settles on PCM by
  // itself, so nothing is unreachable and there is nothing to warn about.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.deepEqual(marks(optionFor(out, "auto")), UNTOUCHED);
});

test("test_the_sdm_mode_is_not_grayed_when_dop_gives_the_device_a_dsd_path", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: true });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.deepEqual(marks(optionFor(out, "sdm")), UNTOUCHED);
});

test("test_the_sdm_mode_is_not_grayed_when_the_device_announced_native_dsd", async () => {
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, [3072000]), netDop: false });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.deepEqual(marks(optionFor(out, "sdm")), UNTOUCHED);
});

// --- when the capability cannot speak for the control -------------------------

test("test_with_no_capability_known_the_pcm_rate_menu_is_untouched", async () => {
  await reset({ deviceCaps: null });
  assert.equal(markedCount(grayRatesByDevice(PCM_OPTIONS, "pcm")), 0);
});

test("test_with_no_capability_known_the_mode_segment_is_untouched", async () => {
  await reset({ deviceCaps: null });
  assert.equal(markedCount(grayModesByDevice(MODE_OPTIONS)), 0);
});

test("test_with_no_capability_known_the_dsd_rate_menu_is_untouched", async () => {
  await reset({ deviceCaps: null });
  assert.equal(markedCount(grayRatesByDevice(DSD_RATES, "sdm")), 0);
});

test("test_the_combo_backend_grays_no_pcm_tier", async () => {
  // Combo drives two devices and the announcement covers one, so which limits
  // bind is unknown. The same capability grays three tiers on `network`.
  await reset({ backend: "combo", deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  assert.equal(markedCount(grayRatesByDevice(PCM_OPTIONS, "pcm")), 0);
});

test("test_an_applied_device_the_capability_does_not_describe_grays_no_pcm_tier", async () => {
  // The announcement describes some other device entirely; narrowing to it
  // would gray rates the selected one may well support.
  await reset({ netDevice: OTHER_NET_DEVICE, deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  assert.equal(markedCount(grayRatesByDevice(PCM_OPTIONS, "pcm")), 0);
});

// --- which field answers for the device, and which for DoP --------------------

test("test_the_alsa_backend_matches_the_capability_against_the_alsa_device", async () => {
  // net_device names something else entirely; a store reading it here matches
  // nothing and grays nothing.
  await reset({
    backend: "alsa",
    netDevice: OTHER_NET_DEVICE,
    alsaDevice: ALSA_DEVICE,
    deviceCaps: caps(ALSA_DEVICE, PCM_TO_192, []),
  });
  const out = grayRatesByDevice(PCM_OPTIONS, "pcm");
  assert.deepEqual(marks(optionFor(out, PCM_8X)), GRAYED);
});

test("test_the_alsa_backend_ignores_a_capability_matching_only_the_net_device", async () => {
  // The mirror: the announcement describes the network device while ALSA is
  // the selected backend, so it cannot speak for the ALSA device at all.
  await reset({
    backend: "alsa",
    netDevice: NET_DEVICE,
    alsaDevice: ALSA_DEVICE,
    deviceCaps: caps(NET_DEVICE, PCM_TO_192, []),
  });
  assert.equal(markedCount(grayRatesByDevice(PCM_OPTIONS, "pcm")), 0);
});

test("test_the_alsa_backend_answers_the_dop_question_with_alsa_dop", async () => {
  await reset({
    backend: "alsa",
    alsaDevice: ALSA_DEVICE,
    alsaDop: true,
    netDop: false,
    deviceCaps: caps(ALSA_DEVICE, PCM_TO_192, []),
  });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD64)), UNTOUCHED);
});

test("test_the_alsa_backend_does_not_take_net_dop_for_its_own", async () => {
  // The network backend's switch is on and ALSA's is off, so the selected ALSA
  // device has no DSD path.
  await reset({
    backend: "alsa",
    alsaDevice: ALSA_DEVICE,
    alsaDop: false,
    netDop: true,
    deviceCaps: caps(ALSA_DEVICE, PCM_TO_192, []),
  });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD64)), GRAYED);
});

test("test_the_network_backend_does_not_take_alsa_dop_for_its_own", async () => {
  // The mirror of the case above, and the one that catches `net_dop ||
  // alsa_dop`: the ALSA switch is on, the network switch is off, and the
  // selected network device therefore has no DSD path.
  await reset({
    backend: "network",
    netDevice: NET_DEVICE,
    netDop: false,
    alsaDop: true,
    deviceCaps: caps(NET_DEVICE, PCM_TO_192, []),
  });
  const out = grayRatesByDevice(DSD_RATES, "sdm");
  assert.deepEqual(marks(optionFor(out, DSD64)), GRAYED);
});
