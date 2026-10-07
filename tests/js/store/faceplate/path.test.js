// Behavioral suite for hqptuner/static/store/faceplate/path.js: the path the playing source takes through the engine,
// read off what the engine reports and what the daemon is running, never off a staged edit.
//
// The wire is the seam: each case writes /api/state into `engineState`, the Status frame and its metadata child into
// `engineStatus`, the daemon's /config form fields into `config`, and the backend's readiness into `health`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/path.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  config,
  engineState,
  engineStatus,
  health,
  staged,
  liveOverride,
} from "../../../../hqptuner/static/store/signals.js";
import { playbackPath, runningChain, transportNow } from "../../../../hqptuner/static/store/faceplate/path.js";

const CD = "44100";
const DSD64 = "2822400";
const DSD256 = "11289600";
const PCM_8X = "352800";

/**
 * @typedef {object} Playing
 * @property {string} [state]      /api/state `state`: "2" is playing
 * @property {string} [source]     the source's sample rate, Hz
 * @property {string} [output]     the output's rate, Hz
 * @property {boolean} [direct]    Direct SDM as the daemon runs it
 * @property {string} [chain]      the chain the engine has loaded
 * @property {Record<string, unknown>} [edited]  a dragged or staged override, by setting key
 */

/**
 * Write one running state onto the wire-side signals.
 *
 * @param {Playing} p
 */
function play({ state = "2", source = CD, output = PCM_8X, direct = false, chain = "", edited = {} }) {
  engineState.value = { state, active_chain: chain };
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: source } };
  config.value = { fields: [{ name: "direct_sdm", value: direct }] };
  staged.value = { live: {}, http: {} };
  liveOverride.value = edited;
}

/** @type {[string, Playing, string][]} */
const PATHS = [
  ["a_stopped_engine", { state: "0" }, "idle"],
  ["a_pcm_source_to_a_pcm_rate", { source: CD, output: PCM_8X }, "pcm-pcm"],
  ["a_pcm_source_to_a_dsd_rate", { source: CD, output: DSD256 }, "pcm-sdm"],
  ["a_dsd_source_to_a_pcm_rate", { source: DSD64, output: PCM_8X }, "dsd-pcm"],
  ["a_dsd_source_to_a_dsd_rate_processed", { source: DSD64, output: DSD256 }, "sdm-sdm"],
  ["a_dsd_source_to_a_dsd_rate_with_direct_sdm_running", { source: DSD64, output: DSD256, direct: true }, "direct"],
  ["a_pcm_source_with_direct_sdm_running", { source: CD, output: DSD256, direct: true }, "pcm-sdm"],
  [
    "a_dsd_source_with_direct_sdm_edited_but_not_applied",
    { source: DSD64, output: DSD256, edited: { direct_sdm: true } },
    "sdm-sdm",
  ],
];

for (const [name, playing, path] of PATHS) {
  test(`test_${name}_takes_its_path`, () => {
    play(playing);
    assert.equal(playbackPath(), path);
  });
}

/** @type {[string, Playing, string][]} */
const CHAINS = [
  ["a_source_playing_to_a_dsd_rate", { output: DSD256, chain: "pcm" }, "sdm"],
  ["a_source_playing_to_a_pcm_rate", { output: PCM_8X, chain: "sdm" }, "pcm"],
  ["a_stopped_engine_with_the_sdm_chain_loaded", { state: "0", chain: "sdm" }, "sdm"],
  ["a_stopped_engine_with_the_pcm_chain_loaded", { state: "0", chain: "pcm" }, "pcm"],
];

for (const [name, playing, chain] of CHAINS) {
  test(`test_${name}_runs_that_chain`, () => {
    play(playing);
    assert.equal(runningChain(), chain);
  });
}

/** @type {[string, boolean, string, string][]} */
const TRANSPORTS = [
  ["an_unready_daemon_reporting_playing", false, "2", "off"],
  ["a_stopped_engine", true, "0", "off"],
  ["a_paused_engine", true, "1", "paused"],
  ["a_playing_engine", true, "2", "playing"],
  ["an_engine_stopping", true, "3", "off"],
];

for (const [name, isReady, state, now] of TRANSPORTS) {
  test(`test_${name}_reads_${now}`, () => {
    play({ state });
    health.value = { ready: isReady };
    assert.equal(transportNow(), now);
  });
}
