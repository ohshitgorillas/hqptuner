// Rendered suite for hqptuner/static/components/faceplate/settings/hardware.js: the Hardware acceleration drawer's
// schema drawn by the generic drawer, and its rail readouts. The form is store/faceplate/settings/hardware.js's, pinned
// in its own suite; this suite pins the wiring: each tab draws its fields and blocks in order, a field lights the
// drafted value and drafts a tap, an edit lights the drawer's own apply group and a discard clears it, the
// all-stations field on both tabs moves together, and the readouts print the engine's values, never the draft's.
//
// The wire is the seam: `GET /api/engine` answers the engine table a case hands the fake. Readout text is never
// asserted as a literal: a seg readout is held to the label the drawer's own field gives the engine's value, the block
// count to the number the engine reported, and a zero count to what a slider readout with an automatic zero prints.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/hardware.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  HARDWARE_DRAWER,
  HARDWARE_READOUTS,
} from "../../../../hqptuner/static/components/faceplate/settings/hardware.js";
import {
  discardHardware,
  loadHardware,
  setAllStations,
  setHardware,
} from "../../../../hqptuner/static/store/faceplate/settings/hardware.js";
import { drawerHead } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { settingsRail } from "../../../../hqptuner/static/store/faceplate/settings/rail.js";
import { alertPlan } from "../../../../hqptuner/static/model/shell/alerts.js";
import { readoutOf } from "../../../../hqptuner/static/model/shell/settings.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";
import { ok, stagingWire } from "../../support/wire/wire.js";

/** @typedef {Record<string, string>} EngineTable  the engine attributes as `GET /api/engine` carries them */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").FieldSpec} FieldSpec */

//: The engine as the daemon reports it, every attribute off the daemon's default.
const ENGINE = { cuda: "convolution", multicore: "0", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

/**
 * Load the engine a fake daemon reports, over a draft and switch reset.
 *
 * @param {EngineTable} [engine]
 */
async function load(engine = ENGINE) {
  stagingWire({ routes: (path) => (path === "/api/engine" ? ok({ engine }) : undefined) });
  discardHardware();
  setAllStations(false);
  await loadHardware();
}

beforeEach(() => load());

const all = () =>
  elements(renderTree(html`<${Drawer} schema=${HARDWARE_DRAWER} />`).out).sort((a, b) => a.start - b.start);

/**
 * The field and block ids a tab's panel draws, in order.
 *
 * @param {string} tab
 */
function drawnOn(tab) {
  const panel = all().find((e) => attr(e, "role") === "tabpanel" && attr(e, "data-tab") === tab);
  return panel
    ? elements(panel.html)
        .sort((a, b) => a.start - b.start)
        .filter((e) => hasAttr(e, "data-field") || hasAttr(e, "data-block"))
        .map((e) => attr(e, "data-field") ?? attr(e, "data-block"))
    : [];
}

/**
 * The value a field row lights, by the field's id.
 *
 * @param {string} id
 */
function litOf(id) {
  const row = all().find((e) => attr(e, "data-field") === id);
  const on = row ? elements(row.html).find((b) => b.name === "button" && classes(b).includes("on")) : undefined;
  return on ? attr(on, "data-v") : undefined;
}

/**
 * A field of the schema, by its tab and id.
 *
 * @param {string} tab
 * @param {string} id
 * @returns {FieldSpec | undefined}
 */
function fieldOf(tab, id) {
  const body = HARDWARE_DRAWER.tabs.find((t) => t.id === tab)?.body ?? [];
  for (const it of body) if ("field" in it && it.field.id === id) return it.field;
  return undefined;
}

/**
 * The label a field gives one of its values.
 *
 * @param {string} tab
 * @param {string} id
 * @param {string} v
 */
const labelOf = (tab, id, v) => fieldOf(tab, id)?.options.find((o) => o.value === v)?.label;

/** The readouts' rows on the Settings rail, label by label. */
const railTexts = () =>
  settingsRail([{ id: "hardware", name: "", readouts: HARDWARE_READOUTS }], alertPlan([], {}), null, [])[0].rows.map(
    (r) => r.text,
  );

const live = () => drawerHead(HARDWARE_DRAWER, "cpu").apply.live;

// --- the tabs ----------------------------------------------------------------------------------------------------

test("test_the_cpu_tab_draws_its_fields_and_the_block_count_in_order", () => {
  assert.deepEqual(drawnOn("cpu"), ["multicore", "ecores", "nblocks", "hwallcpu"]);
});

test("test_the_gpu_tab_draws_its_fields_and_the_devices_in_order", () => {
  assert.deepEqual(drawnOn("gpu"), ["cuda", "cudadevs", "hwallgpu"]);
});

// --- the fields --------------------------------------------------------------------------------------------------

test("test_a_field_lights_the_drafted_value", () => {
  const engine = litOf("ecores");
  setHardware("ecores", "filter");
  assert.deepEqual([engine, litOf("ecores")], ["pool", "filter"]);
});

test("test_a_tap_on_a_field_drafts_its_key", () => {
  fieldOf("gpu", "cuda")?.set("1");
  assert.equal(litOf("cuda"), "1");
});

// --- the apply group ---------------------------------------------------------------------------------------------

test("test_an_edit_through_a_field_lights_the_own_apply_group", () => {
  const before = live();
  fieldOf("cpu", "multicore")?.set("auto");
  assert.deepEqual([before, live()], [false, true]);
});

test("test_a_discard_clears_the_own_apply_group", async () => {
  fieldOf("cpu", "ecores")?.set("default");
  const edited = live();
  await HARDWARE_DRAWER.own?.discard();
  assert.deepEqual([edited, live()], [true, false]);
});

// --- the all-stations field --------------------------------------------------------------------------------------

test("test_all_stations_on_the_cpu_tab_lights_it_on_the_gpu_tab", () => {
  const before = litOf("hwallgpu");
  fieldOf("cpu", "hwallcpu")?.set("1");
  assert.deepEqual([before, litOf("hwallgpu")], ["0", "1"]);
});

test("test_all_stations_on_the_gpu_tab_lights_it_on_the_cpu_tab", () => {
  setAllStations(true);
  const before = litOf("hwallcpu");
  fieldOf("gpu", "hwallgpu")?.set("0");
  assert.deepEqual([before, litOf("hwallcpu")], ["1", "0"]);
});

// --- the readouts ------------------------------------------------------------------------------------------------

test("test_the_readouts_print_the_engines_values_not_the_drafts", () => {
  setHardware("multicore", "1");
  setHardware("ecores", "filter");
  setHardware("nblocks", "8");
  setHardware("cuda", "0");
  assert.deepEqual(railTexts(), [
    labelOf("cpu", "multicore", "0"),
    labelOf("cpu", "ecores", "pool"),
    "4",
    labelOf("gpu", "cuda", "convolution"),
  ]);
});

test("test_a_reload_moves_the_readouts_to_the_new_engine", async () => {
  await load({ ...ENGINE, multicore: "auto", ecores: "filter", nblocks: "12", cuda: "1" });
  assert.deepEqual(railTexts(), [
    labelOf("cpu", "multicore", "auto"),
    labelOf("cpu", "ecores", "filter"),
    "12",
    labelOf("gpu", "cuda", "1"),
  ]);
});

test("test_a_zero_block_count_prints_as_the_automatic_word", async () => {
  await load({ ...ENGINE, nblocks: "0" });
  assert.equal(railTexts()[2], readoutOf({ type: "slider", auto: { v: 0 } }, "0", []).text);
});
