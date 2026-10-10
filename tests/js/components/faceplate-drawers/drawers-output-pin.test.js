// Rendered suite for the rate pin on the Output drawer's rate dial (components/faceplate/drawers/output/RateDial.js)
// over the v1 store: the picker the dial carries only while Allow pinned rates is on, what a tap on a tier does under
// each pick, what the picker reads when the drawer opens, and the pinned rate's mark on the dial.
//
// Renders through preact-render-to-string. The picker's options are found by their wire identifier (`data-pin`:
// `auto`, `f44`, `f48`), the one picked by `aria-checked`, and a pick is fired through the vnode seam
// (tests/js/support/vnodeseam.js), since server rendering fires no events. A tap on a tier goes through the store's
// press seam, `pickTier` (store/faceplate/drawers/output.js): the pointer mapping onto it is pinned at the pure-function
// lane. Tiers are found by their position (`data-i`), which counts both families in rate order, 1x first.
//
// The engine's rate list is assigned to `enums` in the shape /api/enumerations serves, the pin as the RatesItem index
// in `engineState.rate` as /api/state serves it, the running rate in the Status frame; a pin goes out over the faked
// fetch on the real POST /api/config/live path and a limit over the staging fake (tests/js/support/wire/wire.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-output-pin.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { useStorage } from "../../support/storage.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements } from "../../support/markup.js";

useStorage();

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { RateDial } = await import("../../../../hqptuner/static/components/faceplate/drawers/output/RateDial.js");
const { config, engineState, engineStatus, enums, metadata } =
  await import("../../../../hqptuner/static/store/signals.js");
const { discardAll } = await import("../../../../hqptuner/static/store/actions.js");
const { effective } = await import("../../../../hqptuner/static/store/resolve.js");
const { openPopover, openStage } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { setAllowPinnedRates } = await import("../../../../hqptuner/static/store/ui/faceplate.js");
const { pickTier } = await import("../../../../hqptuner/static/store/faceplate/drawers/output.js");

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const PCM_HZ = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000];
const SDM_HZ = [2822400, 3072000, 5644800, 6144000, 11289600, 12288000, 22579200, 24576000, 45158400, 49152000];

/** The Output drawer's stage on the rail. */
const OUTPUT = "output";

/** Tier positions on the dial: PCM 1x..32x are 0..5, SDM 64x..2048x are 6..11. */
const PCM_2X = 1;
const PCM_16X = 4;
const SDM_512X = 9;
const SDM_1024X = 10;

/**
 * The engine's `<RatesItem index rate/>` list for a running mode, index 0 auto. Index and Hz never coincide, so a
 * reading that skipped the join fails.
 *
 * @param {number[]} hz
 */
const ratesList = (hz) => [{ index: "0", rate: "0" }, ...hz.map((r, n) => ({ index: String(n + 1), rate: String(r) }))];

const STANDA = "naa-7bdbb6cb/hw:CARD=Standa,DEV=0";

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

/** Load the /config payload: limits at PCM 4x and SDM 256x, both inside the device's reach. */
function load() {
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
    device_caps: null,
  };
}

/**
 * Put the engine in one running state: by default PCM playing at 8x of the 44.1k family, nothing pinned.
 *
 * @param {{ state?: string, chain?: string, output?: string, pin?: number, list?: number[] }} [p]
 */
function run({ state = "2", chain = "pcm", output = "352800", pin = 0, list = PCM_HZ } = {}) {
  const rates = ratesList(list);
  enums.value = { rates };
  const index = rates.find((r) => r.rate === String(pin))?.index ?? "0";
  engineState.value = { state, mode: "1", active_chain: chain, rate: index };
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: "44100" } };
}

/** Close the Output drawer and open it again. */
function reopen() {
  openStage.value = null;
  openStage.value = OUTPUT;
}

beforeEach(async () => {
  wire = stagingWire({ routes });
  load();
  run();
  metadata.value = null;
  openPopover.value = null;
  setAllowPinnedRates(true);
  await quiesce(wire);
  await discardAll();
  reopen();
  await quiesce(wire);
  pins = [];
  wire.stages = [];
});

const dial = () => elements(render(html`<${RateDial} />`));

/** The `data-pin` value of every picker option, sorted. */
const options = () =>
  dial()
    .map((e) => attr(e, "data-pin"))
    .filter((v) => v !== undefined)
    .sort();

/** The `data-pin` value of every picker option that reads picked. */
const picked = () =>
  dial()
    .filter((e) => attr(e, "data-pin") !== undefined && attr(e, "aria-checked") === "true")
    .map((e) => attr(e, "data-pin"));

/**
 * Tap the picker option `pin`, or nothing when the dial carries none, and let its write run out.
 *
 * @param {string} pin
 */
async function pick(pin) {
  const { seen } = renderTree(html`<${RateDial} />`);
  const hit = seen.find((v) => typeof v.type === "string" && (v.props ?? {})["data-pin"] === pin);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
  await quiesce(wire);
}

/**
 * A tap on tier `i` of `band`, through the store's press seam, and let its write run out.
 *
 * @param {"pcm" | "sdm"} band
 * @param {number} i
 */
async function tap(band, i) {
  await pickTier(band, i);
  await quiesce(wire);
}

// --- the picker ----------------------------------------------------------------------------------------------------

test("test_the_dial_carries_the_picker_only_while_pinned_rates_are_allowed", async () => {
  const allowed = options();
  setAllowPinnedRates(false);
  await quiesce(wire);
  assert.deepEqual([allowed, options()], [["auto", "f44", "f48"], []]);
});

// --- a tap under a picked family -----------------------------------------------------------------------------------

for (const { fam, chain, output, list, band, tier, hz } of [
  { fam: "f44", chain: "pcm", output: "352800", list: PCM_HZ, band: "pcm", tier: PCM_16X, hz: "705600" },
  { fam: "f48", chain: "pcm", output: "352800", list: PCM_HZ, band: "pcm", tier: PCM_16X, hz: "768000" },
  { fam: "f48", chain: "sdm", output: "11289600", list: SDM_HZ, band: "sdm", tier: SDM_512X, hz: "24576000" },
]) {
  test(`test_a_tap_in_the_playing_${band}_band_under_${fam}_pins_${hz}`, async () => {
    run({ chain, output, list });
    await pick(fam);
    await tap(/** @type {"pcm" | "sdm"} */ (band), tier);
    assert.deepEqual(pins, [{ fields: { rate: hz } }]);
  });
}

test("test_a_tap_that_pins_stages_nothing", async () => {
  await pick("f48");
  await tap("pcm", PCM_16X);
  assert.deepEqual(wire.stages, []);
});

test("test_a_tap_in_the_band_not_playing_moves_its_limit_while_a_family_is_picked", async () => {
  await pick("f44");
  await tap("pcm", PCM_16X);
  await tap("sdm", SDM_1024X);
  assert.deepEqual([pins.length, effective("sdm_rate")], [1, "49152000"]);
});

test("test_picking_a_family_writes_nothing_until_a_tap", async () => {
  await pick("f44");
  await pick("f48");
  await tap("pcm", PCM_16X);
  assert.deepEqual(pins, [{ fields: { rate: "768000" } }]);
});

test("test_picking_auto_clears_a_standing_pin", async () => {
  run({ pin: 192000 });
  await pick("auto");
  assert.deepEqual(pins, [{ fields: { rate: "0" } }]);
});

test("test_a_rate_the_engines_list_lacks_offers_no_pin", async () => {
  run({ list: PCM_HZ.slice(0, 8) });
  await pick("f44");
  await tap("pcm", PCM_16X);
  await tap("pcm", PCM_2X);
  assert.deepEqual(pins, [{ fields: { rate: "88200" } }]);
});

// --- a key under a picked family -----------------------------------------------------------------------------------

/** A key press as the slider reads it. @param {string} key */
const keyEvent = (key) => ({ key, preventDefault: () => undefined });

/**
 * Press `key` on the slider of `band`, or nothing when the dial carries none, and let its write run out.
 *
 * @param {"pcm" | "sdm"} band
 * @param {string} key
 */
async function press(band, key) {
  const { seen } = renderTree(html`<${RateDial} />`);
  const hit = seen.find(
    (v) => typeof v.type === "string" && (v.props ?? {}).role === "slider" && (v.props ?? {})["data-band"] === band,
  );
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props.onKeyDown);
  if (fn) await fn(keyEvent(key));
  await quiesce(wire);
}

// Nothing pinned: the step starts from the playing tier (PCM 8x, SDM 512x), never from the needle (PCM 4x, SDM 256x),
// and lands in the picked family, not the playing rate's.
for (const { fam, chain, output, list, band, key, hz } of [
  { fam: "f44", chain: "pcm", output: "352800", list: PCM_HZ, band: "pcm", key: "ArrowRight", hz: "705600" },
  { fam: "f48", chain: "pcm", output: "352800", list: PCM_HZ, band: "pcm", key: "ArrowRight", hz: "768000" },
  { fam: "f48", chain: "sdm", output: "22579200", list: SDM_HZ, band: "sdm", key: "ArrowLeft", hz: "12288000" },
]) {
  test(`test_${key}_in_the_playing_${band}_band_under_${fam}_pins_${hz}_one_tier_from_the_playing_tier`, async () => {
    run({ chain, output, list });
    await pick(fam);
    await press(/** @type {"pcm" | "sdm"} */ (band), key);
    assert.deepEqual(pins, [{ fields: { rate: hz } }]);
  });
}

// Pinned on 2x (96k), needle on 4x, playing 8x: one tier up from the pin is 4x of the 48k family.
test("test_an_arrow_key_steps_the_pin_from_the_pinned_tier", async () => {
  openStage.value = null;
  run({ output: "352800", pin: 96000 });
  openStage.value = OUTPUT;
  await press("pcm", "ArrowRight");
  assert.deepEqual(pins, [{ fields: { rate: "192000" } }]);
});

// --- what the picker reads when the drawer opens -------------------------------------------------------------------

for (const { pin, fam } of [
  { pin: 176400, fam: "f44" },
  { pin: 192000, fam: "f48" },
  { pin: 0, fam: "auto" },
]) {
  test(`test_on_opening_the_drawer_the_picker_reads_${fam}_for_a_pin_on_${pin}`, () => {
    openStage.value = null;
    run({ pin });
    openStage.value = OUTPUT;
    assert.deepEqual(picked(), [fam]);
  });
}

test("test_a_family_picked_with_nothing_pinned_reads_auto_when_the_drawer_reopens", async () => {
  await pick("f48");
  reopen();
  assert.deepEqual(picked(), ["auto"]);
});

// --- the mark ------------------------------------------------------------------------------------------------------

// The needle sits on 4x (the limit), the lamp on 8x (playing 352.8k), the pin on 2x (96k).
test("test_the_pin_is_marked_on_its_own_tier_apart_from_the_needle_and_the_playing_lamp", () => {
  run({ output: "352800", pin: 96000 });
  const marked = dial()
    .filter((e) => e.name === "g" && attr(e, "data-i") !== undefined && classes(e).includes("pinned"))
    .map((e) => attr(e, "data-i"));
  assert.deepEqual(marked, [String(PCM_2X)]);
});
