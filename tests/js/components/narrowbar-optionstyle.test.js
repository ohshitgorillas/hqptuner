// Behavioral suite for the narrow bar's "Option style" switch — the segmented
// control bound to the Simplified-names preference: two segments reading
// Standard and Simplified, the active one following the pref signal, and a
// press on the other segment moving the pref (the dropdowns re-rendering in the
// other mode is the pref signal's doing and is pinned by
// tests/js/components/combobox-plainnames.test.js).
//
// The bar is read as SSR markup through tests/js/support/narrowbarview.js — a
// group is "the smallest element that encloses the title text and a segmented
// switch". The press is fired through the onClick the button's vnode carries,
// collected via preact's own `options.vnode` creation hook (the renderer's
// public seam, house pattern per tests/js/support/pointer.js) — SSR never fires
// a handler and there is no DOM here.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-optionstyle.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { resetBar, renderBar, group, hasGroup } from "../support/narrowbarview.js";
import { renderWith, propsOf } from "../support/wheel.js";
import { html } from "../../../hqptuner/static/lib/dom.js";
import { NarrowBar } from "../../../hqptuner/static/components/narrowbar/Bar.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { attr, elements, classes } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../support/wheel.js").VNode} VNode */

// The group's own machine identity, and the two wire values its switch offers.
// This switch carries WORD values rather than the "1"/"0" the card-gate
// switches use, so the pref's boolean shape says nothing about them. The words
// rendered on the two segments are copy and are asserted nowhere
// (docs/testing.md rule 9).
const TITLE = "option-style";
const STANDARD = "standard";
const SIMPLIFIED = "simplified";

/**
 * @param {boolean} plain
 * @returns {Promise<string>}
 */
async function bar(plain) {
  await resetBar([]);
  plainNames.value = plain;
  return renderBar();
}

/**
 * The wire value on the active segment of a group's switch.
 *
 * @param {MarkupElement} region
 * @returns {string | undefined}
 */
function activeIn(region) {
  const hit = elements(region.html).find(
    (el) => el.name === "button" && classes(el).includes("seg") && classes(el).includes("active"),
  );
  return hit && attr(hit, "data-v");
}

/**
 * The wire value each segment of a group's switch offers, in order.
 *
 * @param {MarkupElement} region
 * @returns {(string | undefined)[]}
 */
const segmentValues = (region) =>
  elements(region.html)
    .filter((el) => el.name === "button" && classes(el).includes("seg"))
    .sort((a, b) => a.start - b.start)
    .map((el) => attr(el, "data-v"));

// --- the switch is offered -----------------------------------------------------

test("test_the_narrow_bar_offers_an_option_style_switch", async () => {
  assert.equal(hasGroup(await bar(false), TITLE), true);
});

test("test_the_option_style_switch_offers_the_two_pref_states", async () => {
  assert.deepEqual(segmentValues(group(await bar(false), TITLE)), [STANDARD, SIMPLIFIED]);
});

// --- the switch follows the pref -------------------------------------------------

test("test_standard_is_active_while_the_pref_is_off", async () => {
  assert.equal(activeIn(group(await bar(false), TITLE)), STANDARD);
});

test("test_simplified_is_active_while_the_pref_is_on", async () => {
  assert.equal(activeIn(group(await bar(true), TITLE)), SIMPLIFIED);
});

// --- and a press moves the pref ---------------------------------------------------

test("test_pressing_simplified_moves_the_pref_on", async () => {
  await resetBar([]);
  plainNames.value = false;
  const { seen: nodes } = renderWith(html`<${NarrowBar} />`);
  // Exactly one segment in the whole bar offers this value; anything else
  // throws rather than pressing some other switch's option.
  const pressable = nodes.filter(
    (v) => v.type === "button" && propsOf(v)["data-v"] === SIMPLIFIED && propsOf(v).onClick,
  );
  if (pressable.length !== 1) throw new Error(`expected one segment valued "${SIMPLIFIED}", found ${pressable.length}`);
  /** @type {(e: Record<string, unknown>) => void} */ (propsOf(pressable[0]).onClick)({});
  assert.equal(plainNames.value, true);
});
