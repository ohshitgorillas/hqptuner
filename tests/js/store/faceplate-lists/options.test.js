// Behavioral suite for hqptuner/static/store/faceplate/lists/options.js and open.js, the option lists' store half: the
// options a chain catalog key lists (the loaded chain's enumeration, the dormant chain's /config form), each joined to
// its facets, plain-names breakdown, rate floor, generation and manual prose; the options narrowing keeps, the running
// value never hidden; the stars a list's heart writes; the form a key's list opens as; and the pick that closes it.
//
// The wire is the seam: enumerations into `enums`, State into `engineState`, the /config form into `config`, the
// overlays into `metadata` (tests/js/support/listsfixture.js), stars through the favorites fake. Every name and
// sentence asserted is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-lists/options.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { hydrateFavorites } from "../../../../hqptuner/static/store/narrow/favorites.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { openList, openOptionList } from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  listBlurbs,
  listOptions,
  narrowedOptions,
  toggleListFavorite,
} from "../../../../hqptuner/static/store/faceplate/lists/options.js";
import { setFacet } from "../../../../hqptuner/static/store/faceplate/lists/facets.js";
import { isPanel, kindOf, pickFromList } from "../../../../hqptuner/static/store/faceplate/lists/open.js";
import { favoritesWire, modulatorPuts, settle } from "../../support/wire/favoriteswire.js";
import { SINC_PROSE, loadLists, resetLists } from "../../support/listsfixture.js";

beforeEach(() => {
  favoritesWire();
  resetLists();
  loadLists();
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * The engine names a list holds, in its order.
 *
 * @param {{ v: string }[]} opts
 */
const names = (opts) => opts.map((o) => o.v);

/**
 * One option of a key's list, by engine name.
 *
 * @param {string} key
 * @param {string} v
 */
const option = (key, v) => listOptions(key).find((o) => o.v === v);

test("test_a_loaded_chains_list_names_the_options_its_enumeration_reports", () => {
  assert.deepEqual(names(listOptions("sdm_filter_1x")), ["poly-sinc-gauss-long", "sinc-M", "IIR"]);
});

test("test_a_dormant_chains_list_names_the_options_its_config_form_offers", () => {
  assert.deepEqual(names(listOptions("pcm_filter_1x")), ["none", "poly-sinc-gauss-long"]);
});

test("test_a_filter_reads_the_quality_its_enumeration_description_rates", () => {
  const q = (/** @type {string} */ v) => option("sdm_filter_1x", v)?.f?.q;
  assert.deepEqual([q("poly-sinc-gauss-long"), q("sinc-M")], [4, 2]);
});

test("test_a_filters_apodizing_follows_its_enumerations_arg_bits", () => {
  const apod = (/** @type {string} */ v) => option("sdm_filter_1x", v)?.f?.apod;
  assert.deepEqual([apod("poly-sinc-gauss-long"), apod("sinc-M"), apod("IIR")], ["full", "half", null]);
});

test("test_a_simplified_option_carries_its_plain_family_and_variant", () => {
  loadLists({ plain: true });
  const o = option("sdm_filter_1x", "sinc-M");
  assert.deepEqual([o?.fam, o?.var], ["Fam A", "Var B"]);
});

test("test_a_simplified_option_carries_its_plain_leaf", () => {
  loadLists({ plain: true });
  assert.equal(option("sdm_filter_1x", "IIR")?.leaf, "Leaf iir");
});

test("test_a_modulator_carries_the_tier_its_rate_floor_names", () => {
  const tier = (/** @type {string} */ v) => option("sdm_modulator", v)?.tier;
  assert.deepEqual([tier("ASDM7EC 512+fs"), tier("ASDM5")], ["512+", undefined]);
});

test("test_a_modulator_carries_the_generation_its_overlay_records", () => {
  const gen = (/** @type {string} */ v) => option("sdm_modulator", v)?.gen;
  assert.deepEqual([gen("ASDM7EC 512+fs"), gen("ASDM5")], [4, 2]);
});

test("test_an_option_carries_the_prose_its_overlay_writes", () => {
  assert.equal(option("sdm_filter_1x", "sinc-M")?.d, SINC_PROSE);
});

test("test_a_lists_blurbs_are_its_plain_overlays_own", () => {
  const b = listBlurbs("sdm_filter_1x");
  assert.deepEqual([b.families["Fam A"], b.variants["Fam A|Var A"]], ["Blurb for Fam A", "Blurb for Var A"]);
});

test("test_a_quality_floor_narrows_out_the_filter_rated_below_it", () => {
  setFacet("quality", 3);
  assert.deepEqual(names(narrowedOptions("sdm_filter_1x", "1x", "IIR")), ["poly-sinc-gauss-long", "IIR"]);
});

test("test_the_running_value_survives_a_facet_that_narrows_it_out", () => {
  setFacet("quality", 3);
  assert.deepEqual(names(narrowedOptions("sdm_filter_1x", "1x", "sinc-M")), ["poly-sinc-gauss-long", "sinc-M", "IIR"]);
});

test("test_an_omitted_option_stays_out_even_when_it_is_the_running_value", () => {
  const OMITTED = "IIR";
  const expected = names(listOptions("sdm_filter_1x")).filter((v) => v !== OMITTED);
  assert.deepEqual(names(narrowedOptions("sdm_filter_1x", "1x", OMITTED, OMITTED)), expected);
});

test("test_an_apodizing_facet_narrows_only_the_stage_it_names", () => {
  setFacet("apod1x", "only");
  const sizes = ["1x", "nx"].map((s) => narrowedOptions("sdm_filter_1x", /** @type {"1x" | "nx"} */ (s), "").length);
  assert.deepEqual(sizes, [1, 3]);
});

test("test_favorites_only_keeps_the_filters_the_server_stars", async () => {
  favoritesWire({ filters: ["sinc-M"] });
  await hydrateFavorites();
  setFacet("fav", true);
  assert.deepEqual(names(narrowedOptions("sdm_filter_1x", "1x", "")), ["sinc-M"]);
});

test("test_favorites_only_keeps_the_modulators_the_server_stars", async () => {
  favoritesWire({ modulators: ["ASDM5"] });
  await hydrateFavorites();
  setFacet("fav", true);
  assert.deepEqual(names(narrowedOptions("sdm_modulator", "1x", "")), ["ASDM5"]);
});

test("test_a_rate_floor_facet_keeps_the_modulators_of_that_tier", () => {
  setFacet("modTier", ["512+"]);
  assert.deepEqual(names(narrowedOptions("sdm_modulator", "1x", "")), ["ASDM7EC 512+fs"]);
});

test("test_a_rate_marker_facet_keeps_the_dithers_whose_plain_leaf_carries_it", () => {
  setFacet("ditherRate", ["≥4x"]);
  assert.deepEqual(names(narrowedOptions("pcm_dither", "1x", "")), ["NS9"]);
});

test("test_a_modulators_heart_writes_the_modulator_star_set", async () => {
  const w = favoritesWire();
  await toggleListFavorite("sdm_modulator", "ASDM5");
  await settle();
  assert.deepEqual(modulatorPuts(w).at(-1), ["ASDM5"]);
});

test("test_a_shaper_key_opens_as_a_panel_and_a_filter_key_as_a_sheet", () => {
  const panel = ["sdm_modulator", "pcm_dither", "sdm_filter_nx"].map((k) => isPanel(kindOf(k)));
  assert.deepEqual(panel, [true, true, false]);
});

test("test_a_pick_hands_the_engine_name_to_the_list_request", () => {
  /** @type {string[]} */
  const picked = [];
  openOptionList({ key: "sdm_filter_1x", stage: "1x", value: "IIR", pick: (v) => picked.push(v) });
  pickFromList("sinc-M");
  assert.deepEqual(picked, ["sinc-M"]);
});

test("test_a_pick_closes_the_list", () => {
  openOptionList({ key: "sdm_filter_1x", stage: "1x", value: "IIR", pick: () => undefined });
  pickFromList("sinc-M");
  assert.equal(openList.value, null);
});
