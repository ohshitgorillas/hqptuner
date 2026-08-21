// Behavioral suite for the 1x LOSSY-SOURCE control (store/narrow/state.js for the
// signal, store/narrow/match.js for the matching).
//
// The 1x stage no longer carries a show/hide switch over hi-res-named filters.
// It carries a three-state control over SOURCE CLASS instead: "lossless",
// "lossy" and "both", defaulting to "both". The filters it groups are the ones
// HQPlayer documents for lossy and lossy-adjacent material — the two `hires`
// families and `poly-sinc-mqa/mp3`, the latter documented as cleaning up
// encoding noise (docs/vendor/manual/04-06-filter-oversampling-selection.txt).
// Membership is read off the NAME: `hires`, `mqa` or `mp3` in it.
//
// The manual gives that whole family Ratio "Any" and Genre "Any", so there is
// no rate restriction behind this control and the Nx stage is never narrowed on
// this axis at all — the three states differ only in what the 1x list offers.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Facet data is driven by assigning the two source signals the real
// payloads carry — `enums.filters` is the running engine's `<GetFilters/>`
// enumeration (`{index, name, value, arg, description}`, protocol.md:226) and
// `metadata.filters.filters` is the static name-keyed overlay served by
// /api/metadata. Descriptions are hand-written in the engine's own format,
// `"<q>/5 [focus, ...] <glyph> <ratio>"`, with the PCM glyph `⥮` and the
// engine's abbreviated ratio tail. No count comes from a shipped data file.
//
// Every fixture filter is rated 4/5 with ratio "Any", and all but one are
// apodizing (`arg` bit 0), so at the bar's defaults no facet other than the one
// under test moves a list. The single non-apodizing member exists so a case can
// engage a SECOND facet alongside this one: a control that replaced the 1x list
// with its lossy/lossless partition, instead of intersecting that partition
// with what the other facets left, keeps that filter and fails those cases.
//
// `reset()` reassigns BOTH source signals and calls resetNarrowing() on every
// case: module-level signals outlive a test, and a partial reset makes cases
// pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing-lossy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  nLossy1x,
  nApod1x,
  nQuality,
  narrowingActive,
  resetNarrowing,
} from "../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions } from "../../../hqptuner/static/store/narrow/match.js";
import { resetFilterFacets } from "../support/filterfacets.js";

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

// The names are the engine's own where the engine has one, `poly-sinc-mqa/mp3-*`
// literal slash included. Each of the three markers also appears ALONE on a
// name of its own, so a control reading only one or two of the three words
// fails rather than riding along on a name carrying several. `gauss-short` is
// the one non-apodizing member, and carries no marker.
/** @type {FilterTuple[]} */
const FILTERS = [
  ["poly-sinc-gauss-lp", "4/5 ⥮ Any", 1],
  ["poly-sinc-ext2-hires-lp", "4/5 ⥮ Any", 1],
  ["sinc-M", "4/5 ⥮ Any", 1],
  ["poly-sinc-gauss-hires-mp", "4/5 ⥮ Any", 1],
  ["poly-sinc-mqa/mp3-lp", "4/5 ⥮ Any", 1],
  ["poly-sinc-ext2-mp", "4/5 ⥮ Any", 1],
  ["poly-sinc-mqa-lp", "4/5 ⥮ Any", 1],
  ["poly-sinc-mp3-mp", "4/5 ⥮ Any", 1],
  ["gauss-short", "4/5 ⥮ Any", 0],
];

/** The fixture names carrying no `hires`, `mqa` or `mp3`. */
const LOSSLESS = ["poly-sinc-gauss-lp", "sinc-M", "poly-sinc-ext2-mp", "gauss-short"];

/** The fixture names carrying at least one. */
const LOSSY = [
  "poly-sinc-ext2-hires-lp",
  "poly-sinc-gauss-hires-mp",
  "poly-sinc-mqa/mp3-lp",
  "poly-sinc-mqa-lp",
  "poly-sinc-mp3-mp",
];

/** The one lossless-named fixture the apodizing-only switch drops. */
const NON_APODIZING = "gauss-short";

/** Every fixture name, in enumeration order. */
const ALL = FILTERS.map(([name]) => name);

/** @returns {NarrowOption[]} */
const reset = () => resetFilterFacets(FILTERS);

/**
 * The 1x list, as labels in enumeration order.
 *
 * @param {NarrowOption[]} options
 */
const at1x = (options) => narrowOptions(options, "1x", "pcm_filter_1x").map((o) => o.label);

/**
 * The Nx list, as labels in enumeration order.
 *
 * @param {NarrowOption[]} options
 */
const atNx = (options) => narrowOptions(options, "nx", "pcm_filter_nx").map((o) => o.label);

// --- the control's default ------------------------------------------------------

test("test_a_fresh_bar_holds_the_lossy_control_at_both", () => {
  reset();
  assert.equal(nLossy1x.value, "both");
});

// The apodizing control is the other 1x control this change moves: it no longer
// starts narrowed either, so a fresh bar offers the whole 1x list.
test("test_a_fresh_bar_holds_the_1x_apodizing_control_at_all", () => {
  reset();
  assert.equal(nApod1x.value, "all");
});

// --- what each state offers at 1x -------------------------------------------------

test("test_both_leaves_every_filter_in_the_1x_list", () => {
  const options = reset();
  nLossy1x.value = "both";
  assert.deepEqual(at1x(options), ALL);
});

test("test_a_fresh_bar_leaves_every_filter_in_the_1x_list", () => {
  const options = reset();
  assert.deepEqual(at1x(options), ALL);
});

test("test_lossless_drops_every_filter_named_hires_mqa_or_mp3_from_the_1x_list", () => {
  const options = reset();
  nLossy1x.value = "lossless";
  assert.deepEqual(at1x(options), LOSSLESS);
});

test("test_lossy_keeps_only_the_filters_named_hires_mqa_or_mp3_in_the_1x_list", () => {
  const options = reset();
  nLossy1x.value = "lossy";
  assert.deepEqual(at1x(options), LOSSY);
});

// One name at a time. `hires`, `mqa` and `mp3` each appear on a name of their
// own in the fixture, so a control reading only one or two of the three words
// fails here rather than passing on the list cases above.

for (const name of LOSSY) {
  test(`test_lossless_drops_${name}`, () => {
    const options = reset();
    nLossy1x.value = "lossless";
    assert.equal(at1x(options).includes(name), false);
  });

  test(`test_lossy_keeps_${name}`, () => {
    const options = reset();
    nLossy1x.value = "lossy";
    assert.equal(at1x(options).includes(name), true);
  });
}

// --- the control narrows ALONGSIDE the other facets, never instead of them ------------
//
// Each case here engages a second facet whose reach this control does not cover:
// apodizing-only drops `gauss-short` (flags bit 0 clear, no marker in its name),
// and a quality floor of 5 drops every fixture, all rated 4/5. A control that
// REPLACED the 1x list with its lossless partition, instead of intersecting that
// partition with what the other facets left, offers those filters anyway.

test("test_lossless_with_apodizing_only_still_drops_a_lossless_named_non_apodizing_filter", () => {
  const options = reset();
  nApod1x.value = "only";
  nLossy1x.value = "lossless";
  assert.equal(at1x(options).includes(NON_APODIZING), false);
});

test("test_lossless_with_apodizing_only_keeps_a_lossless_named_apodizing_filter", () => {
  const options = reset();
  nApod1x.value = "only";
  nLossy1x.value = "lossless";
  assert.equal(at1x(options).includes("sinc-M"), true);
});

test("test_lossless_with_a_quality_floor_of_5_still_drops_a_lossless_named_4_of_5_filter", () => {
  const options = reset();
  nQuality.value = 5;
  nLossy1x.value = "lossless";
  assert.equal(at1x(options).includes("sinc-M"), false);
});

// --- the Nx list is never narrowed on this axis --------------------------------------

for (const state of ["both", "lossless", "lossy"]) {
  test(`test_the_nx_list_is_whole_with_the_lossy_control_at_${state}`, () => {
    const options = reset();
    nLossy1x.value = state;
    assert.deepEqual(atNx(options), ALL);
  });
}

// --- narrowing reads as active only away from both -------------------------------------

test("test_the_lossy_control_at_both_is_not_active_narrowing", () => {
  reset();
  nLossy1x.value = "both";
  assert.equal(narrowingActive.value, false);
});

test("test_a_fresh_bar_is_not_active_narrowing", () => {
  reset();
  assert.equal(narrowingActive.value, false);
});

for (const state of ["lossless", "lossy"]) {
  test(`test_the_lossy_control_at_${state}_is_active_narrowing`, () => {
    reset();
    nLossy1x.value = state;
    assert.equal(narrowingActive.value, true);
  });
}

// --- reset ------------------------------------------------------------------------------

for (const state of ["lossless", "lossy"]) {
  test(`test_reset_returns_the_lossy_control_to_both_from_${state}`, () => {
    reset();
    nLossy1x.value = state;
    resetNarrowing();
    assert.equal(nLossy1x.value, "both");
  });
}

test("test_reset_returns_the_1x_apodizing_control_to_all", () => {
  reset();
  nApod1x.value = "only";
  resetNarrowing();
  assert.equal(nApod1x.value, "all");
});
