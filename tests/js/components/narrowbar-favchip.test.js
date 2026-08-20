// Behavioral suite for the favorites facet chip's copy on the narrow bar
// (components/narrowbar/Bar.js): the chip reads "♥ Favorites", and its tooltip
// depends on whether any favorites exist — "Show only the filters you
// favorited in the dropdowns below" when some do, "Favorite a filter below to
// enable" when none do. Owner-approved copy, pinned character for character.
//
// Spec ambiguity, reading taken: "tooltip" is read as the chip's hover `title`
// attribute, the way the narrow bar's other explainers surface when notes are
// hidden (narrowbar-lossy.test.js).
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The bar is reset through the shared narrowbarview harness, with
// /api/favorites routed into the suite's wire and the favorites signals
// re-assigned per case because module-level signals outlive a test. The chip
// is found among the bar's buttons by its favorites marking (a class token,
// title, aria-label, heart or star glyph naming favorites); anything but
// exactly one match throws rather than reading some other control.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-favchip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { resetBar, renderBar, decode } from "../support/narrowbarview.js";
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
 * The bar's favorites chip: the one button marked as the favorites control.
 *
 * @returns {MarkupElement}
 */
function favChip() {
  const out = renderBar();
  const marked = elements(out)
    .filter((el) => el.name === "button")
    .filter((el) => /fav|♥|♡|★|☆/i.test(`${el.attrs} ${text(el)}`));
  if (marked.length !== 1) throw new Error(`expected one favorites chip, found ${marked.length}`);
  return marked[0];
}

/**
 * The hover title of an element, entities put back; throws when it carries
 * none, so an absent tooltip fails loudly instead of comparing undefined.
 *
 * @param {MarkupElement} el
 * @returns {string}
 */
function titleOf(el) {
  const raw = (/(?:^|\s)title="([^"]*)"/.exec(el.attrs) || [])[1];
  if (raw === undefined) throw new Error("the chip carries no title");
  return decode(raw);
}

// --- the label -------------------------------------------------------------------

test("test_the_facets_chip_labels_favorites_with_the_filled_heart", async () => {
  await reset();
  assert.equal(decode(text(favChip())), "♥ Favorites");
});

// --- the tooltip follows whether anything is favorited ---------------------------

test("test_with_no_favorites_the_chip_tooltip_invites_favoriting_a_filter", async () => {
  await reset();
  assert.equal(titleOf(favChip()), "Favorite a filter below to enable");
});

test("test_with_a_favorite_the_chip_tooltip_describes_the_narrowing", async () => {
  await reset();
  favoriteFilters.value = new Set(["gauss-plain"]);
  assert.equal(titleOf(favChip()), "Show only the filters you favorited in the dropdowns below");
});
