// Behavioral suite for store/devicecaps.js — graying the rate menus and the
// mode segment against what the SELECTED OUTPUT DEVICE can actually carry.
//
// The daemon does not report device capability; HQPTuner learns it from the
// log and serves it on /api/config as `device_caps`:
//
//   { device: "naa-office/hw:CARD=…,DEV=0", pcm_rates: [...], dsd_rates: [...] }
//
// `null` when nothing is known. Rates on the wire are INTEGERS while option
// values are STRINGS, so every fixture below leaves them in their real types
// and every menu lookup here compares STRICTLY — a suite that coerced with
// String() would read the same whether the menu carried "192000" or 192000,
// and so would pin nothing about the join.
//
// The menus name a TIER, not a frequency: every tier has a 44.1k member and a
// 48k member and the option's value carries the 48k one, so 192000 is the 4x
// tier and also means 176400. A device that announced EITHER member can play
// the tier, which is why the cases below announce some tiers by their 44.1k
// twin alone.
//
// DoP (v1.1) carries DSD inside a PCM carrier at one sixteenth of the DSD rate
// — DSD64 needs 176400, DSD128 needs 352800. Nothing on the wire reports
// whether a device supports DoP, so the user's own switch (`net_dop` on the
// network backend, `alsa_dop` on ALSA) is the only signal there is, and these
// fixtures supply it as an ordinary config field. The two switches are pinned
// in both directions: each fixture that turns one on turns the other off, so a
// store reading `net_dop || alsa_dop` fails rather than passing everywhere.
//
// Graying reacts to STAGED values, not applied ones (architecture.md §5), so
// the last two cases drive the real `edit()` against a staging wire and expect
// the menus to move with no apply and no change to the config payload.
//
// Every grayed RATE option reads exactly "unavailable" — one word, both menus,
// all three routes to a gray (past the device's PCM ceiling, no native DSD, no
// DoP carrier), because the reason renders appended to the option's own label
// inside a third-width dropdown. The MODE segment is the exception and keeps
// its full sentence: it is a button with room for one, and the only place that
// still explains why.
//
// The governing principle throughout: when the capability cannot speak for the
// control, NOTHING is grayed — combo backend, a staged device the daemon has
// not opened, no capability at all. And what is grayed is still LISTED: a
// vanished entry reads as "this build does not support it", a grayed one as
// "your hardware cannot do it", so every named tier comes back present.
//
// Policy (docs/testing.md): public API only, one assertion per test, no store
// function stubbed — the exported `config` signal carries the /api/config
// payload exactly as the endpoint serves it, and the staged buffer is reached
// through `edit()` / `discardAll()` over the real REST paths.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/devicecaps.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { DSD_RATES, schema } from "../../../hqptuner/static/store/schema.js";
import { grayRatesByDevice, grayModesByDevice } from "../../../hqptuner/static/store/devicecaps.js";
import { stagingWire } from "../support/wire.js";

// Tier menu members, 48k side — the numbers the options carry, as strings.
const PCM_2X = "96000";
const PCM_4X = "192000";
const PCM_8X = "384000";
const PCM_16X = "768000";
const PCM_32X = "1536000";
const DSD64 = "3072000";
const DSD128 = "6144000";
const DSD256 = "12288000";
const DSD512 = "24576000";

// The tiers each menu is required to offer, named here rather than counted off
// the menu itself: an expectation built from the array under test degenerates
// to a tautology the moment that array changes or empties.
const PCM_TIERS = ["48000", PCM_2X, PCM_4X, PCM_8X, PCM_16X, PCM_32X];
const DSD_TIERS = [DSD64, DSD128, DSD256, DSD512, "49152000", "98304000"];

const PCM_OPTIONS = schema.pcm_rate.options;
const MODE_OPTIONS = schema.output_mode.options;

// A net_device is an `endpoint/device` pair as one string; an alsa_device is a
// bare ALSA name. The capability's `device` carries the same joined form the
// corresponding config field does, so the two are deliberately unalike here:
// a store matching against the wrong field finds no match and grays nothing.
const NET_DEVICE = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
const OTHER_NET_DEVICE = "S26/hw:CARD=Output,DEV=0";
const ALSA_DEVICE = "hw:CARD=NVidia,DEV=3";

// What the log-derived capability looks like on the wire: integers, both
// families, the device it was observed on.
const caps = (device, pcmRates, dsdRates) => ({
  device,
  pcm_rates: pcmRates,
  dsd_rates: dsdRates,
});

// A device topping out at 192 kHz. 88200/176400 are announced but 96000 is
// too, so the 2x tier is answered by its own 48k member and only the 4x tier
// rests on its 44.1k twin.
const PCM_TO_192 = [44100, 48000, 88200, 96000, 176400, 192000];

// The same device announcing 176400 but NOT 192000: the 4x tier is then
// reachable only through the 44.1k member the option's value does not carry.
const PCM_TO_176 = [44100, 48000, 88200, 96000, 176400];

// A yield long enough for the fall-back effect to run and for the staged edit
// it makes to complete its round trip over the wire. Not a wall-clock wait:
// zero-delay turns of the loop, so the suite pins what the effect concludes,
// never how long it takes.
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// The whole /api/config payload, plus an empty staged buffer, and the returned
// staging wire holds the pending buffer the way the backend does — so `edit()`
// and the store's own corrective edit both ride the real REST path and both
// read back through `w.staged`.
//
// Every field the graying reads is present in every fixture, so a case never
// passes because the field it should have consulted was simply absent.
// Checkbox fields carry the daemon's own shape — real booleans — except where
// a case names the staged "1"/"0" strings. The three CONTROL values are seeded
// only when a case names one, and are mirrored into `file` as well as `fields`:
// the running-config layer is the truth for controls whose edits go out live,
// and liverate.test.js seeds the rate pair the same way.
//
// The buffer is cleared BEFORE the fixture payload lands, never after: the
// correction is an effect on the capability and the current values, so a
// discard afterwards would wipe the very thing these cases measure.
async function reset({
  backend = "network",
  netDevice = NET_DEVICE,
  alsaDevice = ALSA_DEVICE,
  netDop = false,
  alsaDop = false,
  deviceCaps = null,
  pcmRate,
  sdmRate,
  mode,
} = {}) {
  const w = stagingWire();
  config.value = { fields: [], file: {}, active: "", profiles: null, device_caps: null };
  await discardAll();

  const fields = [
    { name: "backend", value: backend },
    { name: "net_device", value: netDevice },
    { name: "alsa_device", value: alsaDevice },
    { name: "net_dop", value: netDop },
    { name: "alsa_dop", value: alsaDop },
  ];
  const file = {};
  const control = (name, value) => {
    if (value === undefined) return;
    fields.push({ name, value });
    file[name] = value;
  };
  control("defaults_samplerate", pcmRate);
  control("defaults_bitrate", sdmRate);
  control("mode", mode);

  config.value = { fields, file, active: "", profiles: null, device_caps: deviceCaps };
  await tick();
  return w;
}

// --- reading the narrowed menus -----------------------------------------------

// An entry by the tier it names, matched strictly against the string the menu
// is required to carry. A miss throws rather than quietly measuring nothing:
// an option list that has LOST an entry — or drifted to numeric values — must
// fail loudly, since dropping what the device cannot reach is exactly the
// behaviour house policy forbids.
function optionFor(options, value) {
  const hit = options.find((o) => o.value === value);
  if (!hit) throw new Error(`the menu offers no ${value} entry`);
  return hit;
}

// The two marks an entry can carry, read as a pair: whether it can be picked
// and what it says about itself. An entry disabled without a reason leaves the
// user guessing; a reason on a selectable entry grays nothing.
const marks = (o) => [o.disabled === true, typeof o.reason === "string" && o.reason.length > 0];
const GRAYED = [true, true];
const UNTOUCHED = [false, false];

const markedCount = (options) => options.filter((o) => o.disabled || o.reason).length;

// The named tiers that came back grayed / untouched, in the order named. Read
// against the full tier list, a short or reordered answer names which tier
// went the wrong way.
const grayedAmong = (options, tiers) => tiers.filter((v) => optionFor(options, v).disabled === true);
const untouchedAmong = (options, tiers) =>
  tiers.filter((v) => !optionFor(options, v).disabled && !optionFor(options, v).reason);

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
  // The other half of the judgement: a store that grayed its whole menu passes
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
  assert.match(optionFor(out, "sdm").reason, /dsd/i);
});

test("test_the_reason_on_a_grayed_sdm_mode_points_at_dop", async () => {
  // The other half: naming the problem without naming the way out leaves the
  // user with a dead button and no next move.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.match(optionFor(out, "sdm").reason, /dop/i);
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

// --- graying reacts to staged values, not applied ones ------------------------
// architecture.md §5. The config payload never moves in these two: the only
// thing that changes is the pending buffer, and the menus follow it.

test("test_staging_a_dop_edit_relights_the_sdm_mode_without_an_apply", async () => {
  // The daemon's form says DoP is off and the device has no native DSD, so the
  // SDM button starts grayed. Ticking the box has to relight it there and then
  // — a store reading the applied form alone leaves the user staring at a dead
  // button until apply.
  await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false });
  await edit("net_dop", "1");
  const out = grayModesByDevice(MODE_OPTIONS);
  assert.deepEqual(marks(optionFor(out, "sdm")), UNTOUCHED);
});

test("test_staging_a_device_change_grays_no_pcm_tier", async () => {
  // The capability describes the device the daemon has open, which is still
  // what the config payload names; the user has picked a different one. Until
  // that is applied and observed, nothing is known about its limits.
  await reset({ netDevice: NET_DEVICE, deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  await edit("net_device", OTHER_NET_DEVICE);
  assert.equal(markedCount(grayRatesByDevice(PCM_OPTIONS, "pcm")), 0);
});

// --- falling back off a selection the device cannot reach ---------------------
// Graying an option the user cannot click is half the job: the setting may
// already SIT on one, carried in from a preset, from a previous device, or from
// unticking DoP on a device whose only DSD path was DoP. The store corrects it
// as an ordinary STAGED edit — visible in the pending bar, discardable, and
// never a display-only substitution, because the editor has to show what would
// actually apply. So each case below reads the correction off the same pending
// buffer an `edit()` writes to, and every staged value is a string.

test("test_a_pcm_rate_the_device_cannot_reach_falls_back_to_its_highest_announced_tier", async () => {
  // The form says 32x on a device that tops out at 192 kHz.
  const w = await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), mode: "pcm", pcmRate: "1536000" });
  assert.equal(w.staged.http.defaults_samplerate, "192000");
});

test("test_an_sdm_rate_the_device_cannot_reach_falls_back_to_its_highest_announced_tier", async () => {
  const w = await reset({
    deviceCaps: caps(NET_DEVICE, PCM_TO_192, [3072000, 6144000, 12288000]),
    mode: "sdm",
    sdmRate: "49152000",
  });
  assert.equal(w.staged.http.defaults_bitrate, "12288000");
});

test("test_a_pcm_rate_the_device_can_reach_is_left_alone", async () => {
  // Otherwise the correction fires on every load and the pending bar is never
  // empty.
  const w = await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), mode: "pcm", pcmRate: "96000" });
  assert.deepEqual(w.staged.http, {});
});

test("test_with_no_capability_known_an_unreachable_looking_rate_is_left_alone", async () => {
  // Unknown capability corrects nothing, exactly as it grays nothing.
  const w = await reset({ deviceCaps: null, mode: "pcm", pcmRate: "1536000" });
  assert.deepEqual(w.staged.http, {});
});

test("test_the_sdm_mode_is_left_alone_while_dop_still_gives_the_device_a_dsd_path", async () => {
  // First half of the DoP case: no native DSD, but DoP is on and the 176.4 kHz
  // carrier is announced, so SDM is reachable and there is nothing to correct.
  const w = await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: true, mode: "sdm" });
  assert.deepEqual(w.staged.http, {});
});

test("test_unticking_dop_falls_the_mode_back_to_pcm", async () => {
  // Second half: the only DSD path this device had was DoP, and the user has
  // just switched it off. SDM stops being reachable, so the mode goes with it.
  const w = await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: true, mode: "sdm" });
  await edit("net_dop", "0");
  await tick();
  assert.equal(w.staged.http.mode, "pcm");
});

test("test_the_pcm_mode_is_never_corrected", async () => {
  // The device has no DSD path at all, which grays SDM — but PCM is what the
  // mode already sits on, and nothing about a missing DSD path makes PCM
  // unreachable.
  const w = await reset({ deviceCaps: caps(NET_DEVICE, PCM_TO_192, []), netDop: false, mode: "pcm" });
  assert.equal("mode" in w.staged.http, false);
});

test("test_an_sdm_rate_is_left_alone_when_the_device_can_reach_no_dsd_rate_at_all", async () => {
  // There is no reachable tier to fall back TO, so falling back onto one would
  // stage a rate the device cannot play either. The mode correction is what
  // handles this case.
  const w = await reset({
    deviceCaps: caps(NET_DEVICE, PCM_TO_192, []),
    netDop: false,
    mode: "sdm",
    sdmRate: "49152000",
  });
  assert.equal("defaults_bitrate" in w.staged.http, false);
});
