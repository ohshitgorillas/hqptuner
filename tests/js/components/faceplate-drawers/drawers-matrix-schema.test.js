// Rendered suite for hqptuner/static/components/faceplate/drawers/matrix.js, the Matrix engine and DAC correction
// drawers' schemas drawn by the stage drawer: each tab's rows in order, the Basic tab opening on its intro, the
// Advanced rows' option lists, the tab or title dot a staged edit puts on its own tab, and the
// family the two drawers share their staged state in.
//
// Renders `Drawer` through preact-render-to-string, the store driven at the wire by the staging fake and the /matrix
// form in `matrixConfig`. Rows are found by catalog key (`data-k`), tabs by id (`data-tab`); every string asserted is a
// wire value.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { CORRECTION_DRAWER, MATRIX_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/matrix.js";
import {
  config,
  engineState,
  enums,
  matrixConfig,
  metadata,
  pendingPreset,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickApplyMode, registerDrawer, showTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { stagingWire } from "../../support/wire/wire.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/**
 * Options as the /matrix form lists them.
 *
 * @param {...string} values
 */
const opts = (...values) => values.map((value) => ({ value, label: value }));

beforeEach(async () => {
  stagingWire();
  config.value = { fields: [], file: {}, active: "" };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: true },
      { name: "expand_hf", value: false },
      { name: "engine", value: "1", options: opts("1", "0") },
      { name: "iir2fir", value: "0", options: opts("0", "1", "2") },
      { name: "post_correction_enabled", value: false },
      { name: "post_correction_dac0", value: "", options: opts("", "m1") },
    ],
  };
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  pickApplyMode("apply");
  showTab(MATRIX_DRAWER.id, "basic");
});

/**
 * Every element of a drawer's markup, in document order.
 *
 * @param {DrawerSchema} schema
 * @returns {MarkupElement[]}
 */
const markup = (schema) => elements(render(html`<${Drawer} schema=${schema} />`)).sort((a, b) => a.start - b.start);

/**
 * The elements inside a drawer's tab panel.
 *
 * @param {DrawerSchema} schema
 * @param {string} tab
 * @returns {MarkupElement[]}
 */
function inPanel(schema, tab) {
  const panel = markup(schema).find((e) => classes(e).includes("dpanel") && attr(e, "data-tab") === tab);
  return panel ? elements(panel.html).sort((a, b) => a.start - b.start) : [];
}

/**
 * Each tab panel's row keys in order.
 *
 * @param {DrawerSchema} schema
 * @returns {Record<string, (string | undefined)[]>}
 */
const rowsByTab = (schema) =>
  Object.fromEntries(
    schema.tabs.map((t) => [
      t.id,
      inPanel(schema, t.id)
        .filter((e) => classes(e).includes("drow"))
        .map((e) => attr(e, "data-k")),
    ]),
  );

/**
 * The ids of the tabs carrying a dirty dot.
 *
 * @param {DrawerSchema} schema
 * @returns {(string | undefined)[]}
 */
const dottedTabs = (schema) =>
  markup(schema)
    .filter((e) => attr(e, "role") === "tab" && classes(e).includes("dirty"))
    .map((e) => attr(e, "data-tab"));

test("test_the_matrix_engine_draws_the_gate_and_expand_hf_then_the_engine_settings", () => {
  assert.deepEqual(rowsByTab(MATRIX_DRAWER), {
    basic: ["matrix_enabled", "matrix_expand_hf"],
    advanced: ["matrix_engine", "matrix_iir2fir"],
  });
});

test("test_the_basic_tab_opens_on_an_intro", () => {
  const items = inPanel(MATRIX_DRAWER, "basic");
  const first = items.find((e) => classes(e).includes("dintro") || classes(e).includes("drow"));
  assert.equal(first ? classes(first).includes("dintro") : false, true);
});

test("test_each_advanced_row_lists_every_option_under_it", () => {
  const listing = inPanel(MATRIX_DRAWER, "advanced")
    .filter((e) => classes(e).includes("drow"))
    .map((row) => [
      attr(row, "data-k"),
      elements(row.html)
        .filter((e) => classes(e).includes("optrow"))
        .map((e) => attr(e, "data-v")),
    ]);
  assert.deepEqual(listing, [
    ["matrix_engine", ["1", "0"]],
    ["matrix_iir2fir", ["0", "1", "2"]],
  ]);
});

test("test_a_staged_matrix_gate_dots_the_basic_tab", async () => {
  await edit("matrix_enabled", "0");
  assert.deepEqual(dottedTabs(MATRIX_DRAWER), ["basic"]);
});

test("test_a_staged_iir_to_fir_dots_the_advanced_tab", async () => {
  await edit("matrix_iir2fir", "2");
  assert.deepEqual(dottedTabs(MATRIX_DRAWER), ["advanced"]);
});

for (const [key, drawer] of /** @type {[string, DrawerSchema][]} */ ([
  ["matrix_enabled", MATRIX_DRAWER],
  ["dac_correction_enabled", CORRECTION_DRAWER],
])) {
  test(`test_the_${key}_gate_lists_bypass_before_engage`, () => {
    const row = markup(drawer).find((e) => attr(e, "data-k") === key);
    const listed = (row ? elements(row.html) : [])
      .filter((e) => e.name === "button")
      .sort((a, b) => a.start - b.start)
      .map((e) => attr(e, "data-v"));
    assert.deepEqual(listed, ["0", "1"]);
  });
}

test("test_the_dac_model_row_prints_its_own_label_in_place_of_the_metadatas", () => {
  metadata.value = {
    settings: { dsp: { dac_correction_profile: { label: "label-fixture", tooltip: "para-fixture" } } },
  };
  const row = markup(CORRECTION_DRAWER).find((e) => attr(e, "data-k") === "dac_correction_profile");
  const label = row ? elements(row.html).find((e) => e.name === "b") : undefined;
  assert.deepEqual([label !== undefined, label ? text(label) !== "label-fixture" : false], [true, true]);
});

test("test_dac_correction_draws_its_gate_and_dac_model", () => {
  assert.deepEqual(rowsByTab(CORRECTION_DRAWER), {
    correction: ["dac_correction_enabled", "dac_correction_profile"],
  });
});

test("test_a_staged_dac_model_dots_the_dac_correction_title", async () => {
  const dotted = () =>
    markup(CORRECTION_DRAWER).some(
      (e) => e.name === "span" && classes(e).includes("t") && classes(e).includes("dirty"),
    );
  const before = dotted();
  await edit("dac_correction_profile", "m1");
  assert.deepEqual([before, dotted()], [false, true]);
});

test("test_a_staged_dac_correction_edit_lights_the_matrix_engines_apply_group", async () => {
  registerDrawer(MATRIX_DRAWER);
  registerDrawer(CORRECTION_DRAWER);
  const discardOff = () => {
    const b = markup(MATRIX_DRAWER).find((e) => attr(e, "data-testid") === "discard");
    return b ? hasAttr(b, "disabled") : null;
  };
  const before = discardOff();
  await edit("dac_correction_enabled", "1");
  assert.deepEqual([before, discardOff()], [true, false]);
});
