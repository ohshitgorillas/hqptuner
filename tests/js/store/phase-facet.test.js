// Behavioral suite for the filter phase facet (store/narrow/facets.js): where a
// filter's `phase` comes from and which source wins.
//
// Two sources, one precedence rule. A `-lp`/`-mp`/`-ip` token in the filter's
// NAME (including mid-name, before further suffixes like `-2s`) is authoritative
// and always wins. A token-less filter falls back to the `phase` field of its
// backend-merged static overlay row — the `static` property on the live enum
// item, or the overlay entry itself for a static-only (inactive-mode) filter.
// No token and no static `phase` means `""`. The backend join strips a `-2s`
// suffix (hqptuner/metadata.py join rules), so a token-less `-2s` live item's
// `static` row is its base filter's entry and supplies the base's phase.
//
// The regression this suite exists for: `minringFIR-lp` carries the `-lp`
// token and is linear phase, but the old classifier's minimum-phase
// alternation matched `min` inside `minringFIR` before the `-lp` check ran,
// misreading it as minimum.
//
// Policy (docs/testing.md): public API only, one assertion per test, no
// snapshots. Live enum items are hand-built in the engine's own shape
// (`{index, name, value, arg, description, apodizing, static}`); the `static`
// member is the backend-merged overlay row, seeded directly the way the
// backend would have joined it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/phase-facet.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterFacets } from "../../../hqptuner/static/store/narrow/facets.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

/**
 * A static overlay row as filters.json ships it, with the optional `phase`
 * field this suite is about.
 *
 * @typedef {{ genre?: string[], quality?: number, focus?: string[], phase?: string, description?: string }} OverlayRow
 */

/**
 * One `<FiltersItem/>` as the backend serves it: the engine's enumeration
 * fields (protocol.md) plus the backend-merged overlay row under `static`
 * (undefined on an overlay miss).
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
 * @param {ReturnType<typeof item>[]} items
 * @param {Record<string, OverlayRow>} [overlay]
 */
function seed(items, overlay = {}) {
  enums.value = { filters: items };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
}

/** @param {string} name */
const phaseOf = (name) => filterFacets.value[name].phase;

// --- the name token is authoritative ----------------------------------------

for (const [name, expected] of [
  ["poly-sinc-short-ip", "intermediate"],
  ["poly-sinc-short-mp", "minimum"],
  ["poly-sinc-short-lp", "linear"],
  ["poly-sinc-long-lp-2s", "linear"],
  ["poly-sinc-long-mp-2s", "minimum"],
]) {
  test(`test_the_${name}_name_token_gives_phase_${expected}`, () => {
    seed([item(name, 0)]);
    assert.equal(phaseOf(name), expected);
  });
}

// The regression: the old classifier's /min/i alternation matched `minring`
// before the `-lp` token was consulted — the token must win.

test("test_minringFIR_lp_is_linear_phase", () => {
  seed([item("minringFIR-lp", 0)]);
  assert.equal(phaseOf("minringFIR-lp"), "linear");
});

test("test_minringFIR_mp_is_minimum_phase", () => {
  seed([item("minringFIR-mp", 0)]);
  assert.equal(phaseOf("minringFIR-mp"), "minimum");
});

// --- token-less live filters fall back to the merged static row --------------
// The first two rows mirror phases the shipped overlay carries. The IIR and
// asymFIR rows are synthetic fixtures — the shipped overlay leaves both
// unclassified — pinning that a static "minimum" or "intermediate" value is
// honored wherever a row carries one.

for (const [name, expected] of [
  ["poly-sinc-ext2", "linear"],
  ["IIR", "minimum"],
  ["minphaseFIR", "minimum"],
  ["asymFIR", "intermediate"],
]) {
  test(`test_tokenless_${name}_takes_phase_${expected}_from_its_static_row`, () => {
    seed([item(name, 0, { phase: expected })]);
    assert.equal(phaseOf(name), expected);
  });
}

// --- token beats static -------------------------------------------------------

test("test_a_name_token_beats_a_contradicting_static_phase", () => {
  seed([item("poly-sinc-long-lp", 0, { phase: "minimum" })]);
  assert.equal(phaseOf("poly-sinc-long-lp"), "linear");
});

// --- no token, no static phase → "" ------------------------------------------

test("test_a_tokenless_filter_whose_static_row_lacks_phase_has_empty_phase", () => {
  seed([item("polynomial-1", 0, { genre: [], quality: 1 })]);
  assert.equal(phaseOf("polynomial-1"), "");
});

test("test_a_tokenless_filter_with_no_static_row_has_empty_phase", () => {
  seed([item("polynomial-2", 0)]);
  assert.equal(phaseOf("polynomial-2"), "");
});

// --- a token-less -2s live item reads its base filter's merged row ------------
// The backend join strips `-2s`, so the row under `static` is the base
// filter's; the facet is whatever that row says.

test("test_a_tokenless_2s_filter_takes_phase_from_its_base_static_row", () => {
  seed([item("poly-sinc-hb-2s", 0, { phase: "linear" })]);
  assert.equal(phaseOf("poly-sinc-hb-2s"), "linear");
});

// --- static-only filters (overlay entry, absent from the live enum) -----------

test("test_a_static_only_filter_takes_phase_from_its_overlay_entry", () => {
  seed([item("poly-sinc-hb", 0)], { "sinc-M": { phase: "linear" } });
  assert.equal(phaseOf("sinc-M"), "linear");
});

test("test_a_static_only_filter_name_token_beats_its_overlay_phase", () => {
  seed([item("poly-sinc-hb", 0)], { "poly-sinc-short-mp": { phase: "linear" } });
  assert.equal(phaseOf("poly-sinc-short-mp"), "minimum");
});
