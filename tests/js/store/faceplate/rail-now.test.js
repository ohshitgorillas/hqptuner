// Behavioral suite for railNow in hqptuner/static/store/faceplate/chain.js: the running picture the chain rail is decided
// from, read off what the engine reports, the daemon's running forms and the browser's own preferences, never off a
// staged edit.
//
// The wire is the seam: /api/state into `engineState`, the enumerations into `enums`, the Status frame into
// `engineStatus`, the /config and /matrix forms into `config` and `matrixConfig`, the /speakers form into `speakers`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/rail-now.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  config,
  engineState,
  engineStatus,
  enums,
  liveOverride,
  matrixConfig,
  staged,
  volume,
  volumeDrag,
  volumeRange,
} from "../../../../hqptuner/static/store/signals.js";
import { speakers } from "../../../../hqptuner/static/store/matrix/speakers.js";
import { hiddenStages } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { railNow } from "../../../../hqptuner/static/store/faceplate/chain.js";

/**
 * One enumeration item as the daemon sends it: every attribute a string.
 *
 * @param {string} name
 * @param {number} i
 */
const item = (name, i) => ({ index: String(i), value: String(100 + i), name });

/**
 * A select field of a daemon form, its options valued apart from their labels.
 *
 * @param {string} name
 * @param {string} value
 * @param {string[]} labels
 */
const select = (name, value, labels) => ({
  name,
  type: "select",
  value,
  options: labels.map((label, i) => ({ value: `v${i}`, label })),
});

/**
 * Write one running engine onto the wire-side signals.
 *
 * @param {{ junk?: string, filterNx?: string, shaper?: string, direct?: boolean }} [o]
 */
function wire({ junk = "1", filterNx = "2", shaper = "1", direct = true } = {}) {
  engineState.value = { state: "2", active_chain: "pcm", filter_junk: junk, filter1x: "0", filterNx, shaper };
  enums.value = {
    junk_filters: ["none", "20k", "2x"].map(item),
    filters: ["poly-sinc-short", "poly-sinc-long", "sinc-Mx"].map(item),
    shapers: ["TPDF", "NS9", "LNS15"].map(item),
  };
  engineStatus.value = { status: { active_rate: "352800" }, metadata: { samplerate: "96000", bits: "24" } };
  config.value = {
    fields: [{ name: "direct_sdm", value: direct }, select("noise_filter", "v1", ["standard", "low", "high"])],
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: true },
      { name: "post_bauer_enabled", value: true },
      { name: "post_correction_enabled", value: true },
      select("post_correction_dac0", "v2", ["AK4499", "ES9038", "PCM1704"]),
    ],
    live_active: "Desk nearfield",
    rows: [{ source: "0" }, { source: "1" }, { source: "2" }],
  };
  staged.value = { live: {}, http: {} };
  liveOverride.value = {};
  speakers.value = { enabled: true, channels: [] };
  hiddenStages.value = ["crossfeed"];
  volume.value = "-12.5";
  volumeDrag.value = null;
  volumeRange.value = null;
}

beforeEach(() => wire());

test("test_the_hf_filter_is_the_junk_filter_named_at_the_index_the_engine_reports", () => {
  assert.equal(railNow().hf, "20k");
});

test("test_the_hf_filter_follows_the_index_the_engine_reports", () => {
  wire({ junk: "0" });
  assert.equal(railNow().hf, "none");
});

test("test_the_nx_filter_is_the_filter_named_at_the_index_the_engine_reports", () => {
  assert.equal(railNow().conv.filterNx, "sinc-Mx");
});

test("test_the_shaper_is_the_shaper_named_at_the_index_the_engine_reports", () => {
  wire({ shaper: "2" });
  assert.equal(railNow().conv.shaper, "LNS15");
});

test("test_the_noise_filter_is_the_running_option_by_its_label", () => {
  assert.equal(railNow().conv.noise, "low");
});

test("test_the_dac_model_is_the_running_option_by_its_label", () => {
  assert.equal(railNow().model, "PCM1704");
});

test("test_a_high_rate_source_plays_on_the_nx_side", () => {
  assert.equal(railNow().stage, "nx");
});

test("test_direct_sdm_reads_as_the_daemon_runs_it", () => {
  assert.equal(railNow().direct, true);
});

test("test_a_staged_matrix_bypass_leaves_the_running_engine_on", () => {
  staged.value = { live: {}, http: { matrix_enabled: false } };
  assert.equal(railNow().matrix, true);
});

test("test_a_staged_crossfeed_bypass_leaves_the_running_crossfeed_on", () => {
  staged.value = { live: {}, http: { post_bauer_enabled: false } };
  assert.equal(railNow().crossfeed, true);
});

test("test_the_profile_is_the_one_switched_live", () => {
  assert.equal(railNow().profile, "Desk nearfield");
});

test("test_the_pipelines_are_counted_off_the_running_profile", () => {
  assert.equal(railNow().pipelines, 3);
});

test("test_speakers_read_as_the_speakers_form_reports_them", () => {
  assert.equal(railNow().speakers, true);
});

test("test_the_hidden_stages_are_the_preferences_own", () => {
  assert.deepEqual(railNow().hidden, ["crossfeed"]);
});

test("test_a_dragged_volume_is_the_level_the_rail_shows", () => {
  wire({ direct: false });
  volumeDrag.value = -30;
  assert.match(railNow().volume, /30\.0/);
});

test("test_a_running_direct_sdm_holds_the_rail_volume_whatever_the_level", () => {
  const held = railNow().volume;
  volume.value = "-30";
  assert.equal(railNow().volume, held);
});

test("test_the_rail_volume_is_empty_before_the_engine_reports_a_level", () => {
  volume.value = null;
  assert.equal(railNow().volume, "");
});
