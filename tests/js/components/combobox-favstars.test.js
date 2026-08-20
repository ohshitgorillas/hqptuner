// Behavioral suite for the favorites-heart-quality-stars change on the custom
// combobox (controls/Combobox.js): the option row's favorite toggle now shows
// a heart — ♥ while the filter is a favorite, ♡ while it is not — where it
// used to show ★/☆, and the stars now mean quality instead: an optional
// `stars` accessor (wired the way `fav`/`badge` are, a function of the option)
// renders a span of class "dd-stars" reading q filled ★ followed by (5-q)
// empty ☆ for a row rated q, no span at all for a row the accessor rates null,
// and no span anywhere in a dropdown given no accessor.
//
// Spec ambiguity, reading taken: the spec names the accessor's contract but
// not its wiring's data source. The fav/badge parallel is read literally —
// Field wires it for the filter dropdowns — and q is read as the filter's
// quality facet, the `<q>/5` head of the engine enumeration's own description
// (protocol.md:228); a filter the live enum never lists has no rating, so its
// accessor answer is the null case. A failure here may be that reading, not
// the glyph contract — adjudicate before treating it as one.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. State is driven through the field harness's reset (source signals
// plus a faked wire); /api/favorites is routed into the harness wire the way
// combobox-fav.test.js routes it, and the favorites set is re-assigned per
// case because module-level signals outlive a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-favstars.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field } from "../support/field-harness.js";
import { staticWire } from "../support/wire.js";
import { favoritesState, favoritesRoutes } from "../support/favoriteswire.js";
import { favoriteFilters, favoritesError } from "../../../hqptuner/static/store/narrow/favorites.js";
import { enums } from "../../../hqptuner/static/store/signals.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";
import { elements, classes, text } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// Three rated filters and one the live enum never lists. Descriptions are the
// engine's own format, `"<q>/5 [focus, ...] <glyph> <ratio>"` (protocol.md:228).
/** @type {[string, string | null][]} name, description (null = not enumerated) */
const FILTERS = [
  ["rated-one", "1/5 transients ⥮ Int"],
  ["rated-three", "3/5 timbre ⥮ Any"],
  ["rated-five", "5/5 timbre, space ⥮ Any"],
  ["unlisted", null],
];

/**
 * One dropdown entry whose options carry the given labels in order.
 *
 * @param {string} name
 * @param {string[]} labels
 */
const dropdown = (name, labels) => ({
  name,
  value: "0",
  options: labels.map((label, i) => ({ value: String(i), label })),
});

// A desc-carrying dropdown Field does NOT hand the fav/stars wiring: a dither.
// The rate sits above NS9's 352.8k floor so no row is rate-grayed, and no
// favorites wire is needed — an unwired dropdown fetches nothing of it.
const startDither = () =>
  reset({ fields: [{ name: "defaults_samplerate", value: "384000" }, dropdown("dither", ["TPDF", "NS9"])] });

// The filter field with the live enumeration serving the ratings, the
// favorites endpoint routed into the harness wire, the favorites signals
// re-assigned (module-level signals outlive a test), and the narrowing facets
// opened all the way (apodizing neutral, quality floor 0) so every row
// renders, the unrated one included.
async function startFilters() {
  await reset({
    fields: [
      dropdown(
        "filter1x",
        FILTERS.map(([label]) => label),
      ),
    ],
  });
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
  enums.value = {
    filters: FILTERS.filter(([, d]) => d !== null).map(([name, description], i) => ({
      index: String(i),
      name,
      value: String(i),
      arg: "0",
      description,
      apodizing: false,
    })),
  };
  nApod1x.value = "all";
  nQuality.value = 0;
  return field("pcm_filter_1x");
}

/** The dd-opt rows of a render. */
/** @param {string} out */
const rows = (out) => elements(out).filter((el) => classes(el).includes("dd-opt"));

/**
 * The option row whose text includes `needle`; throws when no row does, so an
 * absence fails loudly instead of comparing against nothing.
 *
 * @param {string} out
 * @param {string} needle
 */
function rowReading(out, needle) {
  const hit = rows(out).find((el) => text(el).includes(needle));
  if (!hit) throw new Error(`no option row reads "${needle}"`);
  return hit;
}

/**
 * The favorite toggle of a row, by the dd-fav marking combobox-fav.test.js
 * pins; anything but exactly one match throws.
 *
 * @param {MarkupElement} row
 */
function favToggleOf(row) {
  const found = elements(row.html).filter((el) => classes(el).includes("dd-fav"));
  if (found.length !== 1) throw new Error(`expected one favorite toggle, found ${found.length}`);
  return found[0];
}

/**
 * The dd-stars spans of a fragment (a whole render or one row's html).
 *
 * @param {string} fragment
 */
const starsSpans = (fragment) => elements(fragment).filter((el) => classes(el).includes("dd-stars"));

/**
 * The one dd-stars span of a row; anything but exactly one match throws.
 *
 * @param {MarkupElement} row
 */
function onlyStarsOf(row) {
  const found = starsSpans(row.html);
  if (found.length !== 1) throw new Error(`expected one dd-stars span, found ${found.length}`);
  return found[0];
}

// --- the favorite toggle is a heart now ------------------------------------------

test("test_an_unfavorited_rows_favorite_toggle_shows_the_empty_heart", async () => {
  const out = await startFilters();
  assert.equal(text(favToggleOf(rowReading(out, "rated-three"))), "♡");
});

test("test_a_favorited_rows_favorite_toggle_shows_the_filled_heart", async () => {
  await startFilters();
  favoriteFilters.value = new Set(["rated-five"]);
  assert.equal(text(favToggleOf(rowReading(field("pcm_filter_1x"), "rated-five"))), "♥");
});

// One row favorited, the rest not: neither state of the toggle shows the star
// glyphs the heart replaced — those belong to the quality span now.
test("test_no_rows_favorite_toggle_shows_a_star_glyph_in_either_state", async () => {
  await startFilters();
  favoriteFilters.value = new Set(["rated-five"]);
  assert.deepEqual(
    rows(field("pcm_filter_1x")).map((r) => /[★☆]/.test(text(favToggleOf(r)))),
    [false, false, false, false],
  );
});

// --- the quality stars ----------------------------------------------------------

test("test_a_three_rated_rows_stars_span_reads_three_filled_then_two_empty", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowReading(out, "rated-three"))), "★★★☆☆");
});

test("test_a_one_rated_rows_stars_span_reads_one_filled_then_four_empty", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowReading(out, "rated-one"))), "★☆☆☆☆");
});

test("test_a_five_rated_rows_stars_span_reads_five_filled_stars", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowReading(out, "rated-five"))), "★★★★★");
});

test("test_a_row_the_accessor_cannot_rate_renders_no_stars_span", async () => {
  const out = await startFilters();
  assert.equal(starsSpans(rowReading(out, "unlisted").html).length, 0);
});

test("test_a_dropdown_without_stars_wiring_renders_no_stars_span", async () => {
  await startDither();
  assert.equal(starsSpans(field("pcm_dither")).length, 0);
});
