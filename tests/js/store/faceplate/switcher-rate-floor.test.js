// Behavioral suite for the Setting Switcher's rate gate (hqptuner/static/store/faceplate/bottom/switcher.js): on the
// Modulator target a slot remembering a modulator whose rate floor is above the SDM output rate in force is marked
// disabled, its body says "Unavailable for this output rate" under either option style, and its tap sends nothing; a
// slot remembering a modulator the rate runs taps as it always did, and the
// remembered name outlives a rate change, so the slot taps again once the rate supports it.
//
// Driven at the wire, as the Switcher suite is (tests/js/store/faceplate/switcher.test.js): the fixture of
// tests/js/support/listsfixture.js (SDM chain loaded, ASDM5 running, ASDM7EC 512+fs with a rate floor of 20480000 the
// other modulator), the SDM rate limit served as the `defaults_bitrate` reading, and a fetch fake that records every
// live write. Every engine name asserted is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/switcher-rate-floor.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { render } from "preact-render-to-string";

import { useStorage } from "../../support/storage.js";
import { attr, classes, elements, text } from "../../support/markup.js";
import { ok } from "../../support/wire/wire.js";
import { settle } from "../../support/wire/livepresetwire.js";

useStorage();

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { Switcher } = await import("../../../../hqptuner/static/components/faceplate/bottom/Switcher.js");
const { engineState } = await import("../../../../hqptuner/static/store/signals.js");
const { readings } = await import("../../../../hqptuner/static/store/core/readings.js");
const { setBottomBar } = await import("../../../../hqptuner/static/store/ui/prefs.js");
const { loadLists, resetLists } = await import("../../support/listsfixture.js");
const { seedReadings } = await import("../../support/readings.js");
const { setSwitcherTarget, switcherView, setSlot, slotLive } =
  await import("../../../../hqptuner/static/store/faceplate/bottom/switcher.js");

const ABOVE_FLOOR = "ASDM7EC 512+fs";
const UNAVAILABLE = "Unavailable for this output rate";
const DSD256 = "12288000";
const DSD512 = "24576000";

/** @type {{ fetch?: unknown }} */
const env = globalThis;

/** @type {unknown[]} */
let live = [];

/**
 * The answer to one request, each live write's body recorded first.
 *
 * @param {string} path
 * @param {{ body?: string }} [opts]
 */
async function answer(path, opts = {}) {
  if (path !== "/api/config/live") return ok({});
  live.push(JSON.parse(opts.body ?? "null"));
  return ok({ report: { live: [], stored: {} } });
}

/** The rendered slot body at index `i`: its attribute reader and what a reader sees inside it. */
function body(i = 0) {
  const found = elements(render(html`<${Switcher} />`)).filter((e) => classes(e).includes("sbody"))[i];
  if (!found) return null;
  return { attr: (/** @type {string} */ name) => attr(found, name), text: text(found) };
}

beforeEach(async () => {
  useStorage();
  await loadLists({ plain: true, readings: { defaults_bitrate: DSD256 } });
  resetLists();
  engineState.value = { ...engineState.value, shaper: "0" };
  setBottomBar("switcher");
  setSwitcherTarget("Modulator");
  setSlot(0, ABOVE_FLOOR);
  setSlot(1, "");
  live = [];
  env.fetch = answer;
});

test("test_a_slot_remembering_a_modulator_above_the_rate_in_force_is_marked_disabled", () => {
  assert.equal(switcherView()?.slots[0].disabled, true);
});

test("test_a_disabled_slot_body_says_it_is_unavailable_for_the_output_rate", () => {
  assert.equal(body()?.text.includes(UNAVAILABLE), true);
});

test("test_a_disabled_slot_body_says_it_is_unavailable_under_standard_names", async () => {
  await loadLists({ plain: false, readings: { defaults_bitrate: DSD256 } });
  assert.equal(body()?.text.includes(UNAVAILABLE), true);
});

test("test_a_disabled_slot_body_is_marked_disabled", () => {
  assert.equal(body()?.attr("aria-disabled"), "true");
});

test("test_a_slot_remembering_a_modulator_the_rate_runs_says_nothing_of_the_output_rate", async () => {
  await seedReadings({ ...readings.value?.fields, defaults_bitrate: DSD512 });
  assert.equal(body()?.text.includes(UNAVAILABLE), false);
});

test("test_tapping_a_disabled_slot_sends_no_write", async () => {
  await slotLive(0);
  await settle();
  assert.deepEqual(live, []);
});

test("test_a_slot_remembering_a_modulator_the_rate_runs_is_not_marked_disabled", async () => {
  await seedReadings({ ...readings.value?.fields, defaults_bitrate: DSD512 });
  assert.equal(switcherView()?.slots[0].disabled, false);
});

test("test_tapping_a_slot_remembering_a_modulator_the_rate_runs_sends_it_live", async () => {
  await seedReadings({ ...readings.value?.fields, defaults_bitrate: DSD512 });
  await slotLive(0);
  await settle();
  assert.deepEqual(live, [{ fields: { modulator: "3" } }]);
});

test("test_the_remembered_name_outlives_a_rate_change", async () => {
  await seedReadings({ ...readings.value?.fields, defaults_bitrate: DSD512 });
  assert.equal(switcherView()?.slots[0].name, ABOVE_FLOOR);
});
