// Rendered suite for hqptuner/static/components/faceplate/settings/hardware.js: the Hardware acceleration drawer's
// schema drawn by the generic drawer, and its rail readouts. The form is store/faceplate/settings/hardware.js's, pinned
// in its own suite; this suite pins the wiring: an edit to `multicore`, `ecores` or `cuda` lights the drawer's own apply
// group and its Discard clears it, the all-stations field on both tabs moves together, every field's head carries the
// restart mark from the moment the drawer is drawn, since the form restarts the engine when applied, and the readouts
// print the engine's values, never the draft's, and move when the engine is reloaded with other values.
//
// The wire is the seam: `GET /api/engine` answers the engine table a case hands the fake. Readout text is never
// asserted as a literal: a readout of a catalog setting is held to what its own control's readout form prints for the
// engine's value, found by the catalog entry's label, and a zero count to what a slider readout with an automatic zero
// prints. A catalog setting's row is found by its `data-k` wire key, a field's row by its `data-field` id, both read off
// the drawer's schema, and the restart mark by its `data-testid`.
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
import { drawerHead, shownTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { schema } from "../../../../hqptuner/static/store/schema.js";
import { settingsRail } from "../../../../hqptuner/static/store/faceplate/settings/rail.js";
import { alertPlan } from "../../../../hqptuner/static/model/shell/alerts.js";
import { readoutOf } from "../../../../hqptuner/static/model/shell/settings.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements } from "../../support/markup.js";
import { ok, stagingWire } from "../../support/wire/wire.js";

/** @typedef {Record<string, string>} EngineTable  the engine attributes as `GET /api/engine` carries them */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").FieldSpec} FieldSpec */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/settings/hardware.js").HardwareKey} HardwareKey */

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

/**
 * Each catalog setting of the drawer with a second value of its engine attribute, different from the one ENGINE reports.
 *
 * @type {{ id: HardwareKey, other: string }[]}
 */
const SETTINGS = [
  { id: "multicore", other: "1" },
  { id: "ecores", other: "filter" },
  { id: "cuda", other: "1" },
];

const all = () =>
  elements(renderTree(html`<${Drawer} schema=${HARDWARE_DRAWER} />`).out).sort((a, b) => a.start - b.start);

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

/** The readouts' rows on the Settings rail, label by label. */
const railTexts = () =>
  settingsRail([{ id: "hardware", name: "", readouts: HARDWARE_READOUTS }], alertPlan([], {}), null, [])[0].rows.map(
    (r) => r.text,
  );

/** Whether the drawer's own apply group is live on the tab the drawer shows. */
const applyLive = () => drawerHead(HARDWARE_DRAWER, shownTab(HARDWARE_DRAWER)).apply.live;

/**
 * The drawer's readout of a catalog setting, found by the catalog entry's label.
 *
 * @param {string} id
 */
function readoutOfSetting(id) {
  const entry = /** @type {Record<string, { label?: unknown } | undefined>} */ (schema)[id];
  return HARDWARE_READOUTS.find((r) => entry !== undefined && r.label === entry.label);
}

//: What the rail reports printing when it draws no row for the setting's readout.
const NO_ROW = "no row on the rail";

//: What the setting's readout form reports printing when the drawer has no readout for the setting.
const NO_READOUT = "no readout in the drawer";

/**
 * What the Settings rail prints for a catalog setting's readout, and what that readout's own control prints for
 * `value`.
 *
 * @param {string} id
 * @param {string} value
 */
function railAgainst(id, value) {
  const readout = readoutOfSetting(id);
  const rows = settingsRail([{ id: "hardware", name: "", readouts: HARDWARE_READOUTS }], alertPlan([], {}), null, [])[0]
    .rows;
  const printed = rows.find((r) => readout !== undefined && r.label === readout.label)?.text ?? NO_ROW;
  return { printed, expected: readout ? readoutOf(readout.control, value, []).text : NO_READOUT };
}

// --- the apply group ---------------------------------------------------------------------------------------------

for (const { id, other } of SETTINGS) {
  test(`test_an_edit_to_${id}_lights_the_hardware_drawers_own_apply_group`, () => {
    const before = applyLive();
    setHardware(id, other);
    assert.deepEqual([before, applyLive()], [false, true]);
  });
}

for (const { id, other } of SETTINGS) {
  test(`test_discard_clears_the_hardware_drawers_apply_group_after_an_edit_to_${id}`, async () => {
    setHardware(id, other);
    const edited = applyLive();
    await HARDWARE_DRAWER.own?.discard();
    assert.deepEqual([edited, applyLive()], [true, false]);
  });
}

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

// --- the restart mark -------------------------------------------------------------------------------------------

/** The restart mark's state-bearing handle, shared by every surface that carries it. */
const MARK = "restart-mark";

/**
 * Every head the schema draws as a row, on both tabs: a catalog setting by its wire key, found by `data-k`, and a
 * field by its id, found by `data-field`.
 *
 * @type {{ id: string, handle: string }[]}
 */
const HEADS = HARDWARE_DRAWER.tabs.flatMap((t) =>
  t.body.flatMap((it) => {
    if ("row" in it) return [{ id: it.row.key, handle: "data-k" }];
    if ("field" in it) return [{ id: it.field.id, handle: "data-field" }];
    return [];
  }),
);

/**
 * Whether the row drawn for a head carries the restart mark, or null when the row is not drawn.
 *
 * @param {{ id: string, handle: string }} head
 * @returns {boolean | null}
 */
function markedHead({ id, handle }) {
  const row = all().find((e) => attr(e, handle) === id);
  return row ? elements(row.html).some((e) => attr(e, "data-testid") === MARK) : null;
}

for (const head of HEADS) {
  test(`test_the_unedited_${head.id}_head_carries_the_restart_mark`, () => {
    assert.equal(markedHead(head), true);
  });
}

// --- the readouts ------------------------------------------------------------------------------------------------

for (const { id, other } of SETTINGS) {
  test(`test_the_${id}_rail_readout_prints_the_engines_value_not_the_draft`, () => {
    setHardware(id, other);
    const { printed, expected } = railAgainst(id, ENGINE[id]);
    assert.equal(printed, expected);
  });
}

for (const { id, other } of SETTINGS) {
  test(`test_the_${id}_rail_readout_moves_to_the_value_a_reloaded_engine_reports`, async () => {
    await load({ ...ENGINE, [id]: other });
    const { printed, expected } = railAgainst(id, other);
    assert.equal(printed, expected);
  });
}

test("test_a_zero_block_count_prints_as_the_automatic_word", async () => {
  await load({ ...ENGINE, nblocks: "0" });
  assert.equal(railTexts()[2], readoutOf({ type: "slider", auto: { v: 0 } }, "0", []).text);
});
