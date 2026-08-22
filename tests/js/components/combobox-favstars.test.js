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
// Wiring, per the stars-in-standard spec delta: the accessor is wired for
// every filter dropdown regardless of the Option style pref — a Standard
// (raw-name) row renders its dd-stars span exactly as a Simplified row does,
// and dropdowns without the wiring (dither etc.) render no dd-stars span in
// either display mode. q is the filter's quality facet, the `<q>/5` head of the engine
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
import { rows, rowIncluding } from "../support/comborows.js";

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
// favorites wire is needed — an unwired dropdown fetches nothing of it. The
// enumeration serves a rated entry whose name matches a dither label, so the
// span's absence here is the wiring rule at work — a dropdown wrongly handed
// the accessor would render stars on the TPDF row and fail. The Option style
// pref is irrelevant to the wiring now, so the case runs under both.
/** @param {boolean} plain */
async function startDither(plain) {
  await reset({ fields: [{ name: "defaults_samplerate", value: "384000" }, dropdown("dither", ["TPDF", "NS9"])] });
  enums.value = {
    filters: [{ index: "0", name: "TPDF", value: "0", arg: "0", description: "5/5 timbre ⥮ Any", apodizing: false }],
  };
  plainNames.value = plain;
}

// The four filter dropdowns in the contract's scope — "wired for every filter
// dropdown" — as [daemon form name, field id]: the PCM chain's two slots and
// the SDM chain's two (the daemon's /config form names the SDM filter slots
// `oversampling1x` and `oversampling`). One live `filters` enumeration serves
// all four.
/** @type {[string, string][]} */
const WIRED_FIELDS = [
  ["filter1x", "pcm_filter_1x"],
  ["filter", "pcm_filter_nx"],
  ["oversampling1x", "sdm_filter_1x"],
  ["oversampling", "sdm_filter_nx"],
];

// A filter field with the live enumeration serving the ratings, the
// favorites endpoint routed into the harness wire, the favorites signals
// re-assigned (module-level signals outlive a test), the option style set —
// Simplified by default, though the stars no longer gate on it — and the
// narrowing facets opened all the way (apodizing neutral, quality floor 0) so
// every row renders, the unrated one included. The field defaults to the PCM
// 1x slot; a case pinning another dropdown's wiring passes its pair.
/**
 * @param {boolean} [plain]
 * @param {[string, string]} [wiredField]
 */
async function startFilters(plain = true, [formName, id] = WIRED_FIELDS[0]) {
  await reset({
    fields: [
      dropdown(
        formName,
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
  return field(id);
}

// A dd-opt row is addressed by the `data-v` wire value it carries, never by the
// words in it (docs/testing.md rule 9). Both fixtures number their options in
// declaration order, so these are the values the fixture rows are offered under.
const RATED_ONE = "0";
const RATED_THREE = "1";
const RATED_FIVE = "2";
const UNLISTED = "3";
const TPDF = "0";

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
  assert.equal(text(favToggleOf(rowIncluding(out, RATED_THREE))), "♡");
});

test("test_a_favorited_rows_favorite_toggle_shows_the_filled_heart", async () => {
  await startFilters();
  favoriteFilters.value = new Set(["rated-five"]);
  assert.equal(text(favToggleOf(rowIncluding(field("pcm_filter_1x"), RATED_FIVE))), "♥");
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
  assert.equal(text(onlyStarsOf(rowIncluding(out, RATED_THREE))), "★★★");
});

test("test_a_one_rated_rows_stars_span_reads_exactly_one_filled_star", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowIncluding(out, RATED_ONE))), "★");
});

test("test_a_five_rated_rows_stars_span_reads_exactly_five_filled_stars", async () => {
  const out = await startFilters();
  assert.equal(text(onlyStarsOf(rowIncluding(out, RATED_FIVE))), "★★★★★");
});

// The whole row's text, not just the span interior: a pad of empty ☆ moved
// into a sibling element outside dd-stars would slip past the exact-content
// assertions above, and the contract says the empty glyph is gone from the
// row entirely.
test("test_a_rated_rows_whole_text_carries_no_empty_star_glyph", async () => {
  const out = await startFilters();
  assert.doesNotMatch(text(rowIncluding(out, RATED_THREE)), /☆/);
});

// The mirror for the filled glyph: with the dd-stars span's own reading taken
// out of the row text once, no ★ remains — a star run leaked into the name
// label itself (which a mark-stripping helper elsewhere would hide) leaves a
// second run behind and fails here.
test("test_a_rated_rows_text_outside_the_stars_span_carries_no_filled_star", async () => {
  const out = await startFilters();
  const row = rowIncluding(out, RATED_THREE);
  assert.doesNotMatch(text(row).replace(text(onlyStarsOf(row)), ""), /★/);
});

// Every filter dropdown is wired, not just the PCM 1x slot the cases above
// drive: the same rated fixture through the other three fields — PCM Nx and
// the SDM chain's two — renders the same exact-content span. A wiring that
// missed any one of them fails its case here.
for (const wired of WIRED_FIELDS.slice(1)) {
  test(`test_the_${wired[1]}_dropdowns_rated_row_shows_its_stars`, async () => {
    const out = await startFilters(true, wired);
    assert.equal(text(onlyStarsOf(rowIncluding(out, RATED_THREE))), "★★★");
  });
}

test("test_a_row_the_accessor_cannot_rate_renders_no_stars_span", async () => {
  const out = await startFilters();
  assert.equal(starsSpans(rowIncluding(out, UNLISTED).html).length, 0);
});

// Standard display: the same fully rated fixture, the pref off — the stars
// render regardless of the Option style pref now, so a Standard row shows the
// same exact-content span a Simplified row does, and the null case stays the
// null case.
test("test_standard_display_renders_a_rated_rows_stars_exactly_as_simplified_does", async () => {
  const out = await startFilters(false);
  assert.equal(text(onlyStarsOf(rowIncluding(out, RATED_FIVE))), "★★★★★");
});

test("test_standard_display_carries_the_run_length_of_a_lower_rating_too", async () => {
  const out = await startFilters(false);
  assert.equal(text(onlyStarsOf(rowIncluding(out, RATED_THREE))), "★★★");
});

test("test_standard_display_renders_no_stars_span_for_a_row_the_accessor_cannot_rate", async () => {
  const out = await startFilters(false);
  assert.equal(starsSpans(rowIncluding(out, UNLISTED).html).length, 0);
});

for (const [mode, plain] of /** @type {[string, boolean][]} */ ([
  ["simplified", true],
  ["standard", false],
])) {
  test(`test_a_dropdown_without_stars_wiring_renders_no_stars_span_under_${mode}_display`, async () => {
    await startDither(plain);
    const out = field("pcm_dither");
    rowIncluding(out, TPDF); // throws when the rows never rendered
    assert.equal(starsSpans(out).length, 0);
  });
}
