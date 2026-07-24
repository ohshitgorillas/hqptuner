// Behavioral suite for store/narrowing.js — the client-side filter-list
// narrowing.
//
// Two measured facts a suite written from the signature alone would get wrong:
//
//   * Facets are keyed by the option's LABEL, not its value. An option whose
//     label has no facet entry passes through untouched — narrowing hides only
//     what it can positively exclude.
//   * When no facet is active the SAME array object is returned, not a copy.
//     Asserting "always returns a new array" fails.
//
// Apodizing narrowing is PER 1x-CHAIN (keyed by the dropdown's field key) and
// 1x-only, so narrowOptions takes that key as its fourth argument. The facet
// signals are module-level and persist across cases, so every test starts from
// resetNarrowing() via `only()`.

import test from "node:test";
import assert from "node:assert/strict";

import { enums, metadata } from "../../hqptuner/static/store/state.js";
import {
  narrowOptions,
  narrowingActive,
  resetNarrowing,
  setApod,
  setApodHalf,
  nGenre,
  nQuality,
  nFocus,
  nPhase,
  nLength,
  nRatio,
  nUpsampleOnly,
} from "../../hqptuner/static/store/narrowing.js";

// The engine enumeration the facets are derived from. `apodizing` arrives
// pre-computed from the backend (metadata.py, arg bit 0); ½-apodizing is read
// off the raw arg client-side. The ratio class is the token after the ⥮.
enums.value = {
  filters: [
    {
      name: "poly-sinc-gauss-long",
      apodizing: true,
      description: "5/5 transients, timbre ⥮ Any",
      static: { genre: ["rock", "pop"] },
    },
    { name: "sinc-M", description: "4/5 space ⥮ Integer", static: { genre: ["any"] } },
    { name: "poly-sinc-short-mp", arg: 2, description: "2/5 ⥮ 2x", static: { genre: ["jazz"] } },
    { name: "gauss-lp", apodizing: true, arg: 2, description: "3/5 timbre ⥮ 1:1" },
    { name: "unlisted-filter", description: "no quality here" },
  ],
};

// The static overlay — filters keyed by name, joined at runtime. None of these
// are in the live enum above: they stand in for the inactive output mode's
// exclusive filters (the mode-scoping bug: without the overlay they had no
// facets at all). Each carries only what its own test asserts on.
metadata.value = {
  filters: {
    filters: {
      "static-quality-2": { genre: [], quality: 2, focus: [], apodizing: "none", ratio: "integer" },
      "static-quality-5": { genre: [], quality: 5, focus: [], apodizing: "none", ratio: "integer" },
      "static-upsample": { genre: [], quality: 3, focus: [], apodizing: "none", ratio: "2x", upsample_only: true },
      "static-bidirectional": { genre: [], quality: 3, focus: [], apodizing: "none", ratio: "2x" },
    },
  },
};

const OPTIONS = [
  { value: "0", label: "poly-sinc-gauss-long" },
  { value: "1", label: "sinc-M" },
  { value: "2", label: "poly-sinc-short-mp" },
  { value: "3", label: "gauss-lp" },
  { value: "4", label: "unlisted-filter" },
  { value: "5", label: "NOT-IN-FACETS" },
];

// Apply exactly one facet from a clean slate. Apod defaults ON, so a case that
// does not want apodizing narrowing must clear it explicitly (both chains).
function only(apply) {
  resetNarrowing();
  setApod("pcm_filter_1x", false);
  setApod("sdm_filter_1x", false);
  apply();
}

const kept = (current = null, stage = "1x", field = "pcm_filter_1x") =>
  narrowOptions(OPTIONS, current, stage, field).map((o) => o.label);

// A one-off option whose facets come from the static overlay above.
const opt = (label) => [{ value: "9", label }];

// --- the inactive path ------------------------------------------------------

test("test_no_active_facet_returns_the_option_list_unchanged", () => {
  only(() => {});
  assert.equal(narrowOptions(OPTIONS, null, "1x", "pcm_filter_1x"), OPTIONS);
});

test("test_apodizing_narrowing_is_ignored_outside_the_1x_stage", () => {
  resetNarrowing(); // apod defaults on
  assert.equal(narrowOptions(OPTIONS, null, "Nx", "pcm_filter_nx"), OPTIONS);
});

test("test_a_filtering_pass_returns_a_new_array", () => {
  only(() => (nPhase.value = "minimum"));
  assert.notEqual(narrowOptions(OPTIONS, null, "1x", "pcm_filter_1x"), OPTIONS);
});

// --- pass-through rules -----------------------------------------------------

test("test_an_option_with_no_facet_data_always_passes", () => {
  only(() => (nPhase.value = "linear"));
  assert.ok(kept().includes("NOT-IN-FACETS"));
});

test("test_the_current_selection_is_never_hidden", () => {
  only(() => (nPhase.value = "linear"));
  assert.ok(kept("2").includes("poly-sinc-short-mp"));
});

test("test_the_current_selection_matches_across_value_types", () => {
  only(() => (nPhase.value = "linear"));
  assert.ok(kept(2).includes("poly-sinc-short-mp"));
});

// --- genre ------------------------------------------------------------------

test("test_a_genre_facet_keeps_filters_carrying_that_genre", () => {
  only(() => (nGenre.value = ["rock"]));
  assert.ok(kept().includes("poly-sinc-gauss-long"));
});

test("test_a_genre_facet_drops_filters_without_it", () => {
  only(() => (nGenre.value = ["rock"]));
  assert.equal(kept().includes("poly-sinc-short-mp"), false);
});

test("test_an_any_genre_filter_survives_every_genre_facet", () => {
  only(() => (nGenre.value = ["classical"]));
  assert.ok(kept().includes("sinc-M"));
});

test("test_multiple_genres_are_combined_as_or", () => {
  only(() => (nGenre.value = ["rock", "jazz"]));
  assert.ok(kept().includes("poly-sinc-short-mp"));
});

// --- quality ----------------------------------------------------------------

test("test_a_quality_floor_keeps_filters_at_or_above_it", () => {
  only(() => (nQuality.value = 4));
  assert.ok(kept().includes("sinc-M"));
});

test("test_a_quality_floor_drops_filters_below_it", () => {
  only(() => (nQuality.value = 4));
  assert.equal(kept().includes("gauss-lp"), false);
});

test("test_a_filter_with_no_stated_quality_is_dropped_by_any_quality_floor", () => {
  only(() => (nQuality.value = 1));
  assert.equal(kept().includes("unlisted-filter"), false);
});

test("test_an_unparseable_quality_narrows_nothing", () => {
  // Number("abc") is NaN, which is falsy, so the facet silently becomes "any"
  only(() => (nQuality.value = "abc"));
  assert.equal(narrowOptions(OPTIONS, null, "1x", "pcm_filter_1x"), OPTIONS);
});

// --- focus, phase, length ---------------------------------------------------

test("test_a_focus_facet_keeps_filters_carrying_that_focus", () => {
  only(() => (nFocus.value = ["space"]));
  assert.ok(kept().includes("sinc-M"));
});

test("test_a_focus_facet_drops_filters_without_it", () => {
  only(() => (nFocus.value = ["space"]));
  assert.equal(kept().includes("gauss-lp"), false);
});

test("test_a_phase_facet_keeps_that_phase", () => {
  only(() => (nPhase.value = "minimum"));
  assert.ok(kept().includes("poly-sinc-short-mp"));
});

test("test_a_phase_facet_drops_other_phases", () => {
  only(() => (nPhase.value = "minimum"));
  assert.equal(kept().includes("poly-sinc-gauss-long"), false);
});

test("test_a_length_facet_keeps_only_those_lengths", () => {
  only(() => (nLength.value = ["long"]));
  assert.ok(kept().includes("poly-sinc-gauss-long"));
});

test("test_a_length_facet_drops_other_lengths", () => {
  only(() => (nLength.value = ["long"]));
  assert.equal(kept().includes("poly-sinc-short-mp"), false);
});

// --- ratio ------------------------------------------------------------------

test("test_a_ratio_facet_keeps_filters_of_that_ratio_class", () => {
  only(() => (nRatio.value = ["integer"]));
  assert.ok(kept().includes("sinc-M"));
});

test("test_a_ratio_facet_drops_other_ratio_classes", () => {
  only(() => (nRatio.value = ["integer"]));
  assert.equal(kept().includes("gauss-lp"), false);
});

test("test_an_any_ratio_filter_survives_every_ratio_facet", () => {
  only(() => (nRatio.value = ["integer"]));
  assert.ok(kept().includes("poly-sinc-gauss-long"));
});

// --- upsample-only (the orthogonal ratio-popover extra) ---------------------

test("test_upsample_only_narrowing_keeps_an_upsample_only_filter", () => {
  only(() => (nUpsampleOnly.value = true));
  assert.equal(narrowOptions(opt("static-upsample"), null, "1x", "pcm_filter_1x").length, 1);
});

test("test_upsample_only_narrowing_drops_a_bidirectional_filter", () => {
  only(() => (nUpsampleOnly.value = true));
  assert.equal(narrowOptions(opt("static-bidirectional"), null, "1x", "pcm_filter_1x").length, 0);
});

// --- static fallback (the mode-scoping bug fix) -----------------------------

test("test_a_static_only_filter_is_narrowed_by_its_static_quality", () => {
  // quality 2, absent from the live enum: HIDDEN by a quality-4 floor. Before
  // the fix it had no facet and passed through.
  only(() => (nQuality.value = 4));
  assert.equal(narrowOptions(opt("static-quality-2"), null, "1x", "pcm_filter_1x").length, 0);
});

test("test_a_static_only_filter_passes_when_its_static_facet_allows", () => {
  only(() => (nQuality.value = 4));
  assert.equal(narrowOptions(opt("static-quality-5"), null, "1x", "pcm_filter_1x").length, 1);
});

// --- apodizing --------------------------------------------------------------

test("test_apodizing_narrowing_keeps_apodizing_filters", () => {
  resetNarrowing();
  assert.ok(kept().includes("poly-sinc-gauss-long"));
});

test("test_apodizing_narrowing_drops_non_apodizing_filters", () => {
  resetNarrowing();
  assert.equal(kept().includes("sinc-M"), false);
});

test("test_half_apodizing_filters_are_hidden_by_default", () => {
  resetNarrowing();
  assert.equal(kept().includes("poly-sinc-short-mp"), false);
});

test("test_half_apodizing_filters_appear_when_opted_in", () => {
  resetNarrowing();
  setApodHalf("pcm_filter_1x", true);
  assert.ok(kept().includes("poly-sinc-short-mp"));
});

// --- per-chain independence (the point of the per-dropdown move) -------------

test("test_the_pcm_chain_still_narrows_when_the_sdm_chain_apod_is_off", () => {
  resetNarrowing();
  setApod("sdm_filter_1x", false);
  assert.equal(kept(null, "1x", "pcm_filter_1x").includes("sinc-M"), false);
});

test("test_the_sdm_chain_does_not_narrow_when_its_own_apod_is_off", () => {
  resetNarrowing();
  setApod("sdm_filter_1x", false);
  assert.ok(kept(null, "1x", "sdm_filter_1x").includes("sinc-M"));
});

// --- facets combine as AND --------------------------------------------------

test("test_a_filter_meeting_both_facets_is_kept", () => {
  only(() => {
    nGenre.value = ["rock"];
    nQuality.value = 5;
  });
  assert.ok(kept().includes("poly-sinc-gauss-long"));
});

test("test_a_filter_meeting_only_one_facet_is_dropped", () => {
  // sinc-M passes the genre facet (its "any" genre), but fails the quality-5
  // floor at quality 4 — so the AND drops it.
  only(() => {
    nGenre.value = ["rock"];
    nQuality.value = 5;
  });
  assert.equal(kept().includes("sinc-M"), false);
});

test("test_incompatible_facets_drop_a_filter_that_passes_only_one", () => {
  // poly-sinc-short-mp is minimum-phase (passes) but has no space focus (fails).
  only(() => {
    nPhase.value = "minimum";
    nFocus.value = ["space"];
  });
  assert.equal(kept().includes("poly-sinc-short-mp"), false);
});

// --- narrowingActive --------------------------------------------------------

test("test_a_freshly_reset_narrow_bar_does_not_read_as_active", () => {
  resetNarrowing();
  assert.equal(narrowingActive.value, false);
});

test("test_turning_a_chain_apodizing_off_reads_as_active", () => {
  resetNarrowing();
  setApod("pcm_filter_1x", false);
  assert.equal(narrowingActive.value, true);
});

test("test_opting_into_half_apodizing_reads_as_active", () => {
  resetNarrowing();
  setApodHalf("pcm_filter_1x", true);
  assert.equal(narrowingActive.value, true);
});

test("test_a_ratio_facet_reads_as_active", () => {
  resetNarrowing();
  nRatio.value = ["integer"];
  assert.equal(narrowingActive.value, true);
});

test("test_the_upsample_only_toggle_reads_as_active", () => {
  resetNarrowing();
  nUpsampleOnly.value = true;
  assert.equal(narrowingActive.value, true);
});

test("test_an_unparseable_quality_still_reads_as_active", () => {
  // narrowingActive tests the raw signal, narrowOptions coerces it — they can
  // disagree, and the bar reports narrowing that is not in fact happening
  only(() => (nQuality.value = "abc"));
  assert.equal(narrowingActive.value, true);
});

// --- empty input ------------------------------------------------------------

test("test_an_empty_option_list_narrows_to_an_empty_list", () => {
  only(() => (nPhase.value = "linear"));
  assert.equal(narrowOptions([], null, "1x", "pcm_filter_1x").length, 0);
});
