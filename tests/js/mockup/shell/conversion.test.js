// Behavioral suite for mockup/scripts/model/conversion.js: which field of which chain runs on a playback path, what the
// page opens on, which rows a section shows (one field open, or both filters open), the rail value per stage, and the
// fit arithmetic (overrun from measured bottoms, which copy gives height back and how much).
//
// Plays, picks and measured sizes are tables the test writes; no shipped data supplies an input or an expected value.
//
// Run: node --test tests/js/mockup/conversion.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  bothRows,
  fieldRuns,
  fitStep,
  openOn,
  overrunOf,
  overruns,
  railValues,
  sectionRows,
} from "../../../../mockup/scripts/model/shell/conversion.js";

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

//: One pick per control id, each distinct.
const VALS = {
  pcm1x: "f-p1",
  pcmnx: "f-pn",
  pcmsh: "d-p",
  sdm1x: "f-s1",
  sdmnx: "f-sn",
  sdmsh: "m-s",
  noise: "nz",
  decim: "dc",
  integ: "ig",
  sdmconv: "cv",
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

test("test_resampling_shows_the_open_field_open_and_its_sibling_folded", () => {
  assert.deepEqual(sectionRows(["pcm"], { chain: "pcm", field: "nx" }, ["1x", "nx"]), [
    { kind: "line", ch: "pcm", k: "1x" },
    { kind: "field", ch: "pcm", k: "nx" },
  ]);
});

test("test_a_closed_chain_folds_to_one_row_on_its_first_field", () => {
  assert.deepEqual(sectionRows(CHAINS, { chain: "pcm", field: "1x" }, ["1x", "nx"])[2], {
    kind: "chain",
    ch: "sdm",
    k: "1x",
  });
});

test("test_shaping_folds_the_other_chain_on_its_shaper", () => {
  assert.deepEqual(sectionRows(CHAINS, { chain: "sdm", field: "sh" }, ["sh"]), [
    { kind: "chain", ch: "pcm", k: "sh" },
    { kind: "field", ch: "sdm", k: "sh" },
  ]);
});

// ── bothRows ─────────────────────────────────────────────────────────────

test("test_both_open_shows_both_filters_of_the_open_chain", () => {
  assert.deepEqual(bothRows(CHAINS, "sdm").fields, [
    { ch: "sdm", k: "1x" },
    { ch: "sdm", k: "nx" },
  ]);
});

test("test_both_open_folds_every_other_chain", () => {
  assert.deepEqual(bothRows(CHAINS, "sdm").others, ["pcm"]);
});

// ── railValues ───────────────────────────────────────────────────────────

test("test_the_dsd_stage_is_in_the_path_on_dsd_to_pcm", () => {
  assert.equal(railValues(PLAY.dsdToPcm, false, VALS).dsdInPath, true);
});

test("test_the_dsd_stage_is_in_the_path_on_remodulation", () => {
  assert.equal(railValues(PLAY.remod, false, VALS).dsdInPath, true);
});

test("test_the_dsd_stage_is_out_of_the_path_on_a_pcm_source", () => {
  assert.equal(railValues(PLAY.pcm1x, false, VALS).dsdInPath, false);
});

test("test_the_dsd_stage_names_the_noise_filter_into_pcm", () => {
  assert.ok(railValues(PLAY.dsdToPcm, false, VALS).dsd.includes(VALS.noise));
});

test("test_the_dsd_stage_names_the_decimation_into_pcm", () => {
  assert.ok(railValues(PLAY.dsdToPcm, false, VALS).dsd.includes(VALS.decim));
});

test("test_the_dsd_stage_names_the_integrator_into_sdm", () => {
  assert.equal(railValues(PLAY.remod, false, VALS).dsd, VALS.integ);
});

test("test_the_dsd_stage_names_no_integrator_on_direct", () => {
  assert.notEqual(railValues(PLAY.direct, true, VALS).dsd, VALS.integ);
});

test("test_direct_takes_resampling_and_shaping_off_the_rail", () => {
  assert.equal(railValues(PLAY.direct, true, VALS).offChain, true);
});

test("test_remodulation_keeps_resampling_and_shaping_on_the_rail", () => {
  assert.equal(railValues(PLAY.remod, false, VALS).offChain, false);
});

test("test_remodulation_puts_rate_conversion_in_the_resampling_slot", () => {
  assert.equal(railValues(PLAY.remod, false, VALS).rateConversion, true);
});

test("test_a_pcm_source_keeps_resampling_in_its_slot", () => {
  assert.equal(railValues(PLAY.pcm1x, false, VALS).rateConversion, false);
});

test("test_remodulation_names_the_sdm_conversion_in_the_resampling_slot", () => {
  assert.equal(railValues(PLAY.remod, false, VALS).resampling, VALS.sdmconv);
});

test("test_dsd_to_pcm_names_the_nx_filter_in_the_resampling_slot", () => {
  assert.equal(railValues(PLAY.dsdToPcm, false, VALS).resampling, VALS.pcmnx);
});

test("test_a_1x_source_names_the_1x_filter_in_the_resampling_slot", () => {
  assert.equal(railValues(PLAY.pcm1x, false, VALS).resampling, VALS.pcm1x);
});

test("test_an_nx_source_names_the_nx_filter_in_the_resampling_slot", () => {
  assert.equal(railValues(PLAY.pcmNx, false, VALS).resampling, VALS.pcmnx);
});

test("test_nothing_playing_names_the_1x_filter_in_the_resampling_slot", () => {
  assert.equal(railValues(PLAY.idlePcm, false, VALS).resampling, VALS.pcm1x);
});

test("test_the_shaping_slot_names_the_running_chains_shaper", () => {
  assert.equal(railValues(PLAY.pcmToSdm, false, VALS).shaping, VALS.sdmsh);
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
