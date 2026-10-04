// Behavioral suite for hqptuner/static/store/faceplate/page/pins.js, the page Output section's store half: one column per
// tier of the running band, each with its two exact rates, the rate playing and the pin marked, a rate the device or the
// engine's own rate list cannot carry offered as no pin; a pin on one exact rate, and Auto clearing it.
//
// The store is driven at the wire: the engine's rate list is assigned to `enums` in the shape /api/enumerations serves,
// the pin as the RatesItem index in `engineState.rate` as /api/state serves it, the Status frame and its metadata child
// to `engineStatus`, and every pin goes out over the faked fetch (tests/js/support/wire/wire.js) on the real
// POST /api/config/live path. A tier's position counts both families in rate order, 1x first, as the dial does.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/page-pins.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

useStorage();

const { config, engineState, engineStatus, enums } = await import("../../../../hqptuner/static/store/signals.js");
const { setAllowPinnedRates } = await import("../../../../hqptuner/static/store/ui/faceplate.js");
const { pinAuto, pinColumns, pinTier } = await import("../../../../hqptuner/static/store/faceplate/page/pins.js");

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const PCM_HZ = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000];
const SDM_HZ = [2822400, 3072000, 5644800, 6144000, 11289600, 12288000, 22579200, 24576000, 45158400, 49152000];

/**
 * The engine's `<RatesItem index rate/>` list for a running mode, index 0 auto. Index and Hz never coincide, so a
 * reading that skipped the join fails.
 *
 * @param {number[]} hz
 */
const ratesList = (hz) => [{ index: "0", rate: "0" }, ...hz.map((r, n) => ({ index: String(n + 1), rate: String(r) }))];

/**
 * The State index the engine reports for a pin on `hz` in `list`; "0" for none.
 *
 * @param {{ index: string, rate: string }[]} list
 * @param {number} hz
 */
const indexOf = (list, hz) => list.find((r) => r.rate === String(hz))?.index ?? "0";

const STANDA = "naa-7bdbb6cb/hw:CARD=Standa,DEV=0";

/** The device announces 1x to 16x and DSD64 to DSD1024: 32x and DSD2048 are out of its reach. */
const CAPS = { device: STANDA, pcm_rates: PCM_HZ.slice(0, 10), dsd_rates: SDM_HZ };

/** @type {unknown[]} */
let pins = [];

/** @type {StagingWire} */
let wire;

/**
 * @param {string} path
 * @param {{ body?: string }} opts
 */
function routes(path, opts) {
  if (path === "/api/config/live") {
    pins.push(JSON.parse(String(opts.body)));
    return ok({ report: { live: [{ setting: "rate", ok: true }], stored: {} } });
  }
  if (path === "/api/state") return ok({ data: engineState.value });
  if (path === "/api/enumerations") return ok({ data: enums.value });
  return undefined;
}

/**
 * Load the /config payload: the rate limits inside the device's reach, the device announcing `caps`.
 *
 * @param {object | null} [caps]
 */
function load(caps = null) {
  config.value = {
    fields: [
      { name: "defaults_samplerate", type: "select", value: "192000" },
      { name: "defaults_bitrate", type: "select", value: "12288000" },
      { name: "mode", type: "select", value: "pcm" },
      { name: "backend", type: "select", value: "network" },
      { name: "net_dop", type: "checkbox", value: false },
      { name: "net_device", type: "select", value: STANDA, options: [{ value: STANDA, label: STANDA }] },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: caps,
  };
}

/**
 * Put the engine in one running state.
 *
 * @param {{ state?: string, chain?: string, source?: string, output?: string, pin?: number, list?: number[] }} [p]
 */
function run({ state = "0", chain = "pcm", source = "44100", output = "0", pin = 0, list = PCM_HZ } = {}) {
  const rates = ratesList(list);
  enums.value = { rates };
  engineState.value = { state, mode: "1", active_chain: chain, rate: indexOf(rates, pin) };
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: source } };
}

beforeEach(async () => {
  wire = stagingWire({ routes });
  load();
  run();
  setAllowPinnedRates(true);
  await quiesce(wire);
  pins = [];
});

/**
 * The (tier, family) of every rate carrying `mark`.
 *
 * @param {"pinned" | "playing" | "offered"} mark
 */
const marked = (mark) => pinColumns().flatMap((c) => c.cells.filter((x) => x[mark]).map((x) => [c.i, x.fam]));

// --- which tiers ---------------------------------------------------------------------------------------------------

test("test_idle_the_columns_are_the_loaded_chains_tiers", () => {
  const tiers = () => pinColumns().map((c) => c.i);
  const pcm = tiers();
  run({ chain: "sdm", list: SDM_HZ });
  assert.deepEqual(
    [pcm, tiers()],
    [
      [0, 1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10, 11],
    ],
  );
});

test("test_while_a_source_plays_the_columns_follow_the_output_family", () => {
  run({ state: "2", chain: "pcm", output: "11289600", list: SDM_HZ });
  assert.deepEqual(
    pinColumns().map((c) => c.i),
    [6, 7, 8, 9, 10, 11],
  );
});

test("test_each_column_carries_its_tier_name_and_unit", () => {
  run({ chain: "sdm", list: SDM_HZ });
  const c = pinColumns()[0];
  assert.deepEqual([c?.name, c?.unit], ["64x", "MHz"]);
});

test("test_each_column_carries_its_two_exact_rates_44k_first", () => {
  assert.deepEqual(
    pinColumns()[0]?.cells.map((x) => [x.fam, x.label, x.hz]),
    [
      ["f44", "44.1", 44100],
      ["f48", "48", 48000],
    ],
  );
});

// --- marks ---------------------------------------------------------------------------------------------------------

test("test_the_rate_playing_is_marked_on_its_exact_member", () => {
  run({ state: "2", output: "352800" });
  assert.deepEqual(marked("playing"), [[3, "f44"]]);
});

test("test_with_nothing_playing_no_rate_is_marked_playing", () => {
  run({ state: "2", output: "352800" });
  const playing = marked("playing");
  run({ state: "0", output: "352800" });
  assert.deepEqual([playing, marked("playing")], [[[3, "f44"]], []]);
});

test("test_the_pin_reads_off_the_engines_state_index", () => {
  run({ pin: 192000 });
  assert.deepEqual(marked("pinned"), [[2, "f48"]]);
});

test("test_on_auto_no_rate_is_marked_pinned", () => {
  run({ pin: 192000 });
  const pinned = marked("pinned");
  run({ pin: 0 });
  assert.deepEqual([pinned, marked("pinned")], [[[2, "f48"]], []]);
});

// --- what can be pinned --------------------------------------------------------------------------------------------

test("test_a_tier_the_device_cannot_carry_is_unavailable", () => {
  load(CAPS);
  assert.deepEqual(
    pinColumns()
      .filter((c) => c.unavailable)
      .map((c) => c.i),
    [5],
  );
});

test("test_a_rate_the_engines_list_lacks_is_not_offered", () => {
  run({ list: PCM_HZ.slice(0, 7) });
  assert.deepEqual(marked("offered"), [
    [0, "f44"],
    [0, "f48"],
    [1, "f44"],
    [1, "f48"],
    [2, "f44"],
    [2, "f48"],
    [3, "f44"],
  ]);
});

test("test_no_rate_of_an_unavailable_tier_is_offered", () => {
  const tier5 = () => marked("offered").filter(([i]) => i === 5);
  const before = tier5();
  load(CAPS);
  assert.deepEqual(
    [before, tier5()],
    [
      [
        [5, "f44"],
        [5, "f48"],
      ],
      [],
    ],
  );
});

// --- pinning -------------------------------------------------------------------------------------------------------

test("test_a_pin_posts_the_exact_rate_in_hz_to_the_live_lane", async () => {
  await pinTier(2, "f44");
  assert.deepEqual(pins, [{ fields: { rate: "176400" } }]);
});

test("test_a_pin_on_an_sdm_tier_posts_its_bitstream_rate", async () => {
  run({ chain: "sdm", list: SDM_HZ });
  await pinTier(8, "f48");
  assert.deepEqual(pins, [{ fields: { rate: "12288000" } }]);
});

test("test_a_pin_on_a_rate_the_engines_list_lacks_sends_nothing", async () => {
  run({ list: PCM_HZ.slice(0, 4) });
  await pinTier(4, "f48");
  await pinTier(1, "f48");
  assert.deepEqual(pins, [{ fields: { rate: "96000" } }]);
});

test("test_a_pin_on_a_tier_outside_the_running_band_sends_nothing", async () => {
  await pinTier(8, "f48");
  await pinTier(2, "f48");
  assert.deepEqual(pins, [{ fields: { rate: "192000" } }]);
});

test("test_a_pin_on_the_rate_already_pinned_sends_nothing", async () => {
  run({ pin: 96000 });
  await pinTier(1, "f48");
  await pinTier(1, "f44");
  assert.deepEqual(pins, [{ fields: { rate: "88200" } }]);
});

test("test_auto_clears_a_standing_pin", async () => {
  run({ pin: 96000 });
  await pinAuto();
  assert.deepEqual(pins, [{ fields: { rate: "0" } }]);
});

test("test_auto_with_no_pin_standing_sends_nothing", async () => {
  await pinAuto();
  run({ pin: 96000 });
  await pinAuto();
  assert.deepEqual(pins, [{ fields: { rate: "0" } }]);
});
