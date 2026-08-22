// Behavioral suite for the app's disclosure and dropdown MARKS as markup: the
// caret a narrow-bar select button carries, and the disclosure triangle a
// collapsible card's head carries.
//
// Both are shapes CSS draws, not characters a font renders, so every one of them
// is an EMPTY element and no component emits `▾`, `▴` or `▸` as text. That is a
// wire-side fact about the markup — element and class, not wording — so it is
// asserted here rather than left to the stylesheet (docs/testing.md rule 9: CSS
// classes are contract, the words beside them are not).
//
// Which direction a card's mark points is carried by the class on its `tri`
// span and is pinned in tests/js/components/common.test.js. This file asks the
// other half of the same contract: that nothing is left INSIDE the marks.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. The bar is reset and rendered through
// tests/js/support/genrepopover.js, driven by the engine's own `<GetFilters/>`
// enumeration (protocol.md:226); the System tab is rendered through the exported
// `System` over the exported `health` signal, the way
// tests/js/components/systemtab.test.js drives it.
//
// The bar's carets are read as a SET, so a bar that renders none fails these
// cases rather than passing them vacuously on an empty list.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/caret-shape.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";
import { signal } from "@preact/signals";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Card, collapseFrom } from "../../../hqptuner/static/components/common.js";
import { System } from "../../../hqptuner/static/components/tabs/SystemTab.js";
import { health } from "../../../hqptuner/static/store/signals.js";
import { resetNarrowBar, renderNarrowBar } from "../support/genrepopover.js";

// One filter is enough for the bar to render its facet row: the carets ride the
// facet buttons, which are on screen whatever the enumeration says.
const FILTERS = [
  { index: "0", name: "gauss-lp", value: "0", arg: 1, description: "4/5 timbre ⥮ Any", apodizing: true },
];

// The three glyphs that used to stand in for the shapes: down, up and right.
const GLYPHS = ["▾", "▴", "▸"];

/**
 * Every disclosure glyph a rendering emits as TEXT, once each. Empty when the
 * markup carries none, which is the whole contract.
 *
 * @param {string} out
 * @returns {string[]}
 */
const glyphsIn = (out) => GLYPHS.filter((g) => out.includes(g));

/**
 * What sits inside each of a rendering's dropdown carets, once per distinct
 * content. `[""]` is every caret empty; `[]` is a rendering with no caret in it
 * at all, which fails a case rather than satisfying it.
 *
 * @param {string} out
 * @returns {string[]}
 */
const caretBodies = (out) => [
  ...new Set([...out.matchAll(/<span class="multi-caret">([\s\S]*?)<\/span>/g)].map((m) => m[1])),
];

/**
 * A collapsible card in a stated disclosure, rendered as its caller mounts one.
 *
 * @param {boolean} open
 * @returns {string}
 */
const card = (open) =>
  render(html`<${Card} title="ALSA Backend" collapse=${collapseFrom(signal(open), signal(null))}>
    ${html`<p>kid</p>`}
  <//>`);

// --- the narrow bar's dropdown carets -------------------------------------------

test("test_every_caret_on_the_narrow_bars_select_buttons_is_an_empty_element", async () => {
  await resetNarrowBar(FILTERS);
  assert.deepEqual(caretBodies(renderNarrowBar()), [""]);
});

test("test_the_narrow_bar_emits_no_disclosure_glyph_as_text", async () => {
  await resetNarrowBar(FILTERS);
  assert.deepEqual(glyphsIn(renderNarrowBar()), []);
});

// --- the cards' disclosure marks --------------------------------------------------

test("test_an_open_collapsible_card_emits_no_disclosure_glyph_as_text", () => {
  assert.deepEqual(glyphsIn(card(true)), []);
});

test("test_a_closed_collapsible_card_emits_no_disclosure_glyph_as_text", () => {
  assert.deepEqual(glyphsIn(card(false)), []);
});

test("test_the_system_tab_emits_no_disclosure_glyph_as_text", () => {
  health.value = { info: {}, license: null };
  assert.deepEqual(glyphsIn(render(html`<${System} />`)), []);
});
