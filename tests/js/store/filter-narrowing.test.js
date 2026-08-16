// Behavioral suite for `filterNarrowingActive` (store/narrowing.js): the
// predicate that says whether any facet which actually NARROWS A DROPDOWN has
// moved off its default. It is `narrowingActive` minus the source-format term,
// because source format narrows no dropdown — it discloses the chain cards' "DSD
// Sources" subsections instead (tests/js/store/srcformat.test.js pins that it
// leaves every filter list whole).
//
// The two predicates are what the two narrow bars reset on: the Output tab's bar
// offers the source-format control and so follows `narrowingActive`, and the
// Live view's bar has no such control and so follows this one.
//
// `narrowingActive` keeping its meaning at "both", and resetNarrowing() still
// clearing source format, are pinned where they already were —
// tests/js/store/srcformat.test.js. Those cases are the regression guard on this
// split and are deliberately not restated here.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Facet data is driven by assigning the two source signals
// the real payloads carry — `enums.filters` is the running engine's
// `<GetFilters/>` enumeration (`{index, name, value, arg, description}`,
// protocol.md:226) and `metadata.filters.filters` is the static name-keyed
// overlay served by /api/metadata.
//
// `reset()` reassigns both source signals and calls resetNarrowing() on every
// case: module-level signals outlive a test, and a partial reset makes cases
// pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/filter-narrowing.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nSrcFormat, nPhase, filterNarrowingActive, resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

// Rated 4/5 with ratio "Any" and apodizing set, so no facet at its default
// trims the list and a predicate reading a shortened list rather than a moved
// facet would still see nothing move.
const FILTERS = [
  { index: "0", name: "poly-sinc-gauss-lp", value: "0", arg: 1, description: "4/5 ⥮ Any", apodizing: true },
  { index: "1", name: "sinc-M", value: "1", arg: 1, description: "4/5 ⥮ Any", apodizing: true },
];

function reset() {
  enums.value = { filters: FILTERS };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
}

// --- nothing moved --------------------------------------------------------------

test("test_a_fresh_bar_with_every_facet_at_its_default_is_not_active_filter_narrowing", () => {
  reset();
  assert.equal(filterNarrowingActive.value, false);
});

// --- source format is not a filter facet -------------------------------------------
//
// The term this predicate drops. Source format away from its default is active
// narrowing to `narrowingActive` and nothing at all to this one.

test("test_the_source_format_control_at_both_is_not_active_filter_narrowing", () => {
  reset();
  nSrcFormat.value = "both";
  assert.equal(filterNarrowingActive.value, false);
});

// --- a facet that does narrow a dropdown -------------------------------------------

test("test_a_moved_dropdown_facet_is_active_filter_narrowing", () => {
  reset();
  nPhase.value = "minimum";
  assert.equal(filterNarrowingActive.value, true);
});
