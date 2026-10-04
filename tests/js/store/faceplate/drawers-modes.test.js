// Behavioral suite for hqptuner/static/store/faceplate/drawers/modes.js, the mode drawers' store half: the output mode
// whose tab DSD Processing, Resampling and Shaping open on, and the line Shaping's PCM tab prints under the dither,
// naming the DAC bits the Output drawer holds for the backend in use.
//
// The wire is the seam: /api/state into `engineState`, the Status frame and its metadata child into `engineStatus`,
// the daemon's /config form into `config`, and the pending buffer through the staging fake. The dither line is copy, so
// a case asserts only the number the fixture put on the wire, or how two lines relate.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-modes.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, engineState, engineStatus, liveOverride } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { ditherNote, runningMode } from "../../../../hqptuner/static/store/faceplate/drawers/modes.js";
import { stagingWire } from "../../support/wire/wire.js";

const CD = "44100";
const DSD256 = "11289600";
const PCM_8X = "352800";

/**
 * Load the /config form with a backend and each backend group's DAC bits.
 *
 * @param {string} backend
 * @param {number} alsa
 * @param {number} net
 */
function load(backend, alsa, net) {
  config.value = {
    fields: [
      { name: "backend", value: backend },
      { name: "alsa_bits", type: "number", value: alsa },
      { name: "net_bits", type: "number", value: net },
    ],
    file: {},
  };
}

/**
 * Write a running state: a source at `source` Hz played out at `output` Hz, or nothing playing, over a loaded chain.
 *
 * @param {{ state?: string, source?: string, output?: string, chain?: string }} p
 */
function run({ state = "0", source = CD, output = PCM_8X, chain = "" }) {
  engineState.value = { state, active_chain: chain };
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: source } };
}

beforeEach(async () => {
  stagingWire();
  liveOverride.value = {};
  load("alsa", 0, 0);
  run({});
  await discardAll();
});

test("test_an_idle_engine_runs_the_mode_of_the_chain_it_has_loaded", () => {
  run({ chain: "sdm" });
  const sdm = runningMode();
  run({ chain: "pcm" });
  assert.deepEqual([sdm, runningMode()], ["sdm", "pcm"]);
});

test("test_a_playing_source_runs_the_mode_of_its_output_over_the_loaded_chain", () => {
  run({ state: "2", output: DSD256, chain: "pcm" });
  assert.equal(runningMode(), "sdm");
});

test("test_the_dither_line_names_the_dac_bits_of_the_alsa_backend", () => {
  load("alsa", 24, 20);
  const line = ditherNote();
  assert.deepEqual([line.includes("24"), line.includes("20")], [true, false]);
});

test("test_the_dither_line_names_the_dac_bits_of_the_network_backend", () => {
  load("network", 24, 20);
  const line = ditherNote();
  assert.deepEqual([line.includes("20"), line.includes("24")], [true, false]);
});

test("test_dac_bits_of_zero_read_as_the_auto_detect_line_a_combo_backend_also_reads", () => {
  load("alsa", 0, 0);
  const zero = ditherNote();
  load("combo", 24, 24);
  const combo = ditherNote();
  load("alsa", 24, 24);
  assert.deepEqual([zero === combo, zero === ditherNote()], [true, false]);
});

test("test_the_dither_line_names_staged_dac_bits", async () => {
  load("alsa", 24, 24);
  await edit("alsa_bits", "16");
  assert.equal(ditherNote().includes("16"), true);
});
