// Behavioral suite for the Quality facet's option table and its default
// (store/narrow/state.js, components/narrowbar/facet-data.js): the dropdown's four
// rows verbatim, the facet starting at 0 — "Any quality", no floor applied —
// and what that default means for reset, the narrowed indicator, matching and
// hydration.
//
// The facet's domain is unchanged — 0 means no quality narrowing, 3/4/5 mean
// "hide anything rated below this" — and the default is 0 (quality-default-any
// spec delta), so a fresh bar applies no quality floor and "the bar is
// narrowed" means "quality deviates from 0": any explicit floor of 3, 4 or 5
// reads as narrowed, a quality of 0 never does.
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

import { nQuality, nApod1x, narrowingActive, resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { favoriteFilters, nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";
import { QUALITY } from "../../../hqptuner/static/components/narrowbar/facet-data.js";
import { oneLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";
import { narrowOptions, narrowCount } from "../../../hqptuner/static/store/narrow/match.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";
import { hydrateNarrowing, flushNarrowing } from "../../../hqptuner/static/store/narrow/persist.js";
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

test("test_a_freshly_loaded_store_leaves_quality_at_0", () => {
  assert.equal(nQuality.value, 0);
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
// One filter per rating band. Every filter the daemon enumerates carries its
// rating at the head of the description (protocol.md:228), so a live item
// without one is a frame the wire never carries; the genuinely unrated filter
// is the overlay-only one the live enumeration omits (architecture.md:27), and
// it gets its own fixture below. Names carry no phase, length or hires marker,
// and `arg` stays 0, so nothing narrows by a facet these cases did not pick;
// every case reads the Nx stage, whose other switches default to "all".

/** @type {[string, string][]} */
const RATED = [
  ["gauss-two", "2/5 ⥮ Any"],
  ["gauss-three", "3/5 ⥮ Any"],
  ["gauss-four", "4/5 ⥮ Any"],
  ["gauss-five", "5/5 ⥮ Any"],
];

// A filter of the inactive mode: the live enumeration omits it, so its facets
// come from the static overlay alone — and that row carries no `quality` key,
// which is the only way a filter reaches the matcher with no rating at all.
const UNRATED_NAME = "sinc-overlay-only";
const UNRATED_OVERLAY = { [UNRATED_NAME]: { phase: "linear" } };

/**
 * Reseed both source signals and reset every facet — module-level signals
 * outlive a test, so each case starts from a full reset. `extras` are names a
 * dropdown offers that the live enumeration does not carry, the way it offers
 * the inactive mode's filters.
 *
 * @param {[string, string][]} filters
 * @param {Record<string, Record<string, unknown>>} [overlay]
 * @param {string[]} [extras]
 * @returns {{ value: string, label: string }[]}
 */
function seed(filters, overlay = {}, extras = []) {
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
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  favoriteFilters.value = new Set();
  nFavOnly.value = false;
  const live = filters.map(([name], i) => ({ label: name, value: String(i) }));
  return live.concat(extras.map((name, i) => ({ label: name, value: String(filters.length + i) })));
}

/** @param {{ value: string, label: string }[]} options */
const labels = (options) => narrowOptions(options, STAGE, FIELD).map((o) => o.label);

// --- matching is unchanged ------------------------------------------------------
// 0 matches everything, rated or not; n keeps only ratings of n or higher.

for (const [selection, expected] of [
  [0, ["gauss-two", "gauss-three", "gauss-four", "gauss-five"]],
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

// A filter with no rating anywhere — no live description, no `quality` in its
// overlay row — is rejected by any floor and accepted only by "any quality".

test("test_a_quality_floor_rejects_a_filter_whose_overlay_row_carries_no_rating", () => {
  const options = seed(RATED, UNRATED_OVERLAY, [UNRATED_NAME]);
  nQuality.value = 3;
  assert.equal(labels(options).includes(UNRATED_NAME), false);
});

test("test_any_quality_accepts_a_filter_whose_overlay_row_carries_no_rating", () => {
  const options = seed(RATED, UNRATED_OVERLAY, [UNRATED_NAME]);
  nQuality.value = 0;
  assert.equal(labels(options).includes(UNRATED_NAME), true);
});

// --- what counts as "narrowed" ---------------------------------------------------
// Narrowed means DEVIATES from the default: 0 with everything else at its own
// default is not narrowed, while any explicit floor — 3, 4 or 5 — is.

test("test_quality_at_its_default_of_0_is_not_active_narrowing", () => {
  seed(RATED);
  nQuality.value = 0;
  assert.equal(narrowingActive.value, false);
});

for (const selection of [3, 4, 5]) {
  test(`test_quality_at_${selection}_is_active_narrowing`, () => {
    seed(RATED);
    nQuality.value = selection;
    assert.equal(narrowingActive.value, true);
  });
}

// --- reset returns quality to its default ----------------------------------------

test("test_reset_returns_quality_to_its_default_of_0", () => {
  seed(RATED);
  nQuality.value = 4;
  resetNarrowing();
  assert.equal(nQuality.value, 0);
});

// --- hydration takes the stored value, or the new default --------------------------
// The reset pattern is narrowing-persist.test.js's: one flush against a
// throwaway wire drains the private "changed" mark before the case's own fake
// fetch is installed.

// Quality is moved OFF both the default and whatever the case's payload says
// before the hydration runs, so neither case can be satisfied by the state the
// reset left behind: only a hydration that reads its payload — and falls back
// to the default where the payload is silent — lands on the asserted value.
//
// The move happens BEFORE the draining flush, not after. A facet the user has
// touched since the last write is theirs and a hydration will not overwrite it
// (narrowing-persist.test.js, "a facet changed while the hydration was in
// flight survives it"), so a write made after the flush would leave every case
// here asserting that hydration declined to act.
/** @param {Record<string, unknown>} facets */
async function hydrateFrom(facets) {
  narrowingWire();
  resetNarrowing();
  nQuality.value = 5;
  await flushNarrowing();
  env.fetch = async (/** @type {string} */ path) => (path === PATH ? ok({ facets }) : ok({}));
  await hydrateNarrowing();
}

test("test_hydration_takes_a_stored_quality_of_3_over_the_default", async () => {
  await hydrateFrom({ quality: 3 });
  assert.equal(nQuality.value, 3);
});

test("test_hydration_leaves_a_quality_the_server_omits_at_the_default_of_0", async () => {
  await hydrateFrom({ phase: "linear" });
  assert.equal(nQuality.value, 0);
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

// The count is a separate entry point from the filtering, so it is asserted
// against the contract rather than against the list: of the two fixture
// filters, the 5/5 one passes a floor of 5 on its rating and the pass-through
// passes on the exemption alone, so a count blind to the exemption answers 1.
test("test_the_reported_count_includes_the_exempt_pass_through", () => {
  const options = seed(PASSTHROUGH);
  nQuality.value = 5;
  assert.equal(narrowCount(options, STAGE, FIELD).n, 2);
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
// favourites at all", and quality is opened to "any" so favourites-only is the
// only facet that can drop the row — otherwise the 1/5 rating would drop it
// under an implementation with no exemption at all, which is what this case
// exists to catch.
test("test_the_pass_through_is_not_offered_when_favourites_only_is_on_and_it_is_not_starred", () => {
  const options = seed(PASSTHROUGH);
  nQuality.value = 0;
  favoriteFilters.value = new Set(["gauss-five"]);
  nFavOnly.value = true;
  assert.equal(labels(options).includes("none"), false);
});
