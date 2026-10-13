// Behavioral suite for hqptuner/static/store/faceplate/drawers/output.js, the Output drawer's store half: the rate
// dial's tiers with their needles, hatch, playing lamp and dirty bands, a pick on a band, the layout a channel count
// reads as and a pick on the layout segment, and the device picker's rows over a backend's device list.
//
// The store is driven at the wire: a staging fake answers the real REST paths (tests/js/support/wire/wire.js) and the
// source signals are assigned the shapes their endpoints serve. Rates are the daemon's own option values and the
// device strings are the 6.0.4 config form's (tests/support/fixtures/config-form-6.0.4.html); a tier's position counts
// both families in rate order, 1x first.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-output.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, engineState, engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import {
  channelLayout,
  deviceView,
  dialView,
  pickChannelLayout,
  pickDevice,
  pickTier,
} from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const STANDA = "naa-7bdbb6cb/hw:CARD=Standa,DEV=0";
const OFFICE = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
const NET_OPTIONS = [
  { value: "S26/hw:CARD=Output,DEV=0", label: "S26: Gustard Digital Output: USB Audio" },
  { value: "naa-7bdbb6cb/hw:CARD=RED,DEV=0", label: "naa-7bdbb6cb: Holo Audio UAC2.0 Gen2 - RED: USB Audio" },
  { value: STANDA, label: "naa-7bdbb6cb: Holo Audio UAC2.0 Gen2.1 Standa: USB Audio" },
  { value: OFFICE, label: "naa-office: snd_rpi_hifiberry_digi: HiFiBerry Digi+ Pro HiFi wm8804-spdif-0" },
];
const ALSA_OPTIONS = [
  { value: "hw:CARD=NVidia,DEV=3", label: "HDA NVidia: HDMI 0" },
  { value: "hw:CARD=NVidia,DEV=7", label: "HDA NVidia: HDMI 1" },
];

/** Every rate the 2048x tier leaves out: the device announces 1x to 1024x, both members of each. */
const CAPS = {
  device: STANDA,
  pcm_rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000],
  dsd_rates: [2822400, 3072000, 5644800, 6144000, 11289600, 12288000, 22579200, 24576000, 45158400, 49152000],
};

/** @type {StagingWire} */
let wire;

/**
 * Load the /config payload, the named form values over the defaults.
 *
 * @param {{ pcm?: string, sdm?: string, channels?: number, device?: string, caps?: object | null }} [over]
 */
function load({ pcm = "192000", sdm = "12288000", channels = 2, device = STANDA, caps = null } = {}) {
  config.value = {
    fields: [
      { name: "defaults_samplerate", type: "select", value: pcm },
      { name: "defaults_bitrate", type: "select", value: sdm },
      { name: "mode", type: "select", value: "pcm" },
      { name: "backend", type: "select", value: "network" },
      { name: "net_dop", type: "checkbox", value: false },
      { name: "net_device", type: "select", value: device, options: NET_OPTIONS },
      { name: "alsa_device", type: "select", value: ALSA_OPTIONS[0].value, options: ALSA_OPTIONS },
      { name: "channels", type: "number", value: channels },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: caps,
  };
}

beforeEach(async () => {
  wire = stagingWire();
  load();
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = null;
  await pickChannelLayout("2");
  await discardAll();
  wire.stages = [];
});

test("test_each_needle_sits_on_its_bands_limit_tier", () => {
  assert.deepEqual(dialView().limits, { pcm: 2, sdm: 8 });
});

test("test_a_staged_rate_moves_its_needle", async () => {
  await edit("pcm_rate", "768000");
  assert.equal(dialView().limits.pcm, 4);
});

test("test_a_limit_on_the_44k_member_reads_as_its_tier", () => {
  load({ pcm: "176400", sdm: "11289600" });
  assert.deepEqual(dialView().limits, { pcm: 2, sdm: 8 });
});

test("test_the_sdm_family_starts_at_the_seventh_tier", () => {
  const fams = dialView().tiers.map((t) => t.family);
  assert.equal(fams.indexOf("sdm"), 6);
});

test("test_the_pcm_family_ends_at_the_sixth_tier", () => {
  const fams = dialView().tiers.map((t) => t.family);
  assert.equal(fams.lastIndexOf("pcm"), 5);
});

test("test_only_a_tier_the_device_did_not_announce_is_hatched", () => {
  const hatched = () =>
    dialView()
      .tiers.filter((t) => t.unavailable)
      .map((t) => t.value);
  load({ caps: CAPS });
  assert.deepEqual(hatched(), ["98304000"]);
});

const at = (/** @type {string} */ rate) => {
  engineStatus.value = { status: { active_rate: rate }, metadata: {} };
  return dialView().playing;
};

test("test_the_playing_lamp_sits_on_a_running_pcm_rates_tier", () => {
  assert.equal(at("352800"), 3);
});

test("test_the_playing_lamp_sits_on_a_running_sdm_rates_tier", () => {
  assert.equal(at("12288000"), 8);
});

test("test_the_playing_lamp_sits_on_a_running_48k_family_rates_tier", () => {
  engineStatus.value = { status: { active_rate: "96000" }, metadata: {} };
  assert.equal(dialView().playing, 1);
});

test("test_a_pick_stages_the_tiers_rate_on_its_bands_key", async () => {
  await pickTier("sdm", 10);
  assert.equal(effective("sdm_rate"), "49152000");
});

test("test_a_pick_past_the_seam_stops_at_the_bands_last_tier", async () => {
  await pickTier("pcm", 9);
  assert.equal(effective("pcm_rate"), "1536000");
});

test("test_a_pick_on_the_needles_own_tier_stages_nothing", async () => {
  await pickTier("pcm", 2);
  await pickTier("pcm", 3);
  assert.equal(wire.stages.length, 1);
});

test("test_only_the_band_with_a_staged_rate_reads_dirty", async () => {
  await pickTier("sdm", 9);
  assert.deepEqual(dialView().dirty, { pcm: false, sdm: true });
});

test("test_a_layout_pick_stages_its_channel_count", async () => {
  await pickChannelLayout("8");
  assert.equal(effective("channels"), "8");
});

test("test_manual_holds_at_a_layouts_count_once_picked", async () => {
  await pickChannelLayout("manual");
  assert.equal(channelLayout(), "manual");
});

test("test_a_layout_picked_after_manual_reads_as_that_layout", async () => {
  await pickChannelLayout("manual");
  await pickChannelLayout("2");
  assert.equal(channelLayout(), "2");
});

test("test_picking_manual_stages_nothing", async () => {
  await pickChannelLayout("manual");
  await pickChannelLayout("6");
  assert.equal(wire.stages.length, 1);
});

const current = () =>
  deviceView("net_device")
    .groups.flatMap((g) => g.rows)
    .filter((r) => r.cur)
    .map((r) => r.value);

test("test_the_loaded_device_is_the_current_row", () => {
  assert.deepEqual(current(), [STANDA]);
});

test("test_a_picked_device_becomes_the_current_row", async () => {
  await pickDevice("net_device", OFFICE);
  assert.deepEqual(current(), [OFFICE]);
});

test("test_the_trigger_names_the_effective_devices_card", () => {
  assert.equal(deviceView("net_device").main, "Holo Audio UAC2.0 Gen2.1 Standa");
});

test("test_a_device_missing_from_the_list_is_named_by_its_value", () => {
  load({ device: "gone/hw:CARD=X,DEV=0" });
  assert.equal(deviceView("net_device").main, "gone/hw:CARD=X,DEV=0");
});

test("test_picking_the_effective_device_stages_nothing", async () => {
  await pickDevice("net_device", STANDA);
  await pickDevice("net_device", OFFICE);
  assert.equal(wire.stages.length, 1);
});
