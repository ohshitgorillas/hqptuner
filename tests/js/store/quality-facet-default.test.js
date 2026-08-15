// Behavioral suite for the Quality facet's option table and its new default
// (store/narrowing.js, components/narrowbar/facet-data.js): the dropdown's four
// rows verbatim, the facet starting at "minimum 3" instead of "any quality",
// and what that default means for reset, the narrowed indicator, matching and
// hydration.
//
// The facet's domain is unchanged — 0 means no quality narrowing, 3/4/5 mean
// "hide anything rated below this" — but the default moved to 3, so "the bar is
// narrowed" now means "quality DEVIATES from 3": an explicit 0 is a narrowing
// choice of its own and reads as narrowed.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Filter fixtures are hand-built in the engine's own `<FiltersItem/>`
// shape, with the quality rating at the head of the engine's description
// string, `"<q>/5 ... ⥮ <ratio>"` (protocol.md:228) — the unrated fixture
// simply carries no `n/5` head. Hydration cases drive real GET /api/narrowing
// answers through a fetch fake, the way narrowing-persist.test.js does.
//
// The very first test reads `nQuality` before anything has reset or seeded a
// signal — module-level signals hold their initial value until touched, so that
// read IS the freshly loaded store.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/quality-facet-default.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nQuality, nApod1x, narrowingActive, resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { favoriteFilters, nFavOnly } from "../../../hqptuner/static/store/favorites.js";
import { QUALITY } from "../../../hqptuner/static/components/narrowbar/facet-data.js";
import { oneLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";
import { narrowOptions, narrowCount } from "../../../hqptuner/static/store/narrowmatch.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";
import { hydrateNarrowing, flushNarrowing } from "../../../hqptuner/static/store/narrowpersist.js";
import { ok } from "../support/wire.js";
import { narrowingWire } from "../support/narrowingwire.js";

const STAGE = "nx";
const FIELD = "pcm_filter_nx";
const PATH = "/api/narrowing";

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares `fetch` returning a real `Response`, which this fake does
 * not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/** The contract table: the four rows the dropdown offers, verbatim. */
const ROWS = [
  [0, "Any quality"],
  [3, "Quality: ≥ 3/5"],
  [4, "Quality: ≥ 4/5"],
  [5, "Quality: 5/5"],
];

// --- the freshly loaded store -------------------------------------------------
// Nothing has touched a signal yet: this read is the module's initial state.

test("test_a_freshly_loaded_store_leaves_quality_at_3", () => {
  assert.equal(nQuality.value, 3);
});

test("test_the_exported_quality_default_is_3", async () => {
  const mod = await import("../../../hqptuner/static/store/narrowing.js");
  assert.equal(mod.QUALITY_DEFAULT, 3);
});

// --- the dropdown's rows, character for character ------------------------------

test("test_the_quality_dropdown_offers_exactly_the_four_rows_verbatim", () => {
  assert.deepEqual(QUALITY, ROWS);
});

for (const [value, label] of ROWS) {
  test(`test_the_label_read_for_a_selected_quality_of_${value}_is_its_row_label`, () => {
    assert.equal(oneLabel(QUALITY, value, "no row matched"), label);
  });
}

// --- fixtures for matching and the narrowed indicator ---------------------------
// One filter per rating band plus one carrying no rating at all. Names carry no
// phase, length or hires marker, and `arg` stays 0, so nothing narrows by a
// facet these cases did not pick; every case reads the Nx stage, whose other
// switches default to "all".

/** @type {[string, string][]} */
const RATED = [
  ["gauss-two", "2/5 ⥮ Any"],
  ["gauss-three", "3/5 ⥮ Any"],
  ["gauss-four", "4/5 ⥮ Any"],
  ["gauss-five", "5/5 ⥮ Any"],
  ["gauss-unrated", "⥮ Any"],
];

/**
 * Reseed both source signals and reset every facet — module-level signals
 * outlive a test, so each case starts from a full reset.
 *
 * @param {[string, string][]} filters
 * @returns {{ value: string, label: string }[]}
 */
function seed(filters) {
  enums.value = {
    filters: filters.map(([name, description], i) => ({
      index: String(i),
      name,
      value: String(i),
      arg: 0,
      description,
      apodizing: false,
    })),
  };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  favoriteFilters.value = new Set();
  nFavOnly.value = false;
  return filters.map(([name], i) => ({ label: name, value: String(i) }));
}

/** @param {{ value: string, label: string }[]} options */
const labels = (options) => narrowOptions(options, STAGE, FIELD).map((o) => o.label);

// --- matching is unchanged ------------------------------------------------------
// 0 matches everything, rated or not; n keeps only ratings of n or higher and
// rejects the unrated filter along with anything rated below n.

for (const [selection, expected] of [
  [0, ["gauss-two", "gauss-three", "gauss-four", "gauss-five", "gauss-unrated"]],
  [3, ["gauss-three", "gauss-four", "gauss-five"]],
  [4, ["gauss-four", "gauss-five"]],
  [5, ["gauss-five"]],
]) {
  test(`test_a_quality_selection_of_${selection}_keeps_exactly_the_filters_it_matches`, () => {
    const options = seed(RATED);
    nQuality.value = selection;
    assert.deepEqual(labels(options), expected);
  });
}

test("test_a_nonzero_quality_selection_rejects_a_filter_carrying_no_rating", () => {
  const options = seed(RATED);
  nQuality.value = 3;
  assert.equal(labels(options).includes("gauss-unrated"), false);
});

// --- what counts as "narrowed" ---------------------------------------------------
// Narrowed means DEVIATES from the default: 3 with everything else at its own
// default is not narrowed, while an explicit 0 — any quality — is.

test("test_quality_at_its_default_of_3_is_not_active_narrowing", () => {
  seed(RATED);
  nQuality.value = 3;
  assert.equal(narrowingActive.value, false);
});

for (const selection of [0, 4, 5]) {
  test(`test_quality_at_${selection}_is_active_narrowing`, () => {
    seed(RATED);
    nQuality.value = selection;
    assert.equal(narrowingActive.value, true);
  });
}

// --- reset returns quality to its default, not to blank ---------------------------

test("test_reset_returns_quality_to_its_default_of_3", () => {
  seed(RATED);
  nQuality.value = 0;
  resetNarrowing();
  assert.equal(nQuality.value, 3);
});

// --- hydration takes the stored value, or the new default --------------------------
// The reset pattern is narrowing-persist.test.js's: one flush against a
// throwaway wire drains the private "changed" mark before the case's own fake
// fetch is installed.

/** @param {Record<string, unknown>} facets */
async function hydrateFrom(facets) {
  narrowingWire();
  resetNarrowing();
  await flushNarrowing();
  env.fetch = async (/** @type {string} */ path) => (path === PATH ? ok({ facets }) : ok({}));
  await hydrateNarrowing();
}

test("test_hydration_takes_a_stored_quality_of_0_over_the_default", async () => {
  await hydrateFrom({ quality: 0 });
  assert.equal(nQuality.value, 0);
});

test("test_hydration_leaves_a_quality_the_server_omits_at_the_default_of_3", async () => {
  await hydrateFrom({ phase: "linear" });
  assert.equal(nQuality.value, 3);
});

// --- the pass-through's escape hatch ------------------------------------------
// `none` describes an ABSENCE of resampling rather than poor resampling, so it
// is offered whatever the descriptive facets say — the way genre's "any" tag
// already outranks the genre mode. It reaches the client in the PCM enumeration
// only, at index 0, rated 1/5, ratio class 1:1, `arg` 0 (non-apodizing) — the
// fixture below is that item verbatim, so the 1/5 rating fails every floor the
// dropdown can be set to and the 0 arg fails the apodizing-only switch.

/** @type {[string, string][]} */
const PASSTHROUGH = [
  ["none", "1/5 ⥮ 1:1"],
  ["gauss-five", "5/5 ⥮ Any"],
];

for (const floor of [3, 4, 5]) {
  test(`test_the_pass_through_is_offered_with_the_quality_floor_at_${floor}`, () => {
    const options = seed(PASSTHROUGH);
    nQuality.value = floor;
    assert.equal(labels(options).includes("none"), true);
  });
}

// The count is a separate entry point from the filtering and could disagree
// with it: with the floor at 5 the exemption is the only thing keeping `none`
// in, so a count blind to it answers 1 where the list shows 2.
test("test_the_reported_count_agrees_with_the_options_shown_under_a_quality_floor", () => {
  const options = seed(PASSTHROUGH);
  nQuality.value = 5;
  assert.equal(narrowCount(options, STAGE, FIELD).n, labels(options).length);
});

// The apodizing stage switch is a descriptive facet too, and the 1x stage
// defaults to apodizing-only — which the non-apodizing pass-through fails.

for (const setting of ["only", "half"]) {
  test(`test_the_pass_through_is_offered_with_the_1x_apodizing_switch_at_${setting}`, () => {
    const options = seed(PASSTHROUGH);
    nApod1x.value = setting;
    assert.equal(
      narrowOptions(options, "1x", "pcm_filter_1x").some((o) => o.label === "none"),
      true,
    );
  });
}

// Favourites-only is not a description of the filter but a membership choice
// the user made, so the escape hatch does not reach it. Another filter is
// starred so the case is "not among the favourites", never "there are no
// favourites at all".
test("test_the_pass_through_is_not_offered_when_favourites_only_is_on_and_it_is_not_starred", () => {
  const options = seed(PASSTHROUGH);
  favoriteFilters.value = new Set(["gauss-five"]);
  nFavOnly.value = true;
  assert.equal(labels(options).includes("none"), false);
});
