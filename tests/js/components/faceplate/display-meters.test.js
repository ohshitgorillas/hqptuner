// Rendered suite for the Display popover's meter rows in the frame the entry composes (hqptuner/static/app.js). In
// Compact and Normal, where the Source meter is slim, the popover offers a Meters choice, Levels or VU, and the row
// after it follows the pick: the Levels floor with Levels picked, the VU reference with VU picked, never both. In
// Expanded, where the meter is full, there is no Meters choice and the popover holds both the Levels floor and the VU
// reference. The popover's other rows are tests/js/components/faceplate/display.test.js's and display-range.test.js's.
//
// The format is chosen through the prefs module's setter in a window larger than every format, so the plate is laid
// out at the chosen one. The panel is the `div` carrying the popover's id in `data-pop`; its options are found inside
// it by their values in `data-v`, the preferences' own identifiers, a component among its children rendered on its
// own so its buttons are reached too. A pick is fired through the vnode seam (tests/js/support/vnodeseam.js), since
// server rendering fires no events. The Meters, VU reference and Levels floor surfaces are read off the prefs module's
// namespace with optional access, so a store without one fails these cases on their assertions.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/display-meters.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { h } from "preact";

import "../../support/domseam.js";
import { useStorage } from "../../support/storage.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import { body, openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

/**
 * The surfaces these cases drive on the prefs module.
 *
 * @type {{
 *   setDisplayFormat?(v: string): void,
 *   meters?: { value: string },
 *   setMeters?(v: string): void,
 *   vuReference?: { value: string },
 *   setVuReference?(v: string): void,
 *   setMeterFloor?(v: string): void,
 * }}
 */
const prefs = uiPrefs;

//: The Display popover's id, which its trigger and its panel both carry as `data-pop`.
const DISPLAY = "display";

// The format ids: the two where the Source meter is slim, and the one where it is full.
const SLIM_FORMATS = ["compact", "normal"];
const EXPANDED = "expanded";

//: A window larger than every format, so a chosen format is laid out as itself.
const LARGE = { w: 1500, h: 1100 };

// The two meters, as the store holds them.
const LEVELS = "levels";
const VU = "vu";

// Two VU references on offer, as the store holds them in dBFS: the one each case starts from, and another so a pick of
// it shows.
const VU_START = "-14";
const VU_PICKED = "-20";

//: A Levels floor on offer, as the store holds it in dBFS, which no VU reference shares.
const FLOOR = "-90";

beforeEach(() => {
  useStorage();
  body.value = "chain";
  openStage.value = null;
  viewport.value = LARGE;
  prefs.setDisplayFormat?.(EXPANDED);
  prefs.setMeters?.(LEVELS);
  prefs.setVuReference?.(VU_START);
  prefs.setMeterFloor?.(FLOOR);
  openPopover.value = DISPLAY;
});

/**
 * Every vnode under `node`, a component's rendered output included.
 *
 * @param {unknown} node
 * @param {VNode[]} acc
 * @returns {VNode[]}
 */
function walk(node, acc = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, acc));
    return acc;
  }
  if (!node || typeof node !== "object" || !("type" in node)) return acc;
  const vnode = /** @type {VNode} */ (node);
  if (typeof vnode.type === "function") {
    acc.push(...renderTree(h(/** @type {any} */ (vnode.type), vnode.props)).seen);
  } else {
    acc.push(vnode, ...walk(vnode.props?.children));
  }
  return acc;
}

/**
 * The buttons inside the Display panel, as the frame draws it now.
 *
 * @returns {VNode[]}
 */
function panelButtons() {
  const { seen } = renderTree(html`<${Faceplate} />`);
  const panel = seen.find((n) => n.type === "div" && n.props?.["data-pop"] === DISPLAY);
  return walk(panel?.props.children).filter((n) => n.type === "button");
}

/**
 * Which of `values` the Display panel offers a button for, sorted.
 *
 * @param {string[]} values
 * @returns {string[]}
 */
function offered(values) {
  const here = new Set(panelButtons().map((n) => n.props?.["data-v"]));
  return values.filter((v) => here.has(v)).sort();
}

/**
 * Pick the option carrying value `v` inside the Display panel, or nothing when the panel holds no button carrying it.
 *
 * @param {string} v
 */
function pick(v) {
  const fn = panelButtons().find((n) => n.props?.["data-v"] === v)?.props.onClick;
  if (typeof fn === "function") fn({ preventDefault() {}, stopPropagation() {} });
}

for (const format of SLIM_FORMATS) {
  test(`test_in_${format}_picking_vu_in_the_display_popover_sets_the_meters_pick`, () => {
    prefs.setDisplayFormat?.(format);
    pick(VU);
    assert.equal(prefs.meters?.value, VU);
  });

  test(`test_in_${format}_with_vu_picked_the_display_popover_offers_the_vu_reference_in_place_of_the_levels_floor`, () => {
    prefs.setDisplayFormat?.(format);
    prefs.setMeters?.(VU);
    assert.deepEqual(offered([FLOOR, VU_PICKED]), [VU_PICKED]);
  });

  test(`test_in_${format}_with_vu_picked_picking_a_vu_reference_in_the_display_popover_sets_it`, () => {
    prefs.setDisplayFormat?.(format);
    prefs.setMeters?.(VU);
    pick(VU_PICKED);
    assert.equal(prefs.vuReference?.value, VU_PICKED);
  });
}

test("test_in_expanded_the_display_popover_offers_both_the_levels_floor_and_the_vu_reference_whatever_the_meters_pick", () => {
  prefs.setMeters?.(VU);
  assert.deepEqual(offered([FLOOR, VU_PICKED]), [FLOOR, VU_PICKED].sort());
});

test("test_in_expanded_picking_a_vu_reference_in_the_display_popover_sets_it", () => {
  pick(VU_PICKED);
  assert.equal(prefs.vuReference?.value, VU_PICKED);
});
