// Rendered suite for hqptuner/static/components/faceplate/settings/engine-rows.js, the Timing, UPnP and Behavior
// drawers' schemas drawn by the stage drawer, and their Settings rail readouts: each drawer's rows in order, the title
// dot a staged idle time puts on Timing, the pinned-rates field writing its preference, and a readout printing the
// running option's label.
//
// Renders `Drawer` through preact-render-to-string; a click is fired through the vnode seam
// (tests/js/support/vnodeseam.js) and the store is driven at the wire by the staging fake. Rows are found by catalog key
// (`data-k`), the field by its id (`data-field`), options by value (`data-v`). Readouts print through the rail's own
// settingsRail; every label asserted is one the config fixture put on the wire.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/engine-rows.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  BEHAVIOR_DRAWER,
  TIMING_DRAWER,
  TIMING_READOUTS,
  UPNP_DRAWER,
  UPNP_READOUTS,
} from "../../../../hqptuner/static/components/faceplate/settings/engine-rows.js";
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
import { allowPinnedRates, setAllowPinnedRates } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { alertPlan } from "../../../../hqptuner/static/model/shell/alerts.js";
import { settingsRail } from "../../../../hqptuner/static/store/faceplate/settings/rail.js";
import { stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr, classes } from "../../support/markup.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

//: The daemon form's options for the two config-sourced keys, labels as the wire carries them.
const IDLE_OPTIONS = [
  { value: "0", label: "Default" },
  { value: "10000", label: "10" },
];
const SHORT_OPTIONS = [
  { value: "0", label: "Normal" },
  { value: "1", label: "Short" },
];

/**
 * The config form with idle time and UPnP freewheel at the values given.
 *
 * @param {string} idle
 * @param {boolean} freewheel
 */
function form(idle, freewheel) {
  return {
    fields: [
      { name: "idle_time", type: "select", value: idle, options: IDLE_OPTIONS },
      { name: "quick_pause", type: "checkbox", value: false },
      { name: "short_buffer", type: "select", value: "0", options: SHORT_OPTIONS },
      { name: "upnp_freewheel", type: "checkbox", value: freewheel },
    ],
    file: {},
    active: "",
  };
}

beforeEach(async () => {
  stagingWire();
  config.value = form("0", false);
  engineState.value = {};
  engineStatus.value = { metering: true };
  enums.value = {};
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  setAllowPinnedRates(false);
  cancel();
  await discardAll();
  pickApplyMode("apply");
});

/**
 * Every element of a drawer's markup, in document order.
 *
 * @param {DrawerSchema} schema
 * @returns {MarkupElement[]}
 */
const markup = (schema) => elements(render(html`<${Drawer} schema=${schema} />`)).sort((a, b) => a.start - b.start);

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
 * Tap the pinned-rates field's option `value`.
 *
 * @param {string} value
 */
async function tapPinned(value) {
  const { seen } = renderTree(html`<${Drawer} schema=${BEHAVIOR_DRAWER} />`);
  const field = seen.find((v) => v.props?.["data-field"] === "pinallow");
  const hit = findIn(field?.props.children, (p) => p["data-v"] === value);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}

/**
 * The text the rail prints for the first readout of a set.
 *
 * @param {readonly SettingsReadout[]} readouts
 * @returns {string | undefined}
 */
function railText(readouts) {
  const plan = alertPlan([], {});
  return settingsRail([{ id: "c", name: "C", readouts }], plan, null, [])[0]?.rows[0]?.text;
}

/** @type {[string, DrawerSchema, string[]][]} */
const ROWS = [
  ["timing", TIMING_DRAWER, ["idle_time", "quick_pause", "short_buffer"]],
  ["upnp", UPNP_DRAWER, ["upnp_freewheel"]],
  ["behavior", BEHAVIOR_DRAWER, ["pinallow"]],
];

for (const [name, schema, want] of ROWS) {
  test(`test_the_${name}_drawer_draws_its_rows_in_order`, () => {
    const rows = markup(schema)
      .filter((e) => classes(e).includes("drow"))
      .map((e) => attr(e, "data-k") ?? attr(e, "data-field"));
    assert.deepEqual(rows, want);
  });
}

test("test_staging_an_idle_time_dots_the_timing_title", async () => {
  const dotted = () =>
    markup(TIMING_DRAWER).some((e) => e.name === "span" && classes(e).includes("t") && classes(e).includes("dirty"));
  const before = dotted();
  await edit("idle_time", "10000");
  assert.deepEqual([before, dotted()], [false, true]);
});

test("test_tapping_pinned_rates_on_writes_the_preference", async () => {
  const before = allowPinnedRates.value;
  await tapPinned("1");
  assert.deepEqual([before, allowPinnedRates.value], [false, true]);
});

test("test_a_readout_prints_the_label_of_the_running_option", () => {
  const before = railText(TIMING_READOUTS);
  config.value = form("10000", false);
  assert.deepEqual([before, railText(TIMING_READOUTS)], ["Default", "10"]);
});

test("test_a_readout_holds_the_running_option_while_an_edit_is_staged", async () => {
  await edit("idle_time", "10000");
  assert.equal(railText(TIMING_READOUTS), "Default");
});

test("test_a_checkbox_readout_reads_its_running_truth_as_its_option_value", () => {
  const before = UPNP_READOUTS[0]?.value();
  config.value = form("0", true);
  assert.deepEqual([before, UPNP_READOUTS[0]?.value()], ["0", "1"]);
});
