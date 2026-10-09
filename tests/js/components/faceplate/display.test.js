// Rendered suite for the Display popover in the frame the entry composes (hqptuner/static/app.js): the panel the Source
// header's Display trigger opens, holding the spectrum's and the level bars' display options. What it offers is read
// off its own markup, and a pick writes the preference it names. Where the trigger sits is the page suite's
// (tests/js/components/faceplate/page.test.js).
//
// The panel is found as the `div` carrying the popover's id in `data-pop`, wherever in the frame it is drawn; its
// options by their values in `data-v`, the preferences' own identifiers. A pick is fired through the vnode seam
// (tests/js/support/vnodeseam.js), since server rendering fires no events. The Levels floor is read off the prefs
// module's namespace with optional access, so a store without one fails the floor cases on their assertions.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/display.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import "../../support/domseam.js";
import { useStorage } from "../../support/storage.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import { body, openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { setSpectrumStyle, spectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr } from "../../support/markup.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

//: The Display popover's id, which its trigger and its panel both carry as `data-pop`.
const DISPLAY = "display";

// Two spectrum styles, as the store holds them: the trace, and one other so a pick of it shows.
const TRACE = "trace";
const RIDGES = "ridges";

// The Levels floors the owner offers, as the store holds them, in dBFS.
const SHALLOW = "-48";
const MIDDLE = "-60";
const DEEP = "-90";

/**
 * The Levels floor's surface on the prefs module.
 *
 * @type {{ meterFloor?: { value: string }, setMeterFloor?(v: string): void }}
 */
const floorStore = uiPrefs;

beforeEach(() => {
  useStorage();
  body.value = "chain";
  openStage.value = null;
  setSpectrumStyle(TRACE);
  floorStore.setMeterFloor?.(SHALLOW);
  openPopover.value = DISPLAY;
});

/** The option values the Display panel offers, or none when the frame draws no panel. */
function offered() {
  const panel = elements(render(html`<${Faceplate} />`)).find(
    (e) => e.name === "div" && attr(e, "data-pop") === DISPLAY,
  );
  return new Set(panel ? elements(panel.html).map((e) => attr(e, "data-v")) : []);
}

/**
 * Pick the option carrying value `v`, or nothing when no button in the frame carries it.
 *
 * @param {string} v
 */
function pick(v) {
  const { seen } = renderTree(html`<${Faceplate} />`);
  const hit = seen.find((/** @type {VNode} */ n) => n.type === "button" && n.props?.["data-v"] === v);
  const fn = hit?.props.onClick;
  if (typeof fn === "function") fn({ preventDefault() {}, stopPropagation() {} });
}

test("test_the_display_popover_offers_every_levels_floor", () => {
  const values = offered();
  assert.deepEqual(
    [SHALLOW, MIDDLE, DEEP].filter((v) => values.has(v)),
    [SHALLOW, MIDDLE, DEEP],
  );
});

test("test_the_display_popover_offers_the_spectrum_styles", () => {
  const values = offered();
  assert.deepEqual(
    [TRACE, RIDGES].filter((v) => values.has(v)),
    [TRACE, RIDGES],
  );
});

test("test_picking_a_spectrum_style_in_the_display_popover_sets_it", () => {
  pick(RIDGES);
  assert.equal(spectrumStyle.value, RIDGES);
});

test("test_picking_a_levels_floor_in_the_display_popover_sets_it", () => {
  pick(DEEP);
  assert.equal(floorStore.meterFloor?.value, DEEP);
});
