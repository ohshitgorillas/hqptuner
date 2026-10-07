// Rendered suite for hqptuner/static/components/faceplate/drawers/hf.js, the HF filter drawer's schema drawn by the
// stage drawer: its rows in order, the high-frequency filter's option list, the auto-pilot field's state, gray and
// write, and the title dot a staged pre-process edit puts on it.
//
// Renders `Drawer` through preact-render-to-string; a click is fired through the vnode seam
// (tests/js/support/vnodeseam.js) and the store is driven at the wire by the staging fake. Rows are found by catalog key
// (`data-k`), the field by its id (`data-field`), options by value (`data-v`); every string asserted is a wire value.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-hf-schema.test.js

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
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickApplyMode } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr, classes, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

/** @type {unknown[]} */
let autopilotPosts = [];
/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

/** @param {string} path @param {{ body?: string }} opts */
function routes(path, opts) {
  if (path !== "/api/autopilot") return undefined;
  autopilotPosts.push(JSON.parse(String(opts.body)));
  return ok({});
}

beforeEach(async () => {
  autopilotPosts = [];
  wire = stagingWire({ routes });
  config.value = { fields: [{ name: "pre_before_meter", type: "checkbox", value: false }], file: {}, active: "" };
  engineState.value = { filter_junk: "0" };
  engineStatus.value = { autopilot: false, metering: true };
  enums.value = {
    junk_filters: [
      { index: 0, name: "none" },
      { index: 1, name: "20k" },
    ],
  };
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  pickApplyMode("apply");
});

/** Every element of the drawer's markup, in document order. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${Drawer} schema=${HF_DRAWER} />`)).sort((a, b) => a.start - b.start);

/** The elements inside the auto-pilot field. @returns {MarkupElement[]} */
function inAutopilot() {
  const row = markup().find((e) => attr(e, "data-field") === "autopilot");
  return row ? elements(row.html) : [];
}

/**
 * The first vnode in a subtree whose props match `pred`.
 *
 * @param {unknown} node
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @returns {VNode | undefined}
 */
function findIn(node, pred) {
  if (Array.isArray(node)) return node.map((n) => findIn(n, pred)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  const v = /** @type {VNode} */ (node);
  if (v.props && pred(v.props)) return v;
  return findIn(v.props?.children, pred);
}

/**
 * Tap the auto-pilot field's option `value`.
 *
 * @param {string} value
 */
async function tapAutopilot(value) {
  const { seen } = renderTree(html`<${Drawer} schema=${HF_DRAWER} />`);
  const field = seen.find((v) => v.props?.["data-field"] === "autopilot");
  const hit = findIn(field?.props.children, (p) => p["data-v"] === value);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}

test("test_the_hf_drawer_draws_the_filter_the_auto_pilot_and_pre_process_in_order", () => {
  const rows = markup()
    .filter((e) => classes(e).includes("drow"))
    .map((e) => attr(e, "data-k") ?? attr(e, "data-field"));
  assert.deepEqual(rows, ["junk_filter", "autopilot", "pre_before_meter"]);
});

test("test_the_hf_filter_lists_every_engine_option_under_its_row", () => {
  const listed = markup()
    .filter((e) => classes(e).includes("optrow"))
    .map((e) => attr(e, "data-v"));
  assert.deepEqual(listed, ["0", "1"]);
});

test("test_staging_pre_process_before_metering_dots_the_title", async () => {
  const dotted = () =>
    markup().some((e) => e.name === "span" && classes(e).includes("t") && classes(e).includes("dirty"));
  const before = dotted();
  await edit("pre_before_meter", "1");
  assert.deepEqual([before, dotted()], [false, true]);
});

test("test_the_auto_pilot_field_lights_the_state_the_status_reports", () => {
  const lit = () => {
    const on = inAutopilot().find((e) => e.name === "button" && classes(e).includes("on"));
    return on ? attr(on, "data-v") : undefined;
  };
  const off = lit();
  engineStatus.value = { autopilot: true, metering: true };
  assert.deepEqual([off, lit()], ["0", "1"]);
});

test("test_the_auto_pilot_field_is_left_out_while_the_advisor_is_not_offered", () => {
  const shown = () => markup().some((e) => attr(e, "data-field") === "autopilot");
  const offered = shown();
  engineStatus.value = { autopilot: false, metering: true, advisor: false };
  assert.deepEqual([offered, shown()], [true, false]);
});

test("test_the_auto_pilot_field_grays_while_metering_is_off", () => {
  const disabled = () => inAutopilot().filter((e) => e.name === "button" && hasAttr(e, "disabled")).length;
  const live = disabled();
  engineStatus.value = { autopilot: false, metering: false };
  assert.deepEqual([live, disabled()], [0, 2]);
});

test("test_tapping_auto_pilot_on_switches_it_on_at_the_backend", async () => {
  await tapAutopilot("1");
  await quiesce(wire);
  assert.deepEqual(autopilotPosts, [{ enabled: true }]);
});
