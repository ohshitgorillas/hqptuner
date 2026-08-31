// Behavioral suite for `filterFor` (store/easy.js): the engine filter NAME an
// Easy Mode tile displays for a preset, an output mode, a set of knob positions
// and a side of the chain.
//
// The module is pure — no signals, no DOM, no network — so every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// WHAT IS ASSERTED (rule 5, rule 9). Which FIELD of the preset's write set the
// tile names, never the filter name itself: which filter a preset carries is
// owner-curated data, so every expectation is read back from `writeSet` on the
// same preset, mode and knobs, and no name literal stands in an assertion. The
// plain-names overlay's family, class and shape wording is owner copy and is
// asserted nowhere in this suite; that wording is not what `filterFor` answers
// with.
//
// The `nx` argument is the side of the chain the answer is wanted for: false
// names the 1x field's filter, true the Nx field's. A preset whose two fields
// hold one filter answers the same either way, and the `purist` pair below is
// what pins that — without it, a `filterFor` that ignored `nx` entirely would
// still pass the `perfect-ten` pair, and one that always read the Nx field
// would pass nothing else.
//
// `auto` is read here too: it is the mode in which BOTH chains are written, and
// what the tile names there is the PCM chain's filter.
//
// The module is imported under a BUILT specifier so a checkout that predates
// the change fails per-case rather than at module link — the convention
// tests/js/store/plainnames-truename.test.js settled.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-filtername.test.js

import test from "node:test";
import assert from "node:assert/strict";

const MOD = new URL("../../../hqptuner/static/store/easy.js", import.meta.url).href;
const easy = await import(`${MOD}`);

// The two ends of the chain, named rather than spelt `false` / `true` at every
// call site.
const ONE_X = false;
const NX = true;

// A preset id no curated table carries. Deliberately not a near-miss of a real
// one: what is under test is the answer for an id the table does not know, not
// how a typo resolves.
const UNKNOWN = "no-such-preset-in-the-table";

// ============================================================================
// a preset whose two fields hold DIFFERENT filters
// ============================================================================
//
// `perfect-ten` on lossless material splits the chain: one filter at the 1x
// end and another at the Nx end (the pair
// tests/js/components/easytiles-knobs.test.js seeds). Each side is read on its
// own against its own field of the write set, so a call that answered with the
// wrong field fails.

test("test_the_perfect_ten_tile_names_the_pcm_1x_field_on_the_1x_side", () => {
  const knobs = { emphasis: "space", material: "lossless" };
  assert.equal(
    easy.filterFor("perfect-ten", "pcm", knobs, ONE_X),
    easy.writeSet("perfect-ten", "pcm", knobs).pcm_filter_1x,
  );
});

test("test_the_perfect_ten_tile_names_the_pcm_nx_field_on_the_nx_side", () => {
  const knobs = { emphasis: "space", material: "lossless" };
  assert.equal(
    easy.filterFor("perfect-ten", "pcm", knobs, NX),
    easy.writeSet("perfect-ten", "pcm", knobs).pcm_filter_nx,
  );
});

// Lossy material changes what the 1x field carries, so the 1x side follows the
// knob: the one case where moving a knob changes what the 1x side answers.

test("test_the_perfect_ten_tile_on_lossy_material_names_the_pcm_1x_field_on_the_1x_side", () => {
  const knobs = { emphasis: "space", material: "lossy" };
  assert.equal(
    easy.filterFor("perfect-ten", "pcm", knobs, ONE_X),
    easy.writeSet("perfect-ten", "pcm", knobs).pcm_filter_1x,
  );
});

// The Nx side is read in SDM mode too, not only in PCM: the `nx` argument and
// the output mode are separate selectors, and a `filterFor` that only ever
// consulted `nx` on the PCM chain would pass every other case in this file.

test("test_the_perfect_ten_tile_in_sdm_mode_names_the_sdm_nx_field_on_the_nx_side", () => {
  const knobs = { emphasis: "space", material: "lossless" };
  assert.equal(
    easy.filterFor("perfect-ten", "sdm", knobs, NX),
    easy.writeSet("perfect-ten", "sdm", knobs).sdm_filter_nx,
  );
});

// ============================================================================
// the output mode selects which chain is named
// ============================================================================
//
// `old-school` is the preset with a two-stage variant, enumerated on the SDM
// chain only (tests/js/store/easy.test.js), so its SDM and PCM fields differ.
// SDM mode names the SDM chain's field, and `auto`, which writes both chains,
// names the PCM chain's.

test("test_the_old_school_tile_in_sdm_mode_names_the_sdm_chains_field", () => {
  const knobs = { emphasis: "space" };
  assert.equal(
    easy.filterFor("old-school", "sdm", knobs, ONE_X),
    easy.writeSet("old-school", "sdm", knobs).sdm_filter_1x,
  );
});

test("test_the_old_school_tile_in_auto_mode_names_the_pcm_chains_field", () => {
  const knobs = { emphasis: "space" };
  assert.equal(
    easy.filterFor("old-school", "auto", knobs, ONE_X),
    easy.writeSet("old-school", "auto", knobs).pcm_filter_1x,
  );
});

// ============================================================================
// a preset whose two fields hold ONE filter
// ============================================================================
//
// `purist` writes a single name to both ends of the PCM chain, so both sides
// answer with it. Two cases rather than one comparison of the two calls: each
// side is a condition of its own, and each is read against its own field.

test("test_the_purist_tile_names_the_pcm_1x_field_on_the_1x_side", () => {
  const knobs = { emphasis: "space" };
  assert.equal(easy.filterFor("purist", "pcm", knobs, ONE_X), easy.writeSet("purist", "pcm", knobs).pcm_filter_1x);
});

test("test_the_purist_tile_names_the_pcm_nx_field_on_the_nx_side", () => {
  const knobs = { emphasis: "space" };
  assert.equal(easy.filterFor("purist", "pcm", knobs, NX), easy.writeSet("purist", "pcm", knobs).pcm_filter_nx);
});

// ============================================================================
// nothing to name
// ============================================================================
//
// An id the table does not carry names nothing, and the answer is the empty
// string rather than a null, an undefined or a throw — a tile hands it straight
// to a renderer.

test("test_a_preset_the_table_does_not_carry_names_nothing", () => {
  assert.equal(easy.filterFor(UNKNOWN, "pcm", { emphasis: "space" }, ONE_X), "");
});
