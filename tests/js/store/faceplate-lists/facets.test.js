// Behavioral suite for hqptuner/static/store/faceplate/lists/facets.js, the narrowing console's store half: the state
// record the console reads off the narrowing and favorites signals and the shaper facets, a facet write
// landing in the persisted signal, the 1x and Nx counts a pick would leave on the running chain's filter lists, a
// shaper list's count, and Reset and the moved test over a set of facet keys.
//
// The wire is the seam: the enumerations, State, /config form and overlays of tests/js/support/listsfixture.js, and
// the narrowing store's own PUT through the narrowing fake. Counts are numbers derived from the fixture's lists.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-lists/facets.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { nGenre } from "../../../../hqptuner/static/store/narrow/state.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import {
  facetsMoved,
  narrowState,
  previewCounts,
  resetFacets,
  setFacet,
  shaperCount,
} from "../../../../hqptuner/static/store/faceplate/lists/facets.js";
import { narrowingWire, puts } from "../../support/wire/narrowingwire.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

/** @type {import("../../support/wire/narrowingwire.js").NarrowingWire} */
let wire;

beforeEach(async () => {
  wire = narrowingWire();
  resetLists();
  loadLists();
  await flushNarrowing();
});

afterEach(async () => {
  await flushNarrowing();
});

test("test_a_facet_set_on_the_console_is_the_one_the_narrowing_store_persists", async () => {
  setFacet("quality", 4);
  await flushNarrowing();
  assert.equal(puts(wire).at(-1)?.quality, 4);
});

test("test_ticking_the_rate_rule_writes_on_and_unticking_it_writes_off", async () => {
  setFacet("hideLimited", true);
  await flushNarrowing();
  setFacet("hideLimited", false);
  await flushNarrowing();
  assert.deepEqual(
    puts(wire)
      .slice(-2)
      .map((f) => f.hide_limited),
    ["on", "off"],
  );
});

test("test_the_state_record_reads_the_genres_the_narrowing_store_holds", () => {
  nGenre.value = ["jazz"];
  assert.deepEqual(narrowState().genre, ["jazz"]);
});

test("test_the_state_record_reads_a_shaper_facet_set_on_the_console", () => {
  setFacet("modTier", ["512+"]);
  assert.deepEqual(narrowState().modTier, ["512+"]);
});

test("test_preview_counts_count_each_stage_of_the_running_chain_with_the_pick_applied", () => {
  assert.deepEqual(previewCounts({ apod1x: "only" }), { "1x": 1, nx: 3 });
});

test("test_preview_counts_count_the_sdm_chains_filter_lists_while_the_engine_has_it_loaded", () => {
  assert.deepEqual(previewCounts({}), { "1x": 3, nx: 3 });
});

test("test_preview_counts_follow_the_engine_to_the_pcm_chain_once_it_loads_it", () => {
  previewCounts({});
  loadLists({ chain: "pcm" });
  assert.deepEqual(previewCounts({}), { "1x": 2, nx: 2 });
});

test("test_a_preview_leaves_the_narrowing_where_it_stands", () => {
  setFacet("quality", 3);
  previewCounts({ quality: 5 });
  assert.equal(narrowState().quality, 3);
});

test("test_a_shaper_count_with_no_rate_floor_counts_every_modulator", () => {
  assert.equal(shaperCount("modulators", {}), 2);
});

test("test_a_shaper_count_counts_the_modulators_a_rate_floor_keeps", () => {
  assert.equal(shaperCount("modulators", { modTier: ["512+"] }), 1);
});

test("test_a_shaper_count_with_no_rate_marker_counts_every_dither", () => {
  assert.equal(shaperCount("dithers", {}), 3);
});

test("test_a_shaper_count_counts_the_dithers_a_rate_marker_keeps", () => {
  assert.equal(shaperCount("dithers", { ditherRate: ["≥4x"] }), 1);
});

test("test_a_facet_set_on_the_console_reads_moved", () => {
  setFacet("lossy", "lossy");
  assert.equal(facetsMoved(["lossy"]), true);
});

test("test_the_rate_rule_reads_moved_once_the_user_sets_it_off", () => {
  setFacet("hideLimited", false);
  assert.equal(facetsMoved(["hideLimited"]), true);
});

test("test_a_quality_floor_and_genres_set_on_the_console_read_moved", () => {
  setFacet("quality", 4);
  setFacet("genre", ["jazz"]);
  assert.equal(facetsMoved(["quality", "genre"]), true);
});

test("test_reset_leaves_a_facet_it_does_not_name_alone", () => {
  setFacet("quality", 4);
  setFacet("modTier", ["512+"]);
  resetFacets(["quality"]);
  assert.deepEqual(narrowState().modTier, ["512+"]);
});
