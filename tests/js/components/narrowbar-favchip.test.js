// Behavioral suite for the favorites facet chip on the narrow bar
// (components/narrowbar/Bar.js): that the bar puts exactly one favorites
// control on the facet row, and that the control carries a hover explainer.
//
// What the chip SAYS is not this suite's subject and is deliberately not
// pinned. The label and the two tooltips are owner-owned copy, reworded at
// will, so an assertion on their wording would go red on a copy edit while
// nothing behavioral moved (docs/testing.md rule 1). The tooltip is therefore
// read only for presence and non-emptiness — an absent or blank `title` leaves
// a reader with no explainer at all, which IS behavior.
//
// Spec ambiguity, reading taken: "tooltip" is read as the chip's hover `title`
// attribute, the way the narrow bar's other explainers surface when notes are
// hidden (narrowbar-lossy.test.js).
//
// Not covered here, covered next door: clicking the chip engages and releases
// the favorites-only narrowing, and the chip is disabled while there is nothing
// to narrow to — both pinned in narrowbar-fav.test.js against the same control,
// through preact's own vnode seam.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The bar is reset through the shared narrowbarview harness, with
// /api/favorites routed into the suite's wire and the favorites signals
// re-assigned per case because module-level signals outlive a test. The chip
// is found among the bar's buttons by its favorites marking (a class token,
// title, aria-label, heart or star glyph naming favorites); the wording inside
// that marking is never asserted on, only used to locate the control.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-favchip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { resetBar, renderBar, attr } from "../support/narrowbarview.js";
import { elements, text } from "../support/markup.js";
import { staticWire } from "../support/wire.js";
import { favoritesState, favoritesRoutes } from "../support/favoriteswire.js";
import { favoriteFilters, favoritesError, nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

const FILTERS = [
  { index: "0", name: "gauss-plain", value: "0", arg: "1", description: "5/5 timbre ⥮ Any", apodizing: true },
  { index: "1", name: "gauss-long", value: "1", arg: "0", description: "5/5 timbre ⥮ 2^x", apodizing: false },
];

async function reset() {
  await resetBar(FILTERS);
  // The favorites set is server-backed: /api/favorites is routed into the
  // suite's own wire so nothing a render fires is left hanging.
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  nFavOnly.value = false;
}

/**
 * Every button of a rendered bar marked as the favorites control.
 *
 * @returns {MarkupElement[]}
 */
function favChips() {
  const out = renderBar();
  return elements(out)
    .filter((el) => el.name === "button")
    .filter((el) => /fav|♥|♡|★|☆/i.test(`${el.attrs} ${text(el)}`));
}

/**
 * The bar's favorites chip: the one button marked as the favorites control.
 * Anything but exactly one match throws rather than reading some other control.
 *
 * @returns {MarkupElement}
 */
function favChip() {
  const marked = favChips();
  if (marked.length !== 1) throw new Error(`expected one favorites chip, found ${marked.length}`);
  return marked[0];
}

// --- the chip is on the bar ------------------------------------------------------

test("test_the_facet_row_carries_exactly_one_favorites_chip", async () => {
  await reset();
  assert.equal(favChips().length, 1);
});

// --- the chip explains itself on hover -------------------------------------------

test("test_the_favorites_chip_carries_a_hover_explainer", async () => {
  // Presence and non-emptiness only: the renderer emits an empty `title` bare,
  // with no quoted pair at all (docs/testing.md harness facts), so a chip that
  // explains nothing reads back as undefined here rather than as "".
  await reset();
  const explainer = attr(favChip(), "title");
  assert.ok(explainer !== undefined && explainer.trim() !== "", "the chip offers the reader no hover explainer");
});
