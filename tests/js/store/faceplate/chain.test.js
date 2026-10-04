// Behavioral suite for railStages in hqptuner/static/store/faceplate/chain.js: the chain rail's stages decided from a
// plain running picture, one value per stage, its lamp, whether it is hidden and whether this track's path bypasses it.
//
// Every engine name below is the fixture's own, so it may be asserted back verbatim; the stage names and the words the
// rail writes beside a value are copy and are compared only against each other.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/chain.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { railStages } from "../../../../hqptuner/static/store/faceplate/chain.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/chain.js").Running} Running */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/chain.js").RailStage} RailStage */

const CONV = {
  filter1x: "poly-sinc-gauss-long",
  filterNx: "sinc-Mx",
  shaper: "NS9",
  noise: "standard-fir",
  decim: "poly-sinc-short-mp",
  integ: "IIR2",
  sdmconv: "XFi",
};

/**
 * A running picture: a CD source playing to a PCM rate with the matrix engine on and nothing else engaged.
 *
 * @param {Partial<Running>} [over]
 * @returns {Running}
 */
function running(over = {}) {
  return {
    path: "pcm-pcm",
    chain: "pcm",
    stage: "1x",
    direct: false,
    metadata: { samplerate: "44100", bits: "16" },
    status: { active_rate: "352800", active_bits: "32" },
    hf: "none",
    conv: CONV,
    matrix: true,
    profile: "Desk nearfield",
    pipelines: 2,
    crossfeed: false,
    loudness: false,
    applied: 0,
    correction: false,
    model: "",
    volume: "-20",
    speakers: false,
    hidden: [],
    ...over,
  };
}

const NOTHING = /** @type {RailStage} */ (
  /** @type {unknown} */ ({ id: null, level: null, name: null, value: null, on: null, hidden: null, byp: null })
);

/**
 * One stage of a decided rail, or a stage whose every field fails a comparison when the rail has none by that id.
 *
 * @param {Partial<Running>} over
 * @param {string} id
 * @returns {RailStage}
 */
const stage = (over, id) => railStages(running(over)).find((s) => s.id === id) || NOTHING;

/**
 * The ids of a decided rail's stages that satisfy a test.
 *
 * @param {Partial<Running>} over
 * @param {(s: RailStage) => boolean} pick
 * @returns {string[]}
 */
const idsWhere = (over, pick) =>
  railStages(running(over))
    .filter(pick)
    .map((s) => s.id);

test("test_an_idle_source_prints_nothing_of_the_metadata_the_engine_left_behind", () => {
  assert.doesNotMatch(stage({ path: "idle", metadata: { samplerate: "96000", bits: "24" } }, "source").value, /96|24/);
});

test("test_a_playing_source_reads_its_rate", () => {
  const a = stage({ metadata: { samplerate: "44100", bits: "16" } }, "source").value;
  const b = stage({ metadata: { samplerate: "96000", bits: "16" } }, "source").value;
  assert.notEqual(a, b);
});

test("test_a_playing_source_reads_differently_from_an_idle_one", () => {
  assert.notEqual(stage({}, "source").value, stage({ path: "idle" }, "source").value);
});

test("test_a_running_hf_filter_shows_its_engine_name", () => {
  assert.equal(stage({ hf: "20k" }, "hf").value, "20k");
});

test("test_a_running_hf_filter_lights_its_lamp", () => {
  assert.equal(stage({ hf: "20k" }, "hf").on, true);
});

test("test_the_hf_filter_at_none_is_unlit", () => {
  assert.equal(stage({ hf: "none" }, "hf").on, false);
});

test("test_the_hf_filter_at_none_does_not_print_the_engine_name", () => {
  assert.doesNotMatch(stage({ hf: "none" }, "hf").value, /^none$/);
});

test("test_dsd_processing_on_the_pcm_chain_names_the_noise_filter", () => {
  assert.match(stage({ path: "dsd-pcm" }, "dsd").value, new RegExp(CONV.noise));
});

test("test_dsd_processing_on_the_pcm_chain_names_the_decimation_filter", () => {
  assert.match(stage({ path: "dsd-pcm" }, "dsd").value, new RegExp(CONV.decim));
});

test("test_dsd_processing_on_the_sdm_chain_names_the_integrator", () => {
  assert.equal(stage({ path: "sdm-sdm", chain: "sdm" }, "dsd").value, CONV.integ);
});

test("test_dsd_processing_under_a_running_direct_sdm_does_not_name_the_integrator", () => {
  assert.doesNotMatch(stage({ path: "direct", chain: "sdm", direct: true }, "dsd").value, new RegExp(CONV.integ));
});

/** @type {[Running["path"], boolean][]} */
const DSD_BYPASS = [
  ["pcm-pcm", true],
  ["pcm-sdm", true],
  ["dsd-pcm", false],
  ["sdm-sdm", false],
  ["idle", true],
];

for (const [path, byp] of DSD_BYPASS) {
  test(`test_dsd_processing_on_a_${path}_path_is_bypassed_${byp}`, () => {
    assert.equal(stage({ path }, "dsd").byp, byp);
  });
}

/** @type {[string, Partial<Running>, string][]} */
const RESAMPLING = [
  ["a_base_rate_pcm_source_runs_the_1x_filter", { stage: "1x" }, CONV.filter1x],
  ["a_high_rate_pcm_source_runs_the_nx_filter", { stage: "nx" }, CONV.filterNx],
  ["a_base_rate_dsd_source_to_pcm_runs_the_nx_filter", { path: "dsd-pcm", stage: "1x" }, CONV.filterNx],
  ["a_remodulated_dsd_source_runs_the_sdm_conversion", { path: "sdm-sdm", chain: "sdm" }, CONV.sdmconv],
  ["a_stopped_engine_names_the_1x_filter", { path: "idle", stage: "nx" }, CONV.filter1x],
];

for (const [name, over, value] of RESAMPLING) {
  test(`test_resampling_${name}`, () => {
    assert.equal(stage(over, "resampling").value, value);
  });
}

test("test_resampling_is_renamed_on_a_remodulated_dsd_source", () => {
  assert.notEqual(stage({ path: "sdm-sdm", chain: "sdm" }, "resampling").name, stage({}, "resampling").name);
});

test("test_shaping_names_the_running_shaper", () => {
  assert.equal(stage({ path: "pcm-sdm", chain: "sdm" }, "shaping").value, CONV.shaper);
});

test("test_direct_sdm_hides_resampling_and_shaping", () => {
  assert.deepEqual(
    idsWhere({ path: "direct", chain: "sdm", direct: true }, (s) => s.hidden),
    ["resampling", "shaping"],
  );
});

test("test_a_processed_path_hides_only_what_the_preferences_hide", () => {
  assert.deepEqual(
    idsWhere({ path: "sdm-sdm", chain: "sdm", hidden: ["loudness"] }, (s) => s.hidden),
    ["loudness"],
  );
});

test("test_direct_sdm_bypasses_every_processing_stage_and_leaves_the_stream_and_speakers", () => {
  assert.deepEqual(
    idsWhere({ path: "direct", chain: "sdm", direct: true }, (s) => !s.byp),
    ["source", "speakers", "output"],
  );
});

test("test_a_pcm_path_bypasses_only_dsd_processing", () => {
  assert.deepEqual(
    idsWhere({}, (s) => s.byp),
    ["dsd"],
  );
});

test("test_the_matrix_engine_names_the_running_profile", () => {
  assert.equal(stage({ profile: "Desk nearfield" }, "matrix").value, "Desk nearfield");
});

test("test_a_bypassed_matrix_engine_is_unlit", () => {
  assert.equal(stage({ matrix: false }, "matrix").on, false);
});

test("test_a_running_matrix_engine_is_lit", () => {
  assert.equal(stage({ matrix: true }, "matrix").on, true);
});

test("test_dsp_pipelines_count_the_running_pipelines", () => {
  assert.match(stage({ pipelines: 7 }, "pipelines").value, /\b7\b/);
});

const ENGAGED = { crossfeed: true, loudness: true, correction: true, model: "D90", speakers: true };

for (const id of ["pipelines", "crossfeed", "loudness", "correction"]) {
  test(`test_${id}_engaged_under_a_running_matrix_engine_is_lit`, () => {
    assert.equal(stage({ ...ENGAGED, matrix: true }, id).on, true);
  });

  test(`test_${id}_engaged_under_a_bypassed_matrix_engine_is_unlit`, () => {
    assert.equal(stage({ ...ENGAGED, matrix: false }, id).on, false);
  });
}

for (const [id, flag] of [
  ["crossfeed", "crossfeed"],
  ["loudness", "loudness"],
  ["correction", "correction"],
  ["speakers", "speakers"],
]) {
  test(`test_${id}_switched_off_is_unlit`, () => {
    assert.equal(stage({ ...ENGAGED, [flag]: false }, id).on, false);
  });
}

test("test_crossfeed_engaged_reads_differently_from_crossfeed_off", () => {
  assert.notEqual(stage({ crossfeed: true }, "crossfeed").value, stage({ crossfeed: false }, "crossfeed").value);
});

test("test_crossfeed_engaged_leaves_its_value_empty_for_want_of_a_running_mode", () => {
  assert.equal(stage({ crossfeed: true }, "crossfeed").value, "");
});

test("test_loudness_reads_the_percent_applied", () => {
  assert.match(stage({ loudness: true, applied: 37 }, "loudness").value, /\b37%/);
});

test("test_dac_correction_engaged_names_the_running_model", () => {
  assert.equal(stage({ correction: true, model: "D90" }, "correction").value, "D90");
});

test("test_dac_correction_off_does_not_name_the_model", () => {
  assert.doesNotMatch(stage({ correction: false, model: "D90" }, "correction").value, /D90/);
});

for (const text of ["-12.5 dB", "Pinned: -3.0 dB"]) {
  test(`test_volume_reads_the_running_rail_text_${text.replace(/\W+/g, "_")}`, () => {
    assert.equal(stage({ volume: text }, "volume").value, text);
  });
}

test("test_speakers_engaged_are_lit", () => {
  assert.equal(stage({ speakers: true }, "speakers").on, true);
});

test("test_speakers_engaged_read_differently_from_speakers_off", () => {
  assert.notEqual(stage({ speakers: true }, "speakers").value, stage({ speakers: false }, "speakers").value);
});

test("test_speakers_engaged_leave_their_value_empty_for_want_of_a_running_layout", () => {
  assert.equal(stage({ speakers: true }, "speakers").value, "");
});

test("test_the_output_reads_its_rate", () => {
  const a = stage({ status: { active_rate: "352800", active_bits: "32" } }, "output").value;
  const b = stage({ status: { active_rate: "22579200", active_bits: "1" } }, "output").value;
  assert.notEqual(a, b);
});

test("test_an_idle_output_prints_nothing_of_the_rate_the_engine_left_behind", () => {
  const idle = stage({ path: "idle", status: { active_rate: "352800", active_bits: "32" } }, "output").value;
  assert.doesNotMatch(idle, /352|32/);
});

test("test_a_stage_the_preferences_hide_is_hidden", () => {
  assert.deepEqual(
    idsWhere({ hidden: ["loudness", "speakers"] }, (s) => s.hidden),
    ["loudness", "speakers"],
  );
});
