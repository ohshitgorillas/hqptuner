// Rendered suite for the Output drawer's DSD row on the Format tab, drawn by the generic drawer from the Output schema
// (hqptuner/static/components/faceplate/drawers/output.js): a backend's two DSD settings, DoP and DSD rates (the
// per-backend `*_dop` and `*_anydsd` checkboxes), share one row under a single
// label. Staging either setting marks that shared row dirty, and picking an option on either control stages that
// setting alone.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. A control is found by
// its catalog key (`data-k`), an option by its value (`data-v`), the row holding a control as the smallest drawer row
// enclosing it, a row's label as its `b`, a row's dirty state by its `data-dirty`. A click is fired through the vnode
// seam (tests/js/support/vnodeseam.js), since server rendering fires no events: the option's vnode is the one at the
// same place among the drawer's option buttons of that value as the option inside the control is in the markup.
//
// Not reachable here: the two controls stacked one over the other, which a stylesheet owns. A browser run closes it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { OUTPUT_BLOCKS, OUTPUT_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/output.js";
import { config, engineState, engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickChannelLayout } from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";

/** The network backend's DoP setting, off on the wire. */
const DOP = "net_dop";

/** The network backend's DSD rates setting, on on the wire. */
const DSD_RATES = "net_anydsd";

/** A checkbox segment's options. */
const ON = "1";
const OFF = "0";

/** The drawer row style every row carries. */
const ROW = "drow";

/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

beforeEach(async () => {
  wire = stagingWire();
  config.value = {
    fields: [
      { name: "mode", type: "select", value: "pcm" },
      { name: "backend", type: "select", value: "network" },
      { name: "defaults_samplerate", type: "select", value: "192000" },
      { name: "defaults_bitrate", type: "select", value: "12288000" },
      { name: "channels", type: "number", value: 2 },
      { name: "net_device", type: "select", value: NET, options: [{ value: NET, label: "naa-office: card: iface" }] },
      { name: DOP, type: "checkbox", value: false },
      { name: DSD_RATES, type: "checkbox", value: true },
      { name: "net_bits", type: "number", value: 20 },
      { name: "net_ipv6", type: "checkbox", value: true },
      { name: "net_period", type: "number", value: 0 },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: null,
  };
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = null;
  openStage.value = null;
  openPopover.value = null;
  await pickChannelLayout("2");
  await discardAll();
});

const tree = () => html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`;

const markup = () => elements(render(tree()));

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/**
 * The control drawn for `key`: the first element carrying it as its catalog key.
 *
 * @param {MarkupElement[]} all
 * @param {string} key
 */
const control = (all, key) => all.find((e) => attr(e, "data-k") === key);

/**
 * The smallest drawer row enclosing every one of `inner`, or undefined when one of them is missing or no row holds
 * them all.
 *
 * @param {MarkupElement[]} all
 * @param {(MarkupElement | undefined)[]} inner
 */
function rowHolding(all, inner) {
  if (inner.some((e) => e === undefined)) return undefined;
  const held = /** @type {MarkupElement[]} */ (inner);
  return all
    .filter((e) => classes(e).includes(ROW) && held.every((i) => within(i, e)))
    .sort((a, b) => a.html.length - b.html.length)[0];
}

/**
 * Whether the row holding the control drawn for `key` reads dirty, or null when no row holds it.
 *
 * @param {string} key
 */
function rowDirty(key) {
  const all = markup();
  const row = rowHolding(all, [control(all, key)]);
  return row ? hasAttr(row, "data-dirty") : null;
}

/** The number of labels the smallest row holding both DSD controls prints, or null when no row holds both. */
function sharedRowLabels() {
  const all = markup();
  const row = rowHolding(all, [control(all, DOP), control(all, DSD_RATES)]);
  return row ? elements(row.html).filter((e) => e.name === "b").length : null;
}

/**
 * Click the `value` option inside the control drawn for `key`, and let the wire go quiet. Nothing is clicked when the
 * control draws no such option, or when the drawer's option buttons of that value do not pair one to one with its
 * vnodes.
 *
 * @param {string} key
 * @param {string} value
 */
async function pick(key, value) {
  const { out, seen } = renderTree(tree());
  const all = elements(out);
  const own = control(all, key);
  const options = all.filter((e) => e.name === "button" && attr(e, "data-v") === value);
  const at = own ? options.findIndex((e) => within(e, own)) : -1;
  const vnodes = seen.filter((v) => v.type === "button" && v.props?.["data-v"] === value);
  const hit = at >= 0 && vnodes.length === options.length ? vnodes[at] : undefined;
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
  await quiesce(wire);
}

/** The settings the wire's http lane holds staged, in name order. */
const stagedNames = () => Object.keys(wire.staged.http).sort();

test("test_the_row_holding_both_dsd_controls_prints_a_single_label", () => {
  assert.equal(sharedRowLabels(), 1);
});

test("test_staging_dop_marks_the_row_holding_dsd_rates_dirty", async () => {
  await edit(DOP, ON);
  assert.equal(rowDirty(DSD_RATES), true);
});

test("test_staging_dsd_rates_marks_the_row_holding_dop_dirty", async () => {
  await edit(DSD_RATES, OFF);
  assert.equal(rowDirty(DOP), true);
});

test("test_picking_an_option_on_the_dop_control_stages_dop_only", async () => {
  await pick(DOP, ON);
  assert.deepEqual(stagedNames(), [DOP]);
});

test("test_picking_an_option_on_the_dsd_rates_control_stages_dsd_rates_only", async () => {
  await pick(DSD_RATES, OFF);
  assert.deepEqual(stagedNames(), [DSD_RATES]);
});
