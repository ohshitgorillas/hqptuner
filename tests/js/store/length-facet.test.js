// Behavioral suite for the filter LENGTH facet (store/narrow/facets.js): which
// length bucket a filter name classifies into, and which names carry no length
// at all.
//
// Four buckets — "short", "medium", "long", "xlong" — plus "", meaning no
// length is known. The classifier takes a NAME and reads nothing else; HQPlayer's
// own descriptions are the rationale for which names carry which bucket, not a
// runtime input. Where the description states no length, the bucket is "" and
// not a plausible guess: a tap count ("4096 x conversion ratio", "131070 x
// conversion ratio", a stated number of taps) is a filter SPECIFICATION, never
// converted into a length bucket. That is what separates `sinc-M` (its
// description names an xl/xla ancestor, so "xlong") from `sinc-L` (a tap
// multiplier only, so "").
//
// Policy (docs/testing.md): public API only, one assertion per test, no
// snapshots. Live enum items are hand-built in the engine's own shape
// (`{index, name, value, arg, description, apodizing, static}`), the way the
// `<GetFilters/>` enumeration serves them (protocol.md) once the backend has
// merged the static overlay row; the engine is the sole authority for which
// names exist (architecture.md §2). Every name below is one the engine
// enumerates, with one deliberate exception: `gauss-plain` in the
// nothing-matched case is synthetic, standing for any name no length rule
// reaches.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/length-facet.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterFacets } from "../../../hqptuner/static/store/narrow/facets.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

/**
 * A static overlay row as filters.json ships it.
 *
 * @typedef {{ genre?: string[], quality?: number, focus?: string[], phase?: string, description?: string }} OverlayRow
 */

/**
 * One `<FiltersItem/>` as the backend serves it: the engine's enumeration
 * fields plus the backend-merged overlay row under `static` (undefined on an
 * overlay miss, which is what these length cases seed).
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
 * Reseed both source signals — module-level signals outlive a test, so every
 * case reassigns the pair in full.
 *
 * @param {string[]} names
 */
function seed(names) {
  enums.value = { filters: names.map((name, i) => item(name, i)) };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
}

/** @param {string} name */
const lengthOf = (name) => filterFacets.value[name].length;

// --- letter-coded names with an extra-long ancestor --------------------------
// `sinc-S` is "Variant of poly-sinc-ext2-xla"; the sinc-M family each name an
// xl or xla ancestor. The names themselves carry no length token.

for (const name of ["sinc-S", "sinc-M", "sinc-Mx", "sinc-MG", "sinc-MGa"]) {
  test(`test_${name.replace(/-/g, "_")}_classifies_as_xlong`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "xlong");
  });
}

// --- names documented by tap count only --------------------------------------
// The sinc-L family is documented by a tap multiplier, the closed-form pair by
// a tap count. Taps are a filter specification: never a bucket.

for (const name of ["sinc-L", "sinc-Ls", "sinc-Lm", "sinc-Ll", "sinc-Lh"]) {
  test(`test_${name.replace(/-/g, "_")}_has_no_length`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "");
  });
}

for (const name of ["closed-form-M", "closed-form-16M"]) {
  test(`test_${name.replace(/-/g, "_")}_has_no_length`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "");
  });
}

// --- names with no documented length at all ----------------------------------
// The polynomial pair states none; the minringFIR pair compares ringing to
// other filters and states none.

for (const name of ["polynomial-1", "polynomial-2", "minringFIR-lp", "minringFIR-mp"]) {
  test(`test_${name.replace(/-/g, "_")}_has_no_length`, () => {
    seed([name]);
    assert.equal(lengthOf(name), "");
  });
}

// --- halfband names documented with a length word ----------------------------

test("test_poly_sinc_gauss_halfband_s_classifies_as_short", () => {
  seed(["poly-sinc-gauss-halfband-s"]);
  assert.equal(lengthOf("poly-sinc-gauss-halfband-s"), "short");
});

test("test_poly_sinc_hb_m_classifies_as_medium", () => {
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
  test(`test_${name.replace(/-/g, "_")}_classifies_as_xlong`, () => {
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
// The subject's bucket is reachable only after the strip: `-l-2s` ends in the
// two-stage suffix, so an implementation that never strips sees no halfband
// length suffix at all.

test("test_a_trailing_2s_suffix_is_stripped_before_classifying", () => {
  seed(["poly-sinc-hb-l-2s"]);
  assert.equal(lengthOf("poly-sinc-hb-l-2s"), "long");
});

// --- nothing matched ---------------------------------------------------------

test("test_a_name_matching_no_length_rule_has_no_length", () => {
  seed(["gauss-plain"]);
  assert.equal(lengthOf("gauss-plain"), "");
});
