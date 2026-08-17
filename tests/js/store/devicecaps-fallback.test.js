// Behavioral suite for store/narrow/devicecaps.js — the half of the contract that
// MOVES a setting rather than graying one.
//
// Graying an option the user cannot click is only half the job: the setting may
// already SIT on one, carried in from a preset, from a previous device, or from
// unticking DoP on a device whose only DSD path was DoP. The store corrects it
// as an ordinary STAGED edit — visible in the pending bar, discardable, and
// never a display-only substitution, because the editor has to show what would
// actually apply. So every case here reads the correction off the same pending
// buffer an `edit()` writes to, and every staged value is a string.
//
// Which menus gray for which capability is devicecaps.test.js; the fixtures and
// the menu-reading helpers both suites run on live in
// ../support/devicecaps-harness.js. The controls are seeded by their real
// config field names — `defaults_samplerate` and `defaults_bitrate` (the LIMIT
// slots; `samplerate` / `bitrate` are forced to 0 on every write,
// docs/settings-classification.md:42) and `mode`.
//
// The first two cases pin the other direction of the same reactivity: graying
// follows STAGED values, not applied ones (architecture.md §5), so the menus
// move the moment the user ticks a box, with no apply and no change to the
// config payload.
//
// Policy (docs/testing.md): public API only, one assertion per test, no store
// function stubbed — the correction is an effect, so it is triggered by seeding
// the payload and awaiting a tick, never by calling into internals.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/devicecaps-fallback.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { edit } from "../../../hqptuner/static/store/actions.js";
import { grayRatesByDevice, grayModesByDevice } from "../../../hqptuner/static/store/narrow/devicecaps.js";
import {
  MODE_OPTIONS,
  NET_DEVICE,
  OTHER_NET_DEVICE,
  PCM_OPTIONS,
  PCM_TO_192,
  UNTOUCHED,
  caps,
  markedCount,
  marks,
  optionFor,
  reset,
  tick,
} from "../support/devicecaps-harness.js";

// --- graying reacts to staged values, not applied ones ------------------------

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
