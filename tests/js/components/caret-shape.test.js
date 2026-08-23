// Behavioral suite for the narrow bar's dropdown MARKS as markup: the caret
// every facet select button carries, and the caption beside it.
//
// The caret is a shape CSS draws, not a character a font renders, so it is an
// EMPTY element and the button's caption is its label alone. That is a
// wire-side fact about the markup — element and class, not wording — so it is
// asserted here rather than left to the stylesheet (docs/testing.md rule 9: CSS
// classes are contract, the words beside them are not).
//
// Scope is the narrow bar only. The other half of the same contract, the
// disclosure mark a collapsible card's head carries and the direction class on
// it, is pinned in tests/js/components/common.test.js; no claim is made here
// about any surface this file does not render.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. The bar is reset and rendered through
// tests/js/support/genrepopover.js, driven by the engine's own `<GetFilters/>`
// enumeration (protocol.md:226). The rendered markup is read through
// tests/js/support/markup.js, by element and class token, so a decorative
// attribute added to a mark changes nothing here.
//
// The carets are counted against the bar's own facet blocks, so a bar that
// renders the mark on one button and drops it on the rest fails rather than
// passing on a shorter list.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/caret-shape.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { phaseLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";
import { resetNarrowBar, renderNarrowBar } from "../support/genrepopover.js";
import { elements, classes, attr, hasAttr, text } from "../support/markup.js";

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
 * Every dropdown caret of a rendering, in document order.
 *
 * @param {string} out
 * @returns {import("../support/markup.js").MarkupElement[]}
 */
const carets = (out) => elements(out).filter((el) => classes(el).includes("multi-caret"));

/**
 * The bar's facet blocks, one per select button: a facet is the block carrying
 * its own name in `data-multi`, which is how tests/js/support/genrepopover.js
 * finds one to click.
 *
 * @param {string} out
 * @returns {import("../support/markup.js").MarkupElement[]}
 */
const facetBlocks = (out) => elements(out).filter((el) => hasAttr(el, "data-multi"));

/**
 * One facet's own select button.
 *
 * @param {string} out
 * @param {string} name
 * @returns {import("../support/markup.js").MarkupElement}
 */
function selectButton(out, name) {
  const block = facetBlocks(out).find((el) => attr(el, "data-multi") === name);
  if (!block) throw new Error(`no facet block for ${name} in the rendered bar`);
  const button = elements(block.html).find((el) => el.name === "button");
  if (!button) throw new Error(`the ${name} facet renders no select button`);
  return button;
}

// --- the narrow bar's dropdown carets -------------------------------------------

// One caret per facet block, each of them empty: the expected list is built
// from the bar's own facets, so a caret dropped from one button shortens the
// left side and fails.
test("test_every_narrow_bar_select_button_renders_an_empty_caret", async () => {
  await resetNarrowBar(FILTERS);
  const out = renderNarrowBar();
  assert.deepEqual(
    carets(out).map(text),
    facetBlocks(out).map(() => ""),
  );
});

test("test_the_narrow_bar_emits_no_disclosure_glyph_as_text", async () => {
  await resetNarrowBar(FILTERS);
  assert.deepEqual(glyphsIn(renderNarrowBar()), []);
});

// The caption the user reads is the label and nothing else — no trailing caret
// character riding along in the text. Neither side is a literal: the rendered
// button is compared against the module's own wording, so what the words SAY
// stays the owner's business (docs/testing.md rule 9).
test("test_a_narrow_bar_select_buttons_caption_is_its_label_alone", async () => {
  await resetNarrowBar(FILTERS);
  assert.equal(text(selectButton(renderNarrowBar(), "phase")), phaseLabel());
});
