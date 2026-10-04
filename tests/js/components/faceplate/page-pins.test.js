// Rendered suite for the page Output section's rate pins (components/faceplate/page/OutputPins.js) over the v1 store:
// nothing drawn while Allow pinned rates is off, one column per tier of the running band, the rate playing ringed, the
// pin and Auto in accent, a tier the device cannot carry hatched with no pin to press, and the write a tap on a rate or
// on Auto makes.
//
// Renders through preact-render-to-string. A handler is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. Rates are found by wire identifiers: a tier's position (`data-i`) and the
// rate's family (`data-fam`), Auto by its `data-testid`. The engine's rate list goes into `enums`, the pin index into
// `engineState`, and a pin goes out over the faked fetch on the real POST /api/config/live path.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/page-pins.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { useStorage } from "../../support/storage.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, text } from "../../support/markup.js";

useStorage();

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { config, engineState, engineStatus, enums } = await import("../../../../hqptuner/static/store/signals.js");
const { setAllowPinnedRates } = await import("../../../../hqptuner/static/store/ui/faceplate.js");
const { OutputPins } = await import("../../../../hqptuner/static/components/faceplate/page/OutputPins.js");

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const PCM_HZ = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000];

/** @param {number[]} hz */
const ratesList = (hz) => [{ index: "0", rate: "0" }, ...hz.map((r, n) => ({ index: String(n + 1), rate: String(r) }))];

const STANDA = "naa-7bdbb6cb/hw:CARD=Standa,DEV=0";

/** The device announces 1x to 16x: 32x is out of its reach. */
const CAPS = { device: STANDA, pcm_rates: PCM_HZ.slice(0, 10), dsd_rates: [] };

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

/** @param {object | null} [caps] */
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
 * Put the engine in one running state on the PCM chain.
 *
 * @param {{ state?: string, output?: string, pin?: number, list?: number[] }} [p]
 */
function run({ state = "0", output = "0", pin = 0, list = PCM_HZ } = {}) {
  const rates = ratesList(list);
  enums.value = { rates };
  const index = rates.find((r) => r.rate === String(pin))?.index ?? "0";
  engineState.value = { state, mode: "1", active_chain: "pcm", rate: index };
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: "44100" } };
}

beforeEach(async () => {
  wire = stagingWire({ routes });
  load();
  run();
  setAllowPinnedRates(true);
  await quiesce(wire);
  pins = [];
});

const pinsOut = () => render(html`<${OutputPins} />`);
const drawn = () => elements(pinsOut());

/**
 * The (tier, family) of every rate button carrying `cls`.
 *
 * @param {string} cls
 */
const rates = (cls) =>
  drawn()
    .filter((e) => e.name === "button" && attr(e, "data-i") !== undefined && classes(e).includes(cls))
    .map((e) => [attr(e, "data-i"), attr(e, "data-fam")]);

const auto = () => drawn().find((e) => attr(e, "data-testid") === "pin-auto");

/**
 * Fire the click handler of the first vnode matching `pred` in one render, or nothing when none matches.
 *
 * @param {(props: Record<string, unknown>) => boolean} pred
 */
async function tap(pred) {
  const { seen } = renderTree(html`<${OutputPins} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}

test("test_nothing_is_drawn_while_pinned_rates_are_not_allowed", async () => {
  const allowed = pinsOut() !== "";
  setAllowPinnedRates(false);
  await quiesce(wire);
  assert.deepEqual([allowed, pinsOut()], [true, ""]);
});

test("test_one_column_per_tier_of_the_running_band_names_its_tier", () => {
  assert.deepEqual(
    drawn()
      .filter((e) => classes(e).includes("ottn"))
      .map(text),
    ["1x", "2x", "4x", "8x", "16x", "32x"],
  );
});

test("test_the_rate_playing_is_ringed", () => {
  run({ state: "2", output: "352800" });
  assert.deepEqual(rates("otplay"), [["3", "f44"]]);
});

test("test_the_pin_reads_in_accent", () => {
  run({ pin: 192000 });
  assert.deepEqual(rates("otpinned"), [["2", "f48"]]);
});

test("test_auto_reads_in_accent_only_with_no_pin", () => {
  const lit = () => {
    const a = auto();
    return a ? classes(a).includes("otpinned") : null;
  };
  const unpinned = lit();
  run({ pin: 192000 });
  assert.deepEqual([unpinned, lit()], [true, false]);
});

test("test_a_tier_the_device_cannot_carry_is_hatched", () => {
  load(CAPS);
  assert.equal(drawn().filter((e) => classes(e).includes("otunav")).length, 1);
});

test("test_a_tier_the_device_cannot_carry_offers_no_pin", () => {
  const offered = () => drawn().filter((e) => e.name === "button" && attr(e, "data-i") === "5").length;
  const before = offered();
  load(CAPS);
  assert.deepEqual([before, offered()], [2, 0]);
});

test("test_a_rate_the_engines_list_lacks_offers_no_pin", () => {
  run({ list: PCM_HZ.slice(0, 7) });
  assert.deepEqual(
    drawn()
      .filter((e) => e.name === "button" && attr(e, "data-i") === "3")
      .map((e) => attr(e, "data-fam")),
    ["f44"],
  );
});

test("test_tapping_a_rate_pins_it", async () => {
  await tap((p) => p["data-i"] === 4 && p["data-fam"] === "f48");
  assert.deepEqual(pins, [{ fields: { rate: "768000" } }]);
});

test("test_tapping_auto_clears_the_pin", async () => {
  run({ pin: 192000 });
  await tap((p) => p["data-testid"] === "pin-auto");
  assert.deepEqual(pins, [{ fields: { rate: "0" } }]);
});
