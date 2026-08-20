// Behavioral suite for the favorites-heart-quality-stars change on the custom
// combobox (controls/Combobox.js): the option row's favorite toggle now shows
// a heart — ♥ while the filter is a favorite, ♡ while it is not — where it
// used to show ★/☆, and the stars now mean quality instead: an optional
// `stars` accessor (wired the way `fav`/`badge` are, a function of the option)
// renders a span of class "dd-stars" reading exactly q filled ★ and nothing
// else for a row rated q — quality is the run length alone, no empty ☆ pad —
// no span at all for a row the accessor rates null, and no span anywhere in a
// dropdown given no accessor.
//
// Wiring, per the clarified spec line: the accessor is wired for filter
// dropdowns only when Simplified display is on (plainNames true), the same
// gate as the apodizing badge; with Standard display no dd-stars span renders
// anywhere. q is the filter's quality facet, the `<q>/5` head of the engine
// enumeration's own description (protocol.md:228); a filter the live enum
// never lists has no rating, so its accessor answer is the null case. The
// fixture names are unknown to the plain-names data, so Simplified display
// falls back to their raw labels (combobox-plainnames.test.js pins that).
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
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
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
// Simplified display stays ON and the enumeration serves a rated entry whose
// name matches a dither label, so the span's absence here is the wiring rule
// at work — a dropdown wrongly handed the accessor would render stars on the
// TPDF row and fail.
async function startDither() {
  await reset({ fields: [{ name: "defaults_samplerate", value: "384000" }, dropdown("dither", ["TPDF", "NS9"])] });
  enums.value = {
    filters: [{ index: "0", name: "TPDF", value: "0", arg: "0", description: "5/5 timbre ⥮ Any", apodizing: false }],
  };
  plainNames.value = true;
}

// The filter field with the live enumeration serving the ratings, the
// favorites endpoint routed into the harness wire, the favorites signals
// re-assigned (module-level signals outlive a test), the option style set —
// Simplified by default, the stars resolver's own display gate — and the
// narrowing facets opened all the way (apodizing neutral, quality floor 0) so
// every row renders, the unrated one included.
/** @param {boolean} [plain] */
async function startFilters(plain = true) {
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
  plainNames.value = plain;
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

test("test_a_three_rated_rows_stars_span_reads_exactly_three_filled_stars", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowReading(out, "rated-three"))), "★★★");
});

test("test_a_one_rated_rows_stars_span_reads_exactly_one_filled_star", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowReading(out, "rated-one"))), "★");
});

test("test_a_five_rated_rows_stars_span_reads_exactly_five_filled_stars", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowReading(out, "rated-five"))), "★★★★★");
});

// The whole row's text, not just the span interior: a pad of empty ☆ moved
// into a sibling element outside dd-stars would slip past the exact-content
// assertions above, and the contract says the empty glyph is gone from the
// row entirely.
test("test_a_rated_rows_whole_text_carries_no_empty_star_glyph", async () => {
  const out = await startFilters();
  assert.doesNotMatch(text(rowReading(out, "rated-three")), /☆/);
});

test("test_a_row_the_accessor_cannot_rate_renders_no_stars_span", async () => {
  const out = await startFilters();
  assert.equal(starsSpans(rowReading(out, "unlisted").html).length, 0);
});

// Standard display: the same fully rated fixture, the pref off — the stars are
// gated on Simplified display the way the apodizing badge is, and the spec
// says no span renders ANYWHERE, so the whole render is scanned. The row
// lookup is a guard, not the subject: it throws unless the rated rows exist.
test("test_standard_display_renders_no_stars_span_anywhere", async () => {
  const out = await startFilters(false);
  rowReading(out, "rated-five"); // throws when the rows never rendered
  assert.equal(starsSpans(out).length, 0);
});

test("test_a_dropdown_without_stars_wiring_renders_no_stars_span", async () => {
  await startDither();
  const out = field("pcm_dither");
  rowReading(out, "TPDF"); // throws when the rows never rendered
  assert.equal(starsSpans(out).length, 0);
});
