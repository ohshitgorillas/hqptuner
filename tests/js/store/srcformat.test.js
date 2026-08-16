// Behavioral suite for the narrow bar's SOURCE FORMAT facet
// (store/narrowing.js): the two-state control that says whether the user's
// library carries DSD files at all. It defaults to "pcm", it reads as active
// narrowing at "both", and it narrows no dropdown — it drives the disclosure of
// the chain cards' "DSD Sources" subsections instead
// (tests/js/components/conversioncards-dsd.test.js).
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Facet data is driven by assigning the two source signals
// the real payloads carry — `enums.filters` is the running engine's
// `<GetFilters/>` enumeration (`{index, name, value, arg, description}`,
// protocol.md:226) and `metadata.filters.filters` is the static name-keyed
// overlay served by /api/metadata. Descriptions are hand-written in the engine's
// own format, `"<q>/5 [focus, ...] <glyph> <ratio>"`, with the PCM glyph `⥮` and
// the engine's abbreviated ratio tail.
//
// The persistence half of this facet — its `src_format` wire key, and the round
// trip through GET/PUT /api/narrowing — is pinned by
// tests/js/store/narrowing-persist.test.js, which drives every facet of the
// contract table through the shared fetch fake.
//
// `reset()` reassigns BOTH source signals and calls resetNarrowing() on every
// case: module-level signals outlive a test, and a partial reset makes cases
// pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/srcformat.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nSrcFormat, narrowingActive, resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { narrowOptions } from "../../../hqptuner/static/store/narrowmatch.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

/**
 * A fixture row: filter name, its facet description, and its flags bitfield
 * (bit 0 = apodizing, protocol.md:226).
 *
 * @typedef {[string, string, number]} FilterTuple
 */

/**
 * The two members `narrowOptions` reads off a dropdown option.
 *
 * @typedef {{ value: string | number | undefined, label: string }} NarrowOption
 */

// Rated 4/5 with ratio "Any" so the bar's other facets leave the list whole at
// their defaults. One member is non-apodizing and one is named `hires`, so a
// facet that reached for either of the two axes the 1x stage does narrow on
// would change the list here rather than passing quietly.
/** @type {FilterTuple[]} */
const FILTERS = [
  ["poly-sinc-gauss-lp", "4/5 ⥮ Any", 1],
  ["poly-sinc-ext2-hires-lp", "4/5 ⥮ Any", 1],
  ["sinc-M", "4/5 ⥮ Any", 1],
  ["gauss-short", "4/5 ⥮ Any", 0],
];

/** Every fixture name, in enumeration order — the whole list, narrowed by nothing. */
const ALL = FILTERS.map(([name]) => name);

/** The four filter dropdowns a chain card offers, against the stage each sits at. */
/** @type {[string, string][]} */
const FIELDS = [
  ["pcm_filter_1x", "1x"],
  ["pcm_filter_nx", "nx"],
  ["sdm_filter_1x", "1x"],
  ["sdm_filter_nx", "nx"],
];

/** @returns {NarrowOption[]} */
function reset() {
  enums.value = {
    filters: FILTERS.map(([name, description, arg], index) => ({
      index: String(index),
      name,
      value: String(index),
      arg,
      description,
      apodizing: Boolean(arg & 1),
    })),
  };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  return FILTERS.map(([name], index) => ({ label: name, value: String(index) }));
}

/**
 * One dropdown's list, as labels in enumeration order.
 *
 * @param {NarrowOption[]} options
 * @param {string} stage
 * @param {string} field
 * @returns {string[]}
 */
const listed = (options, stage, field) => narrowOptions(options, stage, field).map((o) => o.label);

// --- the control's default ------------------------------------------------------

test("test_a_fresh_bar_holds_the_source_format_control_at_pcm", () => {
  reset();
  assert.equal(nSrcFormat.value, "pcm");
});

// --- narrowing reads as active only away from pcm --------------------------------

test("test_a_fresh_bar_with_every_facet_at_its_default_is_not_active_narrowing", () => {
  reset();
  assert.equal(narrowingActive.value, false);
});

test("test_the_source_format_control_at_both_is_active_narrowing", () => {
  reset();
  nSrcFormat.value = "both";
  assert.equal(narrowingActive.value, true);
});

test("test_the_source_format_control_back_at_pcm_is_not_active_narrowing", () => {
  reset();
  nSrcFormat.value = "both";
  nSrcFormat.value = "pcm";
  assert.equal(narrowingActive.value, false);
});

// --- reset ------------------------------------------------------------------------------

test("test_reset_returns_the_source_format_control_to_pcm", () => {
  reset();
  nSrcFormat.value = "both";
  resetNarrowing();
  assert.equal(nSrcFormat.value, "pcm");
});

// --- no dropdown is narrowed on this axis --------------------------------------------
//
// The facet says which chain settings are worth showing, never which filters are
// worth offering: every one of the four filter dropdowns offers the same list at
// "both" as it does at "pcm".
//
// Both readings are asserted together, so the case cannot pass on two empty
// lists: at either value of the facet the dropdown offers the whole fixture.

for (const [field, stage] of FIELDS) {
  test(`test_the_${field}_list_is_the_same_at_both_as_at_pcm`, () => {
    const options = reset();
    const atPcm = listed(options, stage, field);
    nSrcFormat.value = "both";
    assert.deepEqual({ pcm: atPcm, both: listed(options, stage, field) }, { pcm: ALL, both: ALL });
  });
}
