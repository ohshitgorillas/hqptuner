// Behavioral suite for the filter LENGTH facet (store/narrow/facets.js): which length a filter carries, overlay-first with the name-token rules as fallback.
//
// The overlay row in data/filters.json may state a `length` token outright, and an explicit overlay length wins over anything the name says. Where no overlay row speaks, the name-token rules classify: the words short/medium/long, the halfband suffixes -hb-s and -hb-l, the -xl/-xla suffixes, with a trailing -2s stripped first. The -hb-xs suffix is NOT a name rule: an xshort length reaches a filter only through an overlay `length: "xshort"` row. A name no rule reaches carries "" — no length. (The adaptive boolean and the narrowing over it are pinned in tests/js/store/length-adaptive.test.js.)
//
// Every name here is synthetic — no real filter's classification is asserted; the rules themselves are the subject.
//
// Policy (docs/testing.md): public API only, one assertion per test, no snapshots. Overlay rows reach the frontend two ways, and both are exercised: merged onto a live enum item under its `static` key the way the backend serves `<GetFilters/>` (protocol.md), and as entries of `metadata.value.filters.filters` keyed by name for filters the live enum does not carry (architecture.md §2).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/length-facet.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterFacets } from "../../../hqptuner/static/store/narrow/facets.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

/**
 * A static overlay row as filters.json ships it.
 *
 * @typedef {{ genre?: string[], quality?: number, focus?: string[], phase?: string, description?: string, length?: string, adaptive?: boolean }} OverlayRow
 */

/**
 * One `<FiltersItem/>` as the backend serves it: the engine's enumeration
 * fields plus the backend-merged overlay row under `static` (undefined on an
 * overlay miss).
 *
 * @param {string} name
 * @param {number} index
 * @param {OverlayRow} [staticRow]
 */
const item = (name, index, staticRow) => ({
  index: String(index),
  name,
  value: String(index),
  arg: 0,
  description: "3/5 ⥮ Any",
  apodizing: false,
  static: staticRow,
});

/**
 * Reseed both source signals with LIVE-enum filters — module-level signals
 * outlive a test, so every case reassigns the pair in full. Each entry's
 * overlay row (or undefined) rides the item's `static` key, the way the
 * backend merges it.
 *
 * @param {Record<string, OverlayRow | undefined>} rowsByName
 */
function seed(rowsByName) {
  const names = Object.keys(rowsByName);
  enums.value = { filters: names.map((name, i) => item(name, i, rowsByName[name])) };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
}

/**
 * Reseed with an EMPTY live enum: the names exist only as keys of the static
 * metadata overlay, which fills facets for names the engine did not enumerate.
 *
 * @param {Record<string, OverlayRow>} overlay
 */
function seedOverlayOnly(overlay) {
  enums.value = { filters: [] };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
}

/** @param {string} name */
const lengthOf = (name) => filterFacets.value[name].length;

// --- an overlay length token classifies outright, on both paths --------------
// `gauss-plain` matches no name rule, so the length below can only have come
// from the overlay row.

const TOKENS = ["short", "medium", "long", "xlong", "xshort", "stupid"];

for (const token of TOKENS) {
  test(`test_an_overlay_length_${token}_on_a_live_enum_item_facets_${token}`, () => {
    seed({ "gauss-plain": { length: token } });
    assert.equal(lengthOf("gauss-plain"), token);
  });
}

for (const token of TOKENS) {
  test(`test_an_overlay_length_${token}_known_only_to_the_overlay_facets_${token}`, () => {
    seedOverlayOnly({ "gauss-plain": { length: token } });
    assert.equal(lengthOf("gauss-plain"), token);
  });
}

// --- an explicit overlay length wins over a name-token rule ------------------

test("test_an_overlay_length_wins_over_the_name_rule", () => {
  seed({ "gauss-short": { length: "long" } });
  assert.equal(lengthOf("gauss-short"), "long");
});

// --- overlay silent on length: the name rules are the fallback ---------------

test("test_an_overlay_row_without_a_length_falls_back_to_the_name_rule", () => {
  seed({ "gauss-short": {} });
  assert.equal(lengthOf("gauss-short"), "short");
});

// --- a length word in the name classifies by that word -----------------------

for (const [name, expected] of [
  ["gauss-short", "short"],
  ["gauss-medium", "medium"],
  ["gauss-long", "long"],
]) {
  test(`test_a_name_carrying_${expected}_classifies_as_${expected}`, () => {
    seed({ [name]: undefined });
    assert.equal(lengthOf(name), expected);
  });
}

// --- halfband suffixes classify by their documented length words -------------

for (const [name, expected] of [
  ["gauss-hb-s", "short"],
  ["gauss-hb-l", "long"],
]) {
  test(`test_the_halfband_suffix_of_${name.replace(/-/g, "_")}_gives_${expected}`, () => {
    seed({ [name]: undefined });
    assert.equal(lengthOf(name), expected);
  });
}

// --- xl / xla suffixes -------------------------------------------------------

for (const name of ["gauss-xl", "gauss-xla"]) {
  test(`test_${name.replace(/-/g, "_")}_classifies_as_xlong`, () => {
    seed({ [name]: undefined });
    assert.equal(lengthOf(name), "xlong");
  });
}

// --- the two-stage suffix is stripped before classifying ---------------------
// The subject's bucket is reachable only after the strip: `-l-2s` ends in the
// two-stage suffix, so an implementation that never strips sees no halfband
// length suffix at all.

test("test_a_trailing_2s_suffix_is_stripped_before_classifying", () => {
  seed({ "gauss-hb-l-2s": undefined });
  assert.equal(lengthOf("gauss-hb-l-2s"), "long");
});

// --- -hb-xs is not a name rule -----------------------------------------------
// The xshort length comes only from an overlay `length: "xshort"` row (pinned
// above); the suffix alone carries nothing.

test("test_an_hb_xs_name_with_no_overlay_row_has_no_length", () => {
  seed({ "gauss-hb-xs": undefined });
  assert.equal(lengthOf("gauss-hb-xs"), "");
});

// --- nothing matched ---------------------------------------------------------

test("test_a_name_matching_no_length_rule_has_no_length", () => {
  seed({ "gauss-plain": undefined });
  assert.equal(lengthOf("gauss-plain"), "");
});
