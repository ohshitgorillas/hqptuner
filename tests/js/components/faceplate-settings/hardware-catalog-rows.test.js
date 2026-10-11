// Rendered suite for the catalog's three Hardware entries, `multicore`, `ecores` and `cuda`, drawn as catalog rows: each
// row, drawn alone in a drawer of one tab this suite declares, writes through the hardware settings' own form
// (store/faceplate/settings/hardware.js), never through the staged /config edit path, so a change on it stages nothing
// in the config staging buffer and the form's own apply is what carries it to the daemon. The Hardware drawer's
// Settings rail readouts draw each of the three from its catalog entry.
//
// The wire is the seam: `GET /api/engine` answers the engine table this suite hands the fake, `POST /api/engine`
// records the body it was handed and answers a verified apply, and the staging fake records every
// `POST /api/config/stage` body. Buttons are reached through preact's own `options.vnode` hook
// (tests/js/support/vnodeseam.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/hardware-catalog-rows.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { HARDWARE_READOUTS } from "../../../../hqptuner/static/components/faceplate/settings/hardware.js";
import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { schema } from "../../../../hqptuner/static/store/schema.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  applyHardware,
  discardHardware,
  loadHardware,
  setAllStations,
} from "../../../../hqptuner/static/store/faceplate/settings/hardware.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements } from "../../support/markup.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {{ overrides: Record<string, unknown> }} ApplyBody  a `POST /api/engine` body, the member read here */

//: The engine as the daemon reports it, every attribute off the daemon's default.
const ENGINE = { cuda: "convolution", multicore: "0", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

//: The catalog ids of the Hardware drawer's engine settings.
const IDS = ["multicore", "ecores", "cuda"];

/**
 * A drawer of one tab holding the catalog's row for `id` and nothing else.
 *
 * @param {string} id
 * @returns {DrawerSchema}
 */
const rowDrawer = (id) => ({
  id: `${id}row`,
  title: `${id}row`,
  aria: `${id}row`,
  tabs: [{ id: "only", label: "only", body: [{ row: { key: id } }] }],
});

/**
 * Call a vnode prop when it is a handler.
 *
 * @param {unknown} fn
 * @param {...unknown} args
 */
const call = (fn, ...args) => (typeof fn === "function" ? fn(...args) : undefined);

/**
 * Reset every source signal the drawer reads and load the engine a fake daemon reports; returns the wire and the
 * `POST /api/engine` bodies it was handed.
 */
async function reset() {
  /** @type {ApplyBody[]} */
  const bodies = [];
  const w = stagingWire({
    routes: (path, opts) => {
      if (path !== "/api/engine") return undefined;
      if (opts.method !== "POST") return ok({ engine: ENGINE });
      bodies.push(JSON.parse(String(opts.body)));
      return ok({ report: { verified: { applied: true } } });
    },
  });
  config.value = { fields: [{ name: "direct_sdm", value: false }], file: {}, active: "", profiles: null };
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  discardHardware();
  setAllStations(false);
  await loadHardware();
  await quiesce(w);
  return { w, bodies };
}

//: What a tap reports when the row draws no unlit option to tap; no engine attribute carries it.
const NOTHING_TAPPED = "nothing tapped";

/**
 * Tap the option of the row for `id` that the row does not light; returns the value the tapped option carries.
 *
 * @param {string} id
 * @returns {Promise<string>}
 */
async function tapUnlitOption(id) {
  const { out, seen } = renderTree(html`<${Drawer} schema=${rowDrawer(id)} />`);
  const row = elements(out).find((e) => attr(e, "data-k") === id);
  const unlit = (row ? elements(row.html) : []).find(
    (e) => e.name === "button" && attr(e, "data-v") !== undefined && !classes(e).includes("on"),
  );
  const value = unlit ? attr(unlit, "data-v") : undefined;
  const hit = seen.find((v) => v.type === "button" && value !== undefined && v.props["data-v"] === value);
  await call(hit?.props.onClick);
  return value ?? NOTHING_TAPPED;
}

for (const id of IDS) {
  test(`test_a_change_on_the_${id}_row_reaches_the_daemon_by_the_hardware_apply_and_stages_nothing`, async () => {
    const { w, bodies } = await reset();
    const before = w.stages.length;
    const tapped = await tapUnlitOption(id);
    await quiesce(w);
    const stagedByTheChange = w.stages.length - before;
    await applyHardware();
    await quiesce(w);
    assert.deepEqual(
      { applied: bodies.map((b) => b.overrides[id]), stagedByTheChange },
      { applied: [tapped], stagedByTheChange: 0 },
    );
  });
}

/** @typedef {{ label?: unknown, options?: readonly object[] }} CatalogEntry  the members of a catalog entry read here */
/** @typedef {[string, unknown]} OptionPair  one option as its value and its label */

/**
 * Order two option pairs by value, so a comparison reads the option table and not the order it was written in.
 *
 * @param {OptionPair} a
 * @param {OptionPair} b
 */
const byValue = (a, b) => Number(a[0] > b[0]) - Number(a[0] < b[0]);

/**
 * What a readout or a catalog entry names and lists: its label, and its option table as value-label pairs read through
 * `key`, the member that carries an option's value on that side.
 *
 * @param {unknown} label
 * @param {readonly object[] | undefined} options
 * @param {"v" | "value"} key
 */
function naming(label, options, key) {
  const pairs = (options ?? []).map((o) => {
    const option = /** @type {Record<string, unknown>} */ (o);
    return /** @type {OptionPair} */ ([String(option[key]), option.label]);
  });
  return { label, options: pairs.sort(byValue) };
}

for (const id of IDS) {
  test(`test_the_${id}_rail_readout_draws_from_its_catalog_entry`, () => {
    const entry = /** @type {Record<string, CatalogEntry | undefined>} */ (schema)[id];
    const readout = HARDWARE_READOUTS.find((r) => entry !== undefined && r.label === entry.label);
    const shown =
      readout && naming(readout.label, "options" in readout.control ? readout.control.options : undefined, "v");
    assert.deepEqual(shown, naming(entry?.label, entry?.options, "value"));
  });
}
