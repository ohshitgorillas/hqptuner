// Rendered suite for the lit row of the stage drawer (hqptuner/static/components/faceplate/drawer/Rows.js): under the
// junk advice the HF drawer's junk filter row blinks amber, with no advice it carries no blink, and the same row drawn
// in another drawer stays unlit.
//
// Renders `Drawer` through preact-render-to-string; the advice is raised at the wire through the /api/status payload's
// `junk` object on `engineStatus`, and the store is driven by the staging fake. The row is found by its schema key
// (`data-k`); every value asserted is a blink id, never a label.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/rows.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { HF_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/hf.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  metadata,
  pendingPreset,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { stagingWire } from "../../support/wire/wire.js";
import { elements, attr } from "../../support/markup.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/** The junk advisor's object as /api/status carries it. */
const ADVICE = { filter: "30k", reason: "reasonfixture", ceiling_khz: 30 };

/**
 * One /api/status poll: playing, the advisor offered and metering on, with the payload's other keys laid over it.
 *
 * @param {Record<string, unknown>} [extra]  the payload's other keys: `junk`
 */
function poll(extra = {}) {
  engineStatus.value = { status: { state: "2" }, autopilot: false, metering: true, ...extra };
}

beforeEach(async () => {
  stagingWire();
  config.value = { fields: [{ name: "pre_before_meter", type: "checkbox", value: false }], file: {}, active: "" };
  engineState.value = { filter_junk: "0" };
  poll();
  enums.value = {
    junk_filters: [
      { index: 0, name: "none" },
      { index: 1, name: "30k" },
    ],
  };
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
});

/** The junk filter row drawn in a drawer other than HF, on a tab of the same id. @type {DrawerSchema} */
const ELSEWHERE = {
  id: "rows",
  title: "rows",
  aria: "rows",
  tabs: [{ id: "hf", label: "hf", body: [{ row: { key: "junk_filter" } }] }],
};

/**
 * The `data-alert` the junk filter row carries, undefined when it carries none, null when the row is not drawn.
 *
 * @param {DrawerSchema} schema
 * @returns {string | undefined | null}
 */
function junkRowAlert(schema) {
  const row = elements(render(html`<${Drawer} schema=${schema} />`)).find((e) => attr(e, "data-k") === "junk_filter");
  return row ? attr(row, "data-alert") : null;
}

test("test_junk_advice_blinks_the_junk_filter_row_amber", () => {
  poll({ junk: { ...ADVICE } });
  assert.equal(junkRowAlert(HF_DRAWER), "warn");
});

test("test_with_no_advice_the_junk_filter_row_is_unlit", () => {
  assert.equal(junkRowAlert(HF_DRAWER), undefined);
});

test("test_junk_advice_leaves_the_junk_filter_row_of_another_drawer_unlit", () => {
  poll({ junk: { ...ADVICE } });
  assert.equal(junkRowAlert(ELSEWHERE), undefined);
});
