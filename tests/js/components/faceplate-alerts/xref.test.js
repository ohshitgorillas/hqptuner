// Rendered suite for the cross-reference links the stage drawer prints (hqptuner/static/components/faceplate/Xref.js):
// a gray reason naming a place in another drawer, or on another tab of its own, links there and one on the tab it names
// does not, the Volume drawer's fixed-volume reason on its Gain and Range tabs links its Level tab, an intro's named
// place links there, and Shaping's dither note links to the Output drawer. A tap on a link opens the drawer it names on
// the tab it names and keeps the page where it is.
//
// Renders `Drawer` through preact-render-to-string; a tap is fired through the vnode seam (tests/js/support/vnodeseam.js)
// and the store is driven at the wire by the staging fake. Links are found by their target id (`data-to`); every value
// asserted is a place id or a drawer or tab id, never a label.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/xref.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { SHAPING_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/modes.js";
import { VOLUME_BLOCKS, VOLUME_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/volume.js";
import { OUTPUT_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/output.js";
import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openList, openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { showTab, shownTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr, classes } from "../../support/markup.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").BodyItem} BodyItem */
/** @typedef {import("../../../../hqptuner/static/components/faceplate/drawer/Rows.js").Blocks} Blocks */

/**
 * Load the /config form: the volume range's bounds, fixed volume, the backend and its DAC bits.
 *
 * @param {{ min: number, max: number, fixed?: boolean }} form
 */
function load({ min, max, fixed = false }) {
  config.value = {
    fields: [
      { name: "volume_min", type: "number", value: min },
      { name: "volume_max", type: "number", value: max },
      { name: "fixed_volume_enabled", type: "checkbox", value: fixed },
      { name: "backend", type: "select", value: "alsa" },
      { name: "alsa_bits", type: "number", value: 24 },
    ],
    file: {},
    active: "",
    profiles: null,
  };
}

beforeEach(async () => {
  stagingWire();
  load({ min: 0, max: 0 });
  engineState.value = { state: "0", active_chain: "pcm", adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  openList.value = null;
  showTab("volume", "gain");
  showTab("output", "device");
  cancel();
  await discardAll();
});

/**
 * A drawer of one tab holding the given items.
 *
 * @param {string} id
 * @param {BodyItem[]} body
 * @param {string} [tab]  the tab's id
 * @returns {DrawerSchema}
 */
const drawerOf = (id, body, tab = "only") => ({ id, title: id, aria: id, tabs: [{ id: tab, label: tab, body }] });

/** A row grayed by the volume range's reason. */
const ADAPTIVE = [{ row: { key: "adaptive_volume" } }];

/** An intro naming the Crossfeed drawer. */
const INTRO = [{ intro: ["a", { label: "x", to: "crossfeed" }, "b"] }];

/**
 * The target of the first link a drawer prints, or undefined when it prints none.
 *
 * @param {DrawerSchema} schema
 * @returns {string | undefined}
 */
function linkTo(schema) {
  const link = elements(render(html`<${Drawer} schema=${schema} />`)).find((e) => attr(e, "data-to") !== undefined);
  return link ? attr(link, "data-to") : undefined;
}

/**
 * The target of the link in the first gray reason one tab's panel prints, or undefined when it carries none.
 *
 * @param {DrawerSchema} schema
 * @param {Blocks} blocks
 * @param {string} tab
 * @returns {string | undefined}
 */
function reasonLinkOnTab(schema, blocks, tab) {
  const all = elements(render(html`<${Drawer} schema=${schema} blocks=${blocks} />`));
  const panel = all.find((e) => classes(e).includes("dpanel") && attr(e, "data-tab") === tab);
  const gray = panel ? elements(panel.html).find((e) => classes(e).includes("gr")) : undefined;
  const link = gray ? elements(gray.html).find((e) => attr(e, "data-to") !== undefined) : undefined;
  return link ? attr(link, "data-to") : undefined;
}

/**
 * Tap the drawer's link to `to`; whether the tap held the page where it is.
 *
 * @param {DrawerSchema} schema
 * @param {string} to
 * @returns {boolean}
 */
function tap(schema, to) {
  const { seen } = renderTree(html`<${Drawer} schema=${schema} />`);
  const hit = seen.find((v) => typeof v.type === "string" && v.props?.["data-to"] === to);
  const fn = /** @type {((e: { preventDefault: () => void }) => unknown) | undefined} */ (hit?.props.onClick);
  let held = false;
  if (fn) fn({ preventDefault: () => (held = true) });
  return held;
}

test("test_a_gray_reason_naming_the_range_links_to_it", () => {
  assert.equal(linkTo(drawerOf("rows", ADAPTIVE)), "volume-range");
});

test("test_a_gray_reason_on_the_tab_it_names_carries_no_link", () => {
  assert.deepEqual(
    [linkTo(drawerOf("volume", ADAPTIVE, "gain")), linkTo(drawerOf("volume", ADAPTIVE, "range"))],
    ["volume-range", undefined],
  );
});

test("test_the_fixed_volume_reason_on_the_gain_tab_links_the_level_tab", () => {
  load({ min: -60, max: 0, fixed: true });
  assert.equal(reasonLinkOnTab(VOLUME_DRAWER, VOLUME_BLOCKS, "gain"), "volume-level");
});

test("test_the_fixed_volume_reason_on_the_range_tab_links_the_level_tab", () => {
  load({ min: -60, max: 0, fixed: true });
  assert.equal(reasonLinkOnTab(VOLUME_DRAWER, VOLUME_BLOCKS, "range"), "volume-level");
});

test("test_tapping_a_link_keeps_the_page_where_it_is", () => {
  assert.equal(tap(drawerOf("rows", ADAPTIVE), "volume-range"), true);
});

test("test_tapping_a_gray_reasons_link_opens_the_drawer_it_names", () => {
  tap(drawerOf("rows", ADAPTIVE), "volume-range");
  assert.equal(openStage.value, "volume");
});

test("test_tapping_a_gray_reasons_link_shows_the_tab_it_names", () => {
  tap(drawerOf("rows", ADAPTIVE), "volume-range");
  assert.equal(shownTab(VOLUME_DRAWER), "range");
});

test("test_an_intros_named_place_links_there", () => {
  assert.equal(linkTo(drawerOf("matrix", INTRO)), "crossfeed");
});

test("test_tapping_an_intros_link_opens_the_drawer_it_names", () => {
  tap(drawerOf("matrix", INTRO), "crossfeed");
  assert.equal(openStage.value, "crossfeed");
});

test("test_shapings_dither_note_links_to_the_output_drawer", () => {
  assert.equal(linkTo(SHAPING_DRAWER), "output");
});

test("test_tapping_the_dither_notes_link_shows_the_output_format_tab", () => {
  tap(SHAPING_DRAWER, "output");
  assert.equal(shownTab(OUTPUT_DRAWER), "format");
});
