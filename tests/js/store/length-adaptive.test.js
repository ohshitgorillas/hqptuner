// Behavioral suite for the sinc-family LENGTH revision: the "stupid" length
// bucket and the `adaptive` facet boolean (store/narrow/facets.js), their rows
// in the narrow bar's length domain (components/narrowbar/facet-data.js), the
// "adaptive" pick in narrowing (store/narrow/match.js), the button summary
// (components/narrowbar/labels.js), and the hover tip's Length row
// (components/narrowbar/facettip.js).
//
// Grounding: Signalyst's own descriptions state "one million taps" / "16
// million taps" for sinc-M/Mx/MG/MGa and closed-form-M/16M, and "adaptive
// number of taps" for sinc-S/L/Ls/Lm/Ll/Lh. Descriptions are the rationale,
// never a runtime input — the NAME classifies, so fixtures carry a plain
// engine-format description throughout. All names below are ones the engine's
// `<GetFilters/>` enumeration serves (architecture.md §2), except
// `poly-sinc-short` / `poly-sinc-long`, synthetic stand-ins for any
// non-adaptive filter of a named length.
//
// Policy (docs/testing.md): public API only, one assertion per test, no
// snapshots. Both source signals are reassigned in full per case; length rows
// and tip rows are pinned by VALUE / key / value-token only — no label
// wording, no row ordering in LENGTHS.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/length-adaptive.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterFacets } from "../../../hqptuner/static/store/narrow/facets.js";
import { nLength, resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions, narrowCount } from "../../../hqptuner/static/store/narrow/match.js";
import { LENGTHS } from "../../../hqptuner/static/components/narrowbar/facet-data.js";
import { lengthSummary } from "../../../hqptuner/static/components/narrowbar/labels.js";
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
 * @typedef {{ genre?: string[], quality?: number, focus?: string[], phase?: string, description?: string }} OverlayRow
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
 * outlive a test, so every case reassigns the pair in full. Returns the
 * dropdown options the /config form would serve for these filters.
 *
 * @param {string[]} names
 * @param {Record<string, OverlayRow>} [overlay]
 * @returns {NarrowOption[]}
 */
function seed(names, overlay = {}) {
  enums.value = { filters: names.map((name, i) => item(name, i)) };
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

// --- behavior 1: million-tap names carry the "stupid" length -----------------
// Live-enum path: the name arrives in the engine's own enumeration.

for (const name of ["sinc-M", "sinc-Mx", "sinc-MG", "sinc-MGa", "closed-form-M", "closed-form-16M"]) {
  test(`test_${name.replace(/-/g, "_")}_in_the_live_enum_classifies_as_stupid`, () => {
    seed([name]);
    assert.equal(filterFacets.value[name].length, "stupid");
  });
}

// Static-overlay path: the name is absent from the live enum and exists only
// as a key in the static metadata overlay, which fills facets for names the
// engine did not enumerate (architecture.md §2).

for (const name of ["sinc-M", "sinc-Mx", "sinc-MG", "sinc-MGa", "closed-form-M", "closed-form-16M"]) {
  test(`test_${name.replace(/-/g, "_")}_known_only_to_the_overlay_classifies_as_stupid`, () => {
    seed([], { [name]: {} });
    assert.equal(filterFacets.value[name].length, "stupid");
  });
}

// --- behavior 2: adaptive-tap names carry the adaptive boolean ---------------

for (const name of ["sinc-S", "sinc-L", "sinc-Ls", "sinc-Lm", "sinc-Ll", "sinc-Lh"]) {
  test(`test_${name.replace(/-/g, "_")}_facets_as_adaptive`, () => {
    seed([name]);
    assert.equal(filterFacets.value[name].adaptive, true);
  });
}

// --- behavior 3: the length domain offers both rows --------------------------
// Presence by VALUE only — the label beside it is the owner's wording, and the
// row's position is layout.

test("test_the_length_domain_offers_a_stupid_row", () => {
  assert.ok(LENGTHS.some(([value]) => value === "stupid"));
});

test("test_the_length_domain_offers_an_adaptive_row", () => {
  assert.ok(LENGTHS.some(([value]) => value === "adaptive"));
});

// --- behavior 4: the adaptive pick narrows by the boolean --------------------
// `sinc-S` is the load-bearing member: it facets length "short", so keeping it
// under a lone "adaptive" pick proves the pick reads the boolean, not the
// length bucket. `poly-sinc-short` and `poly-sinc-long` are non-adaptive and
// prove the pick drops something.

const MIX = ["sinc-S", "sinc-Ll", "poly-sinc-short", "poly-sinc-long"];

test("test_the_adaptive_pick_keeps_adaptive_filters_whatever_their_length", () => {
  const options = seed(MIX);
  nLength.value = ["adaptive"];
  assert.deepEqual(labels(options), ["sinc-S", "sinc-Ll"]);
});

test("test_a_length_pick_and_the_adaptive_pick_keep_the_union", () => {
  const options = seed(MIX);
  nLength.value = ["short", "adaptive"];
  assert.deepEqual(labels(options), ["sinc-S", "sinc-Ll", "poly-sinc-short"]);
});

test("test_the_count_under_the_adaptive_pick_agrees_with_the_kept_options", () => {
  const options = seed(MIX);
  nLength.value = ["adaptive"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 2);
});

test("test_the_count_under_the_union_picks_agrees_with_the_kept_options", () => {
  const options = seed(MIX);
  nLength.value = ["short", "adaptive"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 3);
});

// --- behavior 5: the button summary counts a picked adaptive as named --------
// Count only — the words `lengthLabel` builds from it are the owner's.

test("test_the_length_summary_counts_a_lone_adaptive_pick", () => {
  seed(MIX);
  nLength.value = ["adaptive"];
  assert.equal(lengthSummary().count, 1);
});

test("test_the_length_summary_counts_a_named_pick_and_the_adaptive_pick_as_two", () => {
  seed(MIX);
  nLength.value = ["short", "adaptive"];
  assert.equal(lengthSummary().count, 2);
});

// --- behavior 6: the hover tip's Length row carries the adaptive token -------
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
  seed(["sinc-Ll"]);
  assert.ok((lengthTokens("sinc-Ll") || []).includes("adaptive"));
});

test("test_sinc_S_tip_length_row_carries_both_the_short_and_adaptive_tokens", () => {
  seed(["sinc-S"]);
  const tokens = lengthTokens("sinc-S") || [];
  assert.deepEqual([tokens.includes("short"), tokens.includes("adaptive")], [true, true]);
});
