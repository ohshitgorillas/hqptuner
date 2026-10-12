// Rendered suite for the Display popover's Range rows in the frame the entry composes (hqptuner/static/app.js): the row
// that shows or hides the spectrum's −/+ Range buttons, and the Range row that sets the page's Range, which is there
// whether the buttons are shown or hidden. The popover's other rows are tests/js/components/faceplate/display.test.js's.
//
// The panel is the `div` carrying the popover's id in `data-pop`; its options are found inside it by their values in
// `data-v`, the preferences' own identifiers: the page's Ranges, and the "1" / "0" a boolean preference's segment
// carries for shown and hidden. The frame draws other "1" / "0" segments, so an option is looked for only inside the
// panel: the panel's children are walked, and a component among them is rendered on its own so its buttons are
// reached too. A pick is fired through the vnode seam (tests/js/support/vnodeseam.js), since server rendering fires no
// events. The Range buttons preference is driven by assigning its exported signal.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/display-range.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { h } from "preact";

import "../../support/domseam.js";
import { useStorage } from "../../support/storage.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import { body, openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { METER_RANGES, pageRange, rangeButtons, setPageRange } from "../../../../hqptuner/static/store/ui/prefs.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

//: The Display popover's id, which its trigger and its panel both carry as `data-pop`.
const DISPLAY = "display";

// The Range buttons preference's segment values.
const SHOW = "1";
const HIDE = "0";

// The Ranges the page offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST = ""] = METER_RANGES;
const LAST = METER_RANGES.at(-1) ?? "";

beforeEach(() => {
  useStorage();
  body.value = "chain";
  openStage.value = null;
  rangeButtons.value = true;
  setPageRange(FIRST);
  openPopover.value = DISPLAY;
});

/**
 * Every vnode under `node`, a component's rendered output included.
 *
 * @param {unknown} node
 * @param {VNode[]} out
 * @returns {VNode[]}
 */
function under(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) under(child, out);
  } else if (node && typeof node === "object" && "type" in node) {
    const vnode = /** @type {VNode} */ (node);
    if (typeof vnode.type === "function") {
      out.push(...renderTree(h(/** @type {any} */ (vnode.type), vnode.props)).seen);
    } else {
      out.push(vnode);
      under(vnode.props?.children, out);
    }
  }
  return out;
}

/**
 * Pick the option carrying value `v` inside the Display panel, or nothing when the panel holds no button carrying it.
 *
 * @param {string} v
 */
function pick(v) {
  const { seen } = renderTree(html`<${Faceplate} />`);
  const panel = seen.find((n) => n.type === "div" && n.props?.["data-pop"] === DISPLAY);
  const hit = under(panel?.props.children).find((n) => n.type === "button" && n.props?.["data-v"] === v);
  const fn = hit?.props.onClick;
  if (typeof fn === "function") fn({ preventDefault() {}, stopPropagation() {} });
}

test("test_picking_hide_then_show_in_the_display_popover_moves_the_range_buttons", () => {
  pick(HIDE);
  const hidden = rangeButtons.value;
  pick(SHOW);
  assert.deepEqual([hidden, rangeButtons.value], [false, true]);
});

test("test_picking_a_range_in_the_display_popover_sets_the_pages_range", () => {
  pick(LAST);
  assert.equal(pageRange.value, LAST);
});

test("test_picking_a_range_in_the_display_popover_with_the_buttons_hidden_sets_the_pages_range", () => {
  setPageRange(LAST);
  rangeButtons.value = false;
  pick(FIRST);
  assert.equal(pageRange.value, FIRST);
});
