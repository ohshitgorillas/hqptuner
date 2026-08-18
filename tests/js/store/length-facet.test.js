// Behavioral suite for the filter LENGTH facet (store/narrow/facets.js): which
// length bucket a filter name classifies into, and which names carry no length
// at all.
//
// Four buckets — "short", "medium", "long", "xlong" — plus "", meaning no
// length is known. A filter's length is whatever HQPlayer's own description of
// that filter states. Where the description states no length, the answer is ""
// and not a plausible guess: a tap count ("4096 x conversion ratio",
// "131070 x conversion ratio", a stated number of taps) is a filter
// SPECIFICATION, never converted into a length bucket. That is what separates
// `sinc-M` (description names an xl/xla ancestor, so "xlong") from `sinc-L`
// (description states a tap multiplier only, so "").
//
// Policy (docs/testing.md): public API only, one assertion per test, no
// snapshots. Live enum items are hand-built in the engine's own shape
// (`{index, name, value, arg, description, apodizing}`), the way the
// `<GetFilters/>` enumeration serves them (protocol.md); the engine is the sole
// authority for which names exist (architecture.md §2). The classifier takes a
// name and returns a bucket, so these cases seed the name and nothing else.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/length-facet.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterFacets } from "../../../hqptuner/static/store/narrow/facets.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

/**
 * One `<FiltersItem/>` as the backend serves it: the engine's enumeration
 * fields, with no static overlay row merged in.
 *
 * @param {string} name
 * @param {number} index
 */
const item = (name, index) => ({
  index: String(index),
  name,
  value: String(index),
  arg: 0,
  description: "3/5 ⥮ Any",
  apodizing: false,
});

/**
 * Reseed both source signals — module-level signals outlive a test, so every
 * case reassigns the pair in full.
 *
 * @param {string[]} names
 */
function seed(names) {
  enums.value = { filters: names.map(item) };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
}

/** @param {string} name */
const lengthOf = (name) => filterFacets.value[name].length;

/** The buckets a user can actually pick in the Length facet. */
const BUCKETS = ["short", "medium", "long", "xlong"];

// --- letter-coded names whose description names an extra-long ancestor --------
// `sinc-S` is "Variant of poly-sinc-ext2-xla"; the sinc-M family each name an
// xl or xla ancestor. The name itself carries no length token, so the ancestor
// in the description is the whole of what is known.

for (const name of ["sinc-S", "sinc-M", "sinc-Mx", "sinc-MG", "sinc-MGa"]) {
  test(`test_${name.replace(/-/g, "_")}_is_xlong_from_its_extra_long_ancestor`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "xlong");
  });
}

// --- names whose description states a tap count and no length ----------------
// The sinc-L family states a tap multiplier, the closed-form pair a tap count.
// Taps are a filter specification: they are never converted into a bucket.

for (const name of ["sinc-L", "sinc-Ls", "sinc-Lm", "sinc-Ll", "sinc-Lh"]) {
  test(`test_${name.replace(/-/g, "_")}_has_no_length_because_its_description_states_only_taps`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "");
  });
}

for (const name of ["closed-form-M", "closed-form-16M"]) {
  test(`test_${name.replace(/-/g, "_")}_has_no_length_because_its_description_states_only_a_tap_count`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "");
  });
}

// --- names whose description states no length at all -------------------------
// The polynomial pair states none; the minringFIR pair compares ringing to
// other filters and states none.

for (const name of ["polynomial-1", "polynomial-2", "minringFIR-lp", "minringFIR-mp"]) {
  test(`test_${name.replace(/-/g, "_")}_has_no_length_because_its_description_states_none`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "");
  });
}

// --- descriptions that open with a length word -------------------------------

test("test_poly_sinc_gauss_halfband_s_is_short_from_its_short_description", () => {
  seed(["poly-sinc-gauss-halfband-s"]);
  assert.equal(lengthOf("poly-sinc-gauss-halfband-s"), "short");
});

test("test_poly_sinc_hb_m_is_medium_from_its_medium_description", () => {
  seed(["poly-sinc-hb-m"]);
  assert.equal(lengthOf("poly-sinc-hb-m"), "medium");
});

// --- a length word in the name classifies by that word -----------------------

for (const [name, expected] of [
  ["poly-sinc-short", "short"],
  ["poly-sinc-medium", "medium"],
  ["poly-sinc-long", "long"],
]) {
  test(`test_a_name_carrying_${expected}_classifies_as_${expected}`, () => {
    seed([name]);
    assert.equal(lengthOf(name), expected);
  });
}

// --- xl / xla suffixes -------------------------------------------------------

for (const name of ["poly-sinc-gauss-xl", "poly-sinc-gauss-xla"]) {
  test(`test_${name.replace(/-/g, "_")}_is_xlong_from_its_suffix`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "xlong");
  });
}

// --- halfband suffixes classify by their documented length words -------------

for (const [name, expected] of [
  ["poly-sinc-hb-xs", "short"],
  ["poly-sinc-hb-s", "short"],
  ["poly-sinc-hb-l", "long"],
]) {
  test(`test_the_halfband_suffix_of_${name.replace(/-/g, "_")}_gives_${expected}`, () => {
    seed([name]);
    assert.equal(lengthOf(name), expected);
  });
}

// --- the two-stage suffix is stripped before classifying ---------------------

test("test_a_trailing_2s_suffix_is_stripped_before_classifying", () => {
  seed(["poly-sinc-short-2s"]);
  assert.equal(lengthOf("poly-sinc-short-2s"), "short");
});

// --- nothing matched ---------------------------------------------------------

test("test_a_name_matching_no_length_rule_has_no_length", () => {
  seed(["gauss-plain"]);
  assert.equal(lengthOf("gauss-plain"), "");
});

// --- a length-less filter is not reachable by any Length pick ----------------
// Every name the taxonomy does not reach must carry none of the four pickable
// buckets, so no Length selection can surface it. Reported as an offender list
// so one failure names every leak at once — still one condition.

test("test_no_length_less_filter_carries_a_pickable_length_bucket", () => {
  const names = [
    "sinc-L",
    "sinc-Ls",
    "sinc-Lm",
    "sinc-Ll",
    "sinc-Lh",
    "closed-form-M",
    "closed-form-16M",
    "polynomial-1",
    "polynomial-2",
    "minringFIR-lp",
    "minringFIR-mp",
    "gauss-plain",
  ];
  seed(names);
  assert.deepEqual(
    names.filter((n) => BUCKETS.includes(lengthOf(n))),
    [],
  );
});
