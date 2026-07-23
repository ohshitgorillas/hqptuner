// Behavioral suite for store/narrowing.js — the client-side filter-list
// narrowing. Written BEFORE the complexity refactor of its predicate (19).
//
// Two measured facts a suite written from the signature alone would get wrong:
//
//   * Facets are keyed by the option's LABEL, not its value. An option whose
//     label has no facet entry passes through untouched — narrowing hides only
//     what it can positively exclude.
//   * When no facet is active the SAME array object is returned, not a copy.
//     Asserting "always returns a new array" fails.
//
// The facet signals are module-level and persist across cases, so every test
// starts from resetNarrowing() via `only()`.

import test from "node:test";
import assert from "node:assert/strict";

import { enums } from "../../hqptuner/static/store/state.js";
import {
  narrowOptions,
  narrowingActive,
  resetNarrowing,
  nGenre,
  nQuality,
  nFocus,
  nPhase,
  nLength,
  nApod,
  nApodHalf,
} from "../../hqptuner/static/store/narrowing.js";

// The engine enumeration the facets are derived from. `apodizing` arrives
// pre-computed from the backend (metadata.py, arg bit 0); ½-apodizing is read
// off the raw arg client-side.
enums.value = {
  filters: [
    {
      name: "poly-sinc-gauss-long",
      apodizing: true,
      description: "5/5 transients, timbre ⥮ 1:1",
      static: { genre: ["rock", "pop"] },
    },
    { name: "sinc-M", description: "4/5 space ⥮ 1:1", static: { genre: ["any"] } },
    { name: "poly-sinc-short-mp", arg: 2, description: "2/5 ⥮ 1:1", static: { genre: ["jazz"] } },
    { name: "gauss-lp", apodizing: true, arg: 2, description: "3/5 timbre ⥮ 1:1" },
    { name: "unlisted-filter", description: "no quality here" },
  ],
};

const OPTIONS = [
  { value: "0", label: "poly-sinc-gauss-long" },
  { value: "1", label: "sinc-M" },
  { value: "2", label: "poly-sinc-short-mp" },
  { value: "3", label: "gauss-lp" },
  { value: "4", label: "unlisted-filter" },
  { value: "5", label: "NOT-IN-FACETS" },
];

// Apply exactly one facet from a clean slate. nApod defaults ON, so a case that
// does not want apodizing narrowing must clear it explicitly.
function only(apply) {
  resetNarrowing();
  nApod.value = false;
  apply();
}

const kept = (current = null, stage = "1x") => narrowOptions(OPTIONS, current, stage).map((o) => o.label);

// --- the inactive path ------------------------------------------------------

test("test_no_active_facet_returns_the_option_list_unchanged", () => {
  only(() => {});
  assert.equal(narrowOptions(OPTIONS, null, "1x"), OPTIONS);
});

test("test_apodizing_narrowing_is_ignored_outside_the_1x_stage", () => {
  resetNarrowing(); // nApod defaults on
  assert.equal(narrowOptions(OPTIONS, null, "Nx"), OPTIONS);
});

test("test_a_filtering_pass_returns_a_new_array", () => {
  only(() => (nPhase.value = "minimum"));
  assert.notEqual(narrowOptions(OPTIONS, null, "1x"), OPTIONS);
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
  assert.deepEqual(kept(), ["poly-sinc-gauss-long", "sinc-M", "NOT-IN-FACETS"]);
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
  assert.equal(narrowOptions(OPTIONS, null, "1x"), OPTIONS);
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

test("test_a_phase_facet_keeps_only_that_phase", () => {
  only(() => (nPhase.value = "minimum"));
  assert.deepEqual(kept(), ["poly-sinc-short-mp", "NOT-IN-FACETS"]);
});

test("test_a_length_facet_keeps_only_those_lengths", () => {
  only(() => (nLength.value = ["long"]));
  assert.ok(kept().includes("poly-sinc-gauss-long"));
});

test("test_a_length_facet_drops_other_lengths", () => {
  only(() => (nLength.value = ["long"]));
  assert.equal(kept().includes("poly-sinc-short-mp"), false);
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
  nApodHalf.value = true;
  assert.ok(kept().includes("poly-sinc-short-mp"));
});

// --- facets combine as AND --------------------------------------------------

test("test_two_facets_are_combined_as_and", () => {
  only(() => {
    nGenre.value = ["rock"];
    nQuality.value = 5;
  });
  assert.deepEqual(kept(), ["poly-sinc-gauss-long", "NOT-IN-FACETS"]);
});

test("test_facets_that_cannot_co_occur_narrow_to_nothing", () => {
  only(() => {
    nPhase.value = "minimum";
    nFocus.value = ["space"];
  });
  assert.deepEqual(kept(), ["NOT-IN-FACETS"]);
});

// --- narrowingActive --------------------------------------------------------

test("test_a_freshly_reset_narrow_bar_does_not_read_as_active", () => {
  resetNarrowing();
  assert.equal(narrowingActive.value, false);
});

test("test_turning_apodizing_off_reads_as_active", () => {
  resetNarrowing();
  nApod.value = false;
  assert.equal(narrowingActive.value, true);
});

test("test_opting_into_half_apodizing_reads_as_active", () => {
  resetNarrowing();
  nApodHalf.value = true;
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
  assert.deepEqual(narrowOptions([], null, "1x"), []);
});
