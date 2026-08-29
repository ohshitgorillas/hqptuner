// Behavioral suite for `filterFor` (store/easy.js): the engine filter NAME an
// Easy Mode tile displays for a preset, an output mode, a set of knob positions
// and a side of the chain.
//
// The module is pure — no signals, no DOM, no network — so every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// WHAT IS ASSERTED (rule 5, rule 9). Filter NAMES, never enum ids and never a
// word a reader sees. A filter name is a wire identifier — the running engine
// is the sole authority for ids and ordering and static data joins by name
// (docs/architecture.md §2) — so it is contract and is stated outright. The
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
// `perfect-ten` on lossless material splits the chain: the standard filter at
// the 1x end and the hi-res one at the Nx end (the pair
// tests/js/components/easytiles-knobs.test.js seeds). Each side is read on its
// own, so a call that answered with the wrong field fails by naming the filter
// it gave.

test("test_the_perfect_ten_tile_names_the_standard_filter_on_the_1x_side", () => {
  assert.equal(
    easy.filterFor("perfect-ten", "pcm", { emphasis: "space", material: "lossless" }, ONE_X),
    "poly-sinc-gauss-long",
  );
});

test("test_the_perfect_ten_tile_names_the_hi_res_filter_on_the_nx_side", () => {
  assert.equal(
    easy.filterFor("perfect-ten", "pcm", { emphasis: "space", material: "lossless" }, NX),
    "poly-sinc-gauss-hires-lp",
  );
});

// Lossy material puts the hi-res filter on BOTH fields, so the 1x side names it
// too — the one case where moving a knob changes what the 1x side answers
// without changing the Nx side at all.

test("test_the_perfect_ten_tile_on_lossy_material_names_the_hi_res_filter_on_the_1x_side", () => {
  assert.equal(
    easy.filterFor("perfect-ten", "pcm", { emphasis: "space", material: "lossy" }, ONE_X),
    "poly-sinc-gauss-hires-lp",
  );
});

// The Nx side is read in SDM mode too, not only in PCM: the `nx` argument and
// the output mode are separate selectors, and a `filterFor` that only ever
// consulted `nx` on the PCM chain would pass every other case in this file.
// `perfect-ten` declares no two-stage variant, so its SDM values carry the same
// plain names its PCM values do (tests/js/store/easy.test.js's control) — which
// is what makes it readable here without a `-2s` name standing in the answer.

test("test_the_perfect_ten_tile_in_sdm_mode_names_the_hi_res_filter_on_the_nx_side", () => {
  assert.equal(
    easy.filterFor("perfect-ten", "sdm", { emphasis: "space", material: "lossless" }, NX),
    "poly-sinc-gauss-hires-lp",
  );
});

// ============================================================================
// the output mode selects which chain is named
// ============================================================================
//
// `old-school` is the preset with a two-stage variant: the `-2s` flavor is
// enumerated on the SDM chain only and the PCM chain carries none
// (tests/js/store/easy.test.js). So the SDM mode names the `-2s` filter, and
// `auto` — which writes both chains — names the PCM chain's plain one.

test("test_the_old_school_tile_in_sdm_mode_names_the_two_stage_filter", () => {
  assert.equal(easy.filterFor("old-school", "sdm", { emphasis: "space" }, ONE_X), "poly-sinc-short-lp-2s");
});

test("test_the_old_school_tile_in_auto_mode_names_the_pcm_chains_filter", () => {
  assert.equal(easy.filterFor("old-school", "auto", { emphasis: "space" }, ONE_X), "poly-sinc-short-lp");
});

// ============================================================================
// a preset whose two fields hold ONE filter
// ============================================================================
//
// `purist` writes a single name to both ends of the PCM chain, so both sides
// answer with it. Two cases rather than one comparison of the two calls: each
// side is a condition of its own, and the name is pinned on each.

test("test_the_purist_tile_names_its_single_filter_on_the_1x_side", () => {
  assert.equal(easy.filterFor("purist", "pcm", { emphasis: "space" }, ONE_X), "poly-sinc-gauss-halfband");
});

test("test_the_purist_tile_names_its_single_filter_on_the_nx_side", () => {
  assert.equal(easy.filterFor("purist", "pcm", { emphasis: "space" }, NX), "poly-sinc-gauss-halfband");
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
