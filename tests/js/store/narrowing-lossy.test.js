// Behavioral suite for the 1x LOSSY-SOURCE control (store/narrowing.js for the
// signal, store/narrowmatch.js for the matching).
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
// Every fixture filter is apodizing (`arg` bit 0) and rated 4/5 with ratio
// "Any", so no facet other than the one under test can move a list: whatever
// the apodizing, quality and rate controls are set to, the whole fixture
// survives them.
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
  LOSSY_1X_DEFAULT,
  APOD_1X_DEFAULT,
  nApod1x,
  narrowingActive,
  resetNarrowing,
} from "../../../hqptuner/static/store/narrowing.js";
import { narrowOptions } from "../../../hqptuner/static/store/narrowmatch.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

/**
 * A fixture row: filter name and its facet description.
 *
 * @typedef {[string, string]} FilterTuple
 */

/**
 * The two members `narrowOptions` reads off a dropdown option.
 *
 * @typedef {{ value: string | number | undefined, label: string }} NarrowOption
 */

// The names are the engine's own, `poly-sinc-mqa/mp3-*` literal slash included.
// Three carry a lossy-source marker in the name and three carry none.
/** @type {FilterTuple[]} */
const FILTERS = [
  ["poly-sinc-gauss-lp", "4/5 ⥮ Any"],
  ["poly-sinc-ext2-hires-lp", "4/5 ⥮ Any"],
  ["sinc-M", "4/5 ⥮ Any"],
  ["poly-sinc-gauss-hires-mp", "4/5 ⥮ Any"],
  ["poly-sinc-mqa/mp3-lp", "4/5 ⥮ Any"],
  ["poly-sinc-ext2-mp", "4/5 ⥮ Any"],
];

/** The three fixture names carrying no `hires`, `mqa` or `mp3`. */
const LOSSLESS = ["poly-sinc-gauss-lp", "sinc-M", "poly-sinc-ext2-mp"];

/** The three fixture names carrying one. */
const LOSSY = ["poly-sinc-ext2-hires-lp", "poly-sinc-gauss-hires-mp", "poly-sinc-mqa/mp3-lp"];

/** Every fixture name, in enumeration order. */
const ALL = FILTERS.map(([name]) => name);

/** @returns {NarrowOption[]} */
function reset() {
  enums.value = {
    filters: FILTERS.map(([name, description], index) => ({
      index: String(index),
      name,
      value: String(index),
      arg: 1,
      description,
      apodizing: true,
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

test("test_the_lossy_control_defaults_to_both", () => {
  assert.equal(LOSSY_1X_DEFAULT, "both");
});

test("test_a_fresh_bar_holds_the_lossy_control_at_both", () => {
  reset();
  assert.equal(nLossy1x.value, "both");
});

// The apodizing control is the other 1x control this change moves: it no longer
// starts narrowed either, so a fresh bar offers the whole 1x list.
test("test_the_1x_apodizing_control_defaults_to_all", () => {
  assert.equal(APOD_1X_DEFAULT, "all");
});

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

// Each marker on its own, so a control reading only one of the three words
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
