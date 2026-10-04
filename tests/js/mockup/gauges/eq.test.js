// Behavioral suite for mockup/scripts/model/eq.js: AutoEq / REW bands turned into iir stages, an EQ landed on one
// pipeline (its peak and shelf stages replaced by the band stages given, its gain set to the preamp), the AutoEq hit
// search and the hits it shows, a picked hit's band summary and preview pipeline, and a pipeline's band count.
//
// Run: node --test tests/js/mockup/eq.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  bandsToStages,
  hitPipe,
  hitSummary,
  peqCount,
  replacePeq,
  searchHits,
  shownHits,
} from "../../../../mockup/scripts/model/gauges/eq.js";

//: Two bands with distinct f, g and Q: the first typed, the second left to the default.
/** @type {import("../../../../mockup/scripts/model/gauges/eq.js").Band[]} */
const BANDS = [
  [105, 5.5, 0.71, "lshelf"],
  [3000, -2.1, 1.6],
];

/**
 * A stage record as the tables below write it.
 *
 * @typedef {{ kind: string, type?: string, f?: number, g?: number, q?: number, t?: number }} Rec
 */

//: A pipeline holding a delay, an old peak, a low-pass and an old high shelf, gain in Lin.
/** @type {Rec} */
const DELAY = { kind: "delay", t: 0.001 };
/** @type {Rec} */
const LP = { kind: "iir", type: "lp", f: 120, q: 0.707 };
const PIPE = {
  src: 0,
  mix: 0,
  gain: 0.5,
  unit: "Lin",
  stages: [
    DELAY,
    { kind: "iir", type: "peak", f: 41, g: -8.5, q: 4.3 },
    LP,
    { kind: "iir", type: "hshelf", f: 8000, g: -1.5, q: 0.7 },
  ],
};

//: The EQ landed on it: two new band stages and a preamp.
/** @type {Rec[]} */
const NEW = [
  { kind: "iir", type: "peak", f: 200, g: 2.6, q: 3.5 },
  { kind: "iir", type: "hshelf", f: 4000, g: 1.2, q: 0.7 },
];
const PRE = -6.4;

//: Hits the test writes: two names share a word in different cases.
const HITS = [
  { name: "Alpha One", src: "a" },
  { name: "Beta Two", src: "b" },
  { name: "alpha three", src: "c" },
];

test("test_bands_to_stages_carries_frequency_gain_and_q", () => {
  const st = bandsToStages(BANDS)[1];
  assert.deepEqual([st.f, st.g, st.q], [3000, -2.1, 1.6]);
});

test("test_bands_to_stages_keeps_a_band_type", () => {
  assert.equal(bandsToStages(BANDS)[0].type, "lshelf");
});

test("test_bands_to_stages_makes_an_untyped_band_a_peak", () => {
  assert.equal(bandsToStages(BANDS)[1].type, "peak");
});

test("test_bands_to_stages_makes_iir_stages", () => {
  assert.deepEqual(
    bandsToStages(BANDS).map((st) => st.kind),
    ["iir", "iir"],
  );
});

test("test_bands_to_stages_keeps_band_order", () => {
  assert.deepEqual(
    bandsToStages(BANDS).map((st) => st.f),
    [105, 3000],
  );
});

test("test_replace_peq_leaves_only_the_new_bands_as_peak_and_shelf_stages", () => {
  const out = replacePeq(PIPE, NEW, PRE).stages.filter((st) => st.kind === "iir" && st.type !== "lp");
  assert.deepEqual(
    out.map((st) => st.f),
    [200, 4000],
  );
});

test("test_replace_peq_keeps_other_stages_in_order_ahead_of_the_bands", () => {
  assert.deepEqual(replacePeq(PIPE, NEW, PRE).stages.slice(0, 2), [DELAY, LP]);
});

test("test_replace_peq_sets_the_gain_to_the_preamp", () => {
  assert.equal(replacePeq(PIPE, NEW, PRE).gain, -6.4);
});

test("test_replace_peq_sets_the_unit_to_db", () => {
  assert.equal(replacePeq(PIPE, NEW, PRE).unit, "dB");
});

test("test_replace_peq_leaves_the_given_pipeline_untouched", () => {
  const before = structuredClone(PIPE);
  replacePeq(PIPE, NEW, PRE);
  assert.deepEqual(PIPE, before);
});

test("test_search_hits_matches_a_name_whatever_its_case", () => {
  assert.deepEqual(searchHits(HITS, "ALPHA"), [HITS[0], HITS[2]]);
});

test("test_search_hits_ignores_space_around_the_query", () => {
  assert.deepEqual(searchHits(HITS, "  two "), [HITS[1]]);
});

test("test_search_hits_keeps_every_hit_for_a_blank_query", () => {
  assert.deepEqual(searchHits(HITS, "   "), HITS);
});

//: Five hits the test writes, every name holding "hd"; the cap shows two of them.
const MANY = ["HD 1", "HD 2", "HD 3", "HD 4", "HD 5"].map((name) => ({ name }));
const CAP = 2;

test("test_shown_hits_shows_nothing_for_a_blank_query", () => {
  assert.deepEqual(shownHits(MANY, "  ", CAP).shown, []);
});

test("test_shown_hits_counts_nothing_more_for_a_blank_query", () => {
  assert.equal(shownHits(MANY, "  ", CAP).more, 0);
});

test("test_shown_hits_shows_the_first_matches_up_to_the_cap", () => {
  assert.deepEqual(shownHits(MANY, "hd", CAP).shown, [MANY[0], MANY[1]]);
});

test("test_shown_hits_counts_the_matches_past_the_cap", () => {
  assert.equal(shownHits(MANY, "hd", CAP).more, 3);
});

test("test_shown_hits_counts_nothing_more_when_the_matches_fit", () => {
  assert.equal(shownHits(MANY, "hd 4", CAP).more, 0);
});

test("test_shown_hits_shows_only_matches", () => {
  assert.deepEqual(shownHits(MANY, "hd 4", CAP).shown, [MANY[3]]);
});

//: A picked hit the test writes: the two bands above and a preamp.
const PICK = { name: "Pick", src: "p", bands: BANDS, pre: -3.5 };

test("test_hit_summary_counts_the_bands", () => {
  assert.equal(hitSummary(PICK).count, 2);
});

test("test_hit_summary_carries_the_preamp", () => {
  assert.equal(hitSummary(PICK).pre, -3.5);
});

test("test_hit_pipe_makes_the_bands_its_stages", () => {
  assert.deepEqual(
    hitPipe(PICK).stages.map((st) => st.f),
    [105, 3000],
  );
});

test("test_hit_pipe_sets_the_gain_to_the_preamp", () => {
  assert.equal(hitPipe(PICK).gain, -3.5);
});

test("test_hit_pipe_sets_the_unit_to_db", () => {
  assert.equal(hitPipe(PICK).unit, "dB");
});

test("test_peq_count_counts_peak_and_shelf_stages_only", () => {
  assert.equal(peqCount(PIPE.stages), 2);
});

test("test_peq_count_skips_a_convolution_stage", () => {
  assert.equal(peqCount([{ kind: "conv" }, ...NEW]), 2);
});
