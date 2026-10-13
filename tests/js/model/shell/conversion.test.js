// Behavioral suite: which field of which chain runs on a playback path, what the page opens on, which rows a section
// shows (one field open, or both filters open), and the fit arithmetic (overrun from measured bottoms, which copy gives
// height back and how much).
//
// Plays, picks and measured sizes are tables the test writes; no shipped data supplies an input or an expected value.

import test from "node:test";
import assert from "node:assert/strict";

import {
  bothRows,
  fieldRuns,
  fitStep,
  openOn,
  overrunOf,
  overruns,
  sectionRows,
} from "../../../../hqptuner/static/model/shell/conversion.js";

//: Plays by name: the running chain, the scenario path, and the filter stage the source rate selects.
const PLAY = {
  pcm1x: { run: "pcm", path: "pcm-pcm", stage: "1x" },
  pcmNx: { run: "pcm", path: "pcm-pcm", stage: "nx" },
  pcmToSdm: { run: "sdm", path: "pcm-sdm", stage: "1x" },
  dsdToPcm: { run: "pcm", path: "dsd-pcm", stage: "1x" },
  remod: { run: "sdm", path: "sdm-sdm", stage: "1x" },
  direct: { run: "sdm", path: "direct", stage: "1x" },
  idlePcm: { run: "pcm", path: "idle", stage: "1x" },
};

//: Chains on the page, open chain first and last.
const CHAINS = ["pcm", "sdm"];

//: Measured copies: copy height and its left column's height.
const COPIES = [
  { height: 120, left: 100 },
  { height: 200, left: 90 },
  { height: 150, left: 140 },
];
//: Two copies with the same spare height.
const TIED = [
  { height: 130, left: 100 },
  { height: 230, left: 200 },
];
//: Copies no taller than their left columns.
const FLUSH = [
  { height: 80, left: 100 },
  { height: 100, left: 100 },
];

//: Measured page: children's bottoms, the page's bottom, the plate scale and its bottom padding.
const PAGE = { bottoms: [300, 420, 380], pageBottom: 400, scale: 1, padding: 12 };

// ── fieldRuns ────────────────────────────────────────────────────────────

test("test_the_idle_chain_runs_no_field", () => {
  assert.equal(fieldRuns(PLAY.pcm1x, "sdm", "sh"), false);
});

test("test_nothing_runs_while_nothing_plays", () => {
  assert.equal(fieldRuns(PLAY.idlePcm, "pcm", "sh"), false);
});

test("test_direct_runs_no_shaper", () => {
  assert.equal(fieldRuns(PLAY.direct, "sdm", "sh"), false);
});

test("test_remodulation_runs_the_shaper", () => {
  assert.equal(fieldRuns(PLAY.remod, "sdm", "sh"), true);
});

test("test_remodulation_runs_no_1x_filter", () => {
  assert.equal(fieldRuns(PLAY.remod, "sdm", "1x"), false);
});

test("test_remodulation_runs_no_nx_filter", () => {
  assert.equal(fieldRuns(PLAY.remod, "sdm", "nx"), false);
});

test("test_dsd_to_pcm_runs_the_nx_filter", () => {
  assert.equal(fieldRuns(PLAY.dsdToPcm, "pcm", "nx"), true);
});

test("test_dsd_to_pcm_runs_no_1x_filter", () => {
  assert.equal(fieldRuns(PLAY.dsdToPcm, "pcm", "1x"), false);
});

test("test_a_1x_source_runs_the_1x_filter", () => {
  assert.equal(fieldRuns(PLAY.pcm1x, "pcm", "1x"), true);
});

test("test_a_1x_source_runs_no_nx_filter", () => {
  assert.equal(fieldRuns(PLAY.pcm1x, "pcm", "nx"), false);
});

test("test_an_nx_source_runs_the_nx_filter", () => {
  assert.equal(fieldRuns(PLAY.pcmNx, "pcm", "nx"), true);
});

test("test_pcm_to_sdm_runs_the_modulator", () => {
  assert.equal(fieldRuns(PLAY.pcmToSdm, "sdm", "sh"), true);
});

// ── openOn ───────────────────────────────────────────────────────────────

test("test_the_page_opens_on_the_nx_filter_where_it_runs", () => {
  assert.deepEqual(openOn(PLAY.pcmNx, "pcm"), { rs: { chain: "pcm", field: "nx" }, sh: "pcm" });
});

test("test_the_page_opens_on_the_1x_filter_otherwise", () => {
  assert.deepEqual(openOn(PLAY.remod, "sdm"), { rs: { chain: "sdm", field: "1x" }, sh: "sdm" });
});

// ── sectionRows ──────────────────────────────────────────────────────────

/** @typedef {{ kind: string, ch: string, k: string }} Row */

//: Each row resampling shows with the nx filter open, by index.
/** @type {[string, number, Row][]} */
const RESAMPLING_ROWS = [
  ["folds_the_open_fields_sibling", 0, { kind: "line", ch: "pcm", k: "1x" }],
  ["shows_the_open_field_open", 1, { kind: "field", ch: "pcm", k: "nx" }],
];

for (const [behavior, i, row] of RESAMPLING_ROWS) {
  test(`test_resampling_${behavior}`, () => {
    assert.deepEqual(sectionRows(["pcm"], { chain: "pcm", field: "nx" }, ["1x", "nx"])[i], row);
  });
}

test("test_a_closed_chain_folds_to_one_row_on_its_first_field", () => {
  assert.deepEqual(sectionRows(CHAINS, { chain: "pcm", field: "1x" }, ["1x", "nx"])[2], {
    kind: "chain",
    ch: "sdm",
    k: "1x",
  });
});

//: Each row shaping shows with the sdm shaper open, by index.
/** @type {[string, number, Row][]} */
const SHAPING_ROWS = [
  ["folds_the_other_chain_on_its_shaper", 0, { kind: "chain", ch: "pcm", k: "sh" }],
  ["shows_the_open_chains_shaper_open", 1, { kind: "field", ch: "sdm", k: "sh" }],
];

for (const [behavior, i, row] of SHAPING_ROWS) {
  test(`test_shaping_${behavior}`, () => {
    assert.deepEqual(sectionRows(CHAINS, { chain: "sdm", field: "sh" }, ["sh"])[i], row);
  });
}

// ── bothRows ─────────────────────────────────────────────────────────────

//: Each filter field both-open shows for the open sdm chain, by index.
/** @type {[number, { ch: string, k: string }][]} */
const BOTH_FIELDS = [
  [0, { ch: "sdm", k: "1x" }],
  [1, { ch: "sdm", k: "nx" }],
];

for (const [i, field] of BOTH_FIELDS) {
  test(`test_both_open_shows_the_open_chains_${field.k}_filter`, () => {
    assert.deepEqual(bothRows(CHAINS, "sdm").fields[i], field);
  });
}

test("test_both_open_folds_every_other_chain", () => {
  assert.deepEqual(bothRows(CHAINS, "sdm").others, ["pcm"]);
});

// ── overrunOf / overruns ─────────────────────────────────────────────────

test("test_the_overrun_is_the_lowest_child_past_the_bottom_plus_padding", () => {
  assert.equal(overrunOf(PAGE), 32);
});

test("test_the_overrun_is_in_layout_px_on_a_scaled_plate", () => {
  assert.equal(overrunOf({ ...PAGE, scale: 0.5 }), 52);
});

test("test_half_a_pixel_is_no_overrun", () => {
  assert.equal(overruns(0.5), false);
});

test("test_more_than_half_a_pixel_overruns", () => {
  assert.equal(overruns(0.6), true);
});

// ── fitStep ──────────────────────────────────────────────────────────────

test("test_the_copy_with_the_most_spare_height_gives_it_back", () => {
  assert.deepEqual(fitStep(COPIES, 30), { index: 1, height: 170 });
});

test("test_a_copy_gives_back_no_more_than_its_spare_height", () => {
  assert.deepEqual(fitStep(COPIES, 500), { index: 1, height: 90 });
});

test("test_the_first_of_two_equally_spare_copies_gives_it_back", () => {
  assert.equal(fitStep(TIED, 10)?.index, 0);
});

test("test_no_copy_gives_back_when_none_has_spare_height", () => {
  assert.equal(fitStep(FLUSH, 10), null);
});
