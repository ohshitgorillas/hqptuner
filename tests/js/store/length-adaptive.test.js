// Behavioral suite for the ADAPTIVE facet boolean (store/narrow/facets.js), the "adaptive" pick in narrowing (store/narrow/match.js), and the hover tip's Length row (components/narrowbar/facettip.js).
//
// The boolean comes from the overlay row alone: `adaptive: true` in a filter's data/filters.json row facets adaptive, and an overlay silent on it — a row without the key, or no row at all — facets false. A filter may carry both a length and the adaptive boolean, and its tip Length row's value tokens carry both codes. The "adaptive" length pick narrows by the boolean, not by the length bucket, so an adaptive filter is kept whatever its length. (Which length a filter carries is pinned in tests/js/store/length-facet.test.js.)
//
// Every name here is synthetic — no real filter's classification is asserted; the rules themselves are the subject.
//
// Policy (docs/testing.md): public API only, one assertion per test, no snapshots. Overlay rows reach the frontend two ways, and both are exercised: merged onto a live enum item under its `static` key the way the backend serves `<GetFilters/>` (protocol.md), and as entries of `metadata.value.filters.filters` keyed by name for filters the live enum does not carry (architecture.md §2). Tip rows are pinned by key and value-token only — no label wording, no ordering.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/length-adaptive.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterFacets } from "../../../hqptuner/static/store/narrow/facets.js";
import { nLength, resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions, narrowCount } from "../../../hqptuner/static/store/narrow/match.js";
import { filterTipFacets } from "../../../hqptuner/static/components/narrowbar/facettip.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

const STAGE = "nx";
const FIELD = "pcm_filter_nx";

/**
 * The shape `narrowOptions` and `narrowCount` read off a dropdown option.
 *
 * @typedef {{ value: string | number | undefined, label: string }} NarrowOption
 */

/**
 * A static overlay row as filters.json ships it.
 *
 * @typedef {{ genre?: string[], quality?: number, focus?: string[], phase?: string, description?: string, length?: string, adaptive?: boolean }} OverlayRow
 */

/**
 * One `<FiltersItem/>` as the backend serves it: the engine's enumeration
 * fields (protocol.md:226) plus the backend-merged overlay row under `static`
 * (undefined on an overlay miss). The description is engine-format,
 * `"<q>/5 [focus, ...] <glyph> <ratio>"`, rated above the quality floor so
 * nothing but the case's own facet can trim it.
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
  description: "4/5 ⥮ Any",
  apodizing: false,
  static: staticRow,
});

/**
 * Reseed both source signals and clear every pick — module-level signals
 * outlive a test, so every case reassigns the pair in full. Each live entry's
 * overlay row (or undefined) rides the item's `static` key; `overlay` seeds
 * the static metadata for names the live enum does not carry. Returns the
 * dropdown options the /config form would serve for the live filters.
 *
 * @param {Record<string, OverlayRow | undefined>} rowsByName
 * @param {Record<string, OverlayRow>} [overlay]
 * @returns {NarrowOption[]}
 */
function seed(rowsByName, overlay = {}) {
  const names = Object.keys(rowsByName);
  enums.value = { filters: names.map((name, i) => item(name, i, rowsByName[name])) };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  return names.map((name, i) => ({ label: name, value: String(i) }));
}

/** @param {NarrowOption[]} options */
const labels = (options) => narrowOptions(options, STAGE, FIELD).map((o) => o.label);

// --- behavior 1: overlay `adaptive: true` facets adaptive, on both paths -----

test("test_an_overlay_row_stating_adaptive_on_a_live_enum_item_facets_adaptive", () => {
  seed({ "gauss-adapt": { adaptive: true } });
  assert.equal(filterFacets.value["gauss-adapt"].adaptive, true);
});

test("test_an_overlay_row_stating_adaptive_known_only_to_the_overlay_facets_adaptive", () => {
  seed({}, { "gauss-adapt": { adaptive: true } });
  assert.equal(filterFacets.value["gauss-adapt"].adaptive, true);
});

// --- behavior 2: an overlay silent on adaptive facets false ------------------

test("test_a_filter_with_no_overlay_row_facets_adaptive_false", () => {
  seed({ "gauss-plain": undefined });
  assert.equal(filterFacets.value["gauss-plain"].adaptive, false);
});

test("test_an_overlay_row_omitting_adaptive_facets_adaptive_false", () => {
  seed({ "gauss-plain": {} });
  assert.equal(filterFacets.value["gauss-plain"].adaptive, false);
});

// --- behavior 3: a filter may carry both facets ------------------------------

test("test_an_overlay_row_with_both_keys_facets_the_length", () => {
  seed({ "gauss-both": { length: "short", adaptive: true } });
  assert.equal(filterFacets.value["gauss-both"].length, "short");
});

test("test_an_overlay_row_with_both_keys_facets_adaptive", () => {
  seed({ "gauss-both": { length: "short", adaptive: true } });
  assert.equal(filterFacets.value["gauss-both"].adaptive, true);
});

// --- behavior 4: the adaptive pick narrows by the boolean --------------------
// `gauss-adapt-long` is the load-bearing member: it facets length "long", so
// keeping it under a lone "adaptive" pick proves the pick reads the boolean,
// not the length bucket. `gauss-short` and `gauss-plain` are non-adaptive and
// prove the pick drops something.

const MIX = {
  "gauss-adapt-long": { length: "long", adaptive: true },
  "gauss-adapt": { adaptive: true },
  "gauss-short": undefined,
  "gauss-plain": undefined,
};

test("test_the_adaptive_pick_keeps_adaptive_filters_whatever_their_length", () => {
  const options = seed(MIX);
  nLength.value = ["adaptive"];
  assert.deepEqual(labels(options), ["gauss-adapt-long", "gauss-adapt"]);
});

test("test_the_count_under_the_adaptive_pick_agrees_with_the_kept_options", () => {
  const options = seed(MIX);
  nLength.value = ["adaptive"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 2);
});

// --- behavior 5: the hover tip's Length row carries the facet tokens ---------
// A row is `[key, heading, labelText, valueTokens]`; the key and the value
// tokens are the machine identity, the label text between them is not.

/**
 * The value tokens of one filter's Length row — undefined when no such row
 * exists, which fails the assertion rather than passing as an empty list.
 *
 * @param {string} name
 * @returns {string[] | undefined}
 */
const lengthTokens = (name) => (filterTipFacets(name).rows.find((r) => r[0] === "length") || [])[3];

test("test_an_adaptive_filters_tip_length_row_carries_the_adaptive_token", () => {
  seed({ "gauss-adapt": { adaptive: true } });
  assert.ok((lengthTokens("gauss-adapt") || []).includes("adaptive"));
});

test("test_a_both_facet_filters_tip_length_row_carries_both_tokens", () => {
  seed({ "gauss-both": { length: "short", adaptive: true } });
  const tokens = lengthTokens("gauss-both") || [];
  assert.deepEqual([tokens.includes("short"), tokens.includes("adaptive")], [true, true]);
});
