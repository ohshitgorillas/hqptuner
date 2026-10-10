// Behavioral suite for the chain rail's Crossfeed and DSP pipelines lamps as decided from the running pipelines:
// railStages over railNow in hqptuner/static/store/faceplate/chain.js. Crossfeed is on when either kind is engaged, the
// Bauer switch or a structural block installed in the running pipelines, and the running picture names which kind runs,
// or none. The DSP pipelines lamp is lit only while the
// running pipelines do work: a set where every pipeline copies a channel to that same channel at unity gain with an
// empty process chain does none.
//
// The wire is the seam: the /matrix form into `matrixConfig`, its rows the running pipelines in the form's own shape
// (source, mixdown, gain, gainunit dB or Lin, process). The structural block is built with the real compiler, so it is
// the serialization the install writes, not a fixture.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/rail-pipelines.test.js

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
import { railNow, railStages } from "../../../../hqptuner/static/store/faceplate/chain.js";
import { compileRows } from "../../../../hqptuner/static/vendor/eqlab/core/binaural/compile.js";

/** @typedef {import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */

const EQ = "iir:type=peak;f=1000;q=1;g=-3";
const UNITY_DB = "0";
const UNITY_LIN = "1";
const STEREO = 2;
const SURROUND = 6;

/**
 * One pipeline row as the /matrix form reports it.
 *
 * @param {number} source
 * @param {number} mixdown
 * @param {{ gain?: string, gainunit?: string, process?: string }} [o]
 * @returns {PipelineRow}
 */
const row = (source, mixdown, { gain = UNITY_DB, gainunit = "dB", process = "" } = {}) => ({
  source: String(source),
  mixdown: String(mixdown),
  gain,
  gainunit,
  process,
});

/**
 * A passthrough set: every channel copied to itself at unity gain with nothing in its process chain.
 *
 * @param {number} channels
 * @param {{ gain?: string, gainunit?: string }} [unity]
 * @returns {PipelineRow[]}
 */
const passthrough = (channels, unity = {}) => Array.from({ length: channels }, (_, i) => row(i, i, unity));

/** A structural crossfeed block over channels 1 and 2, as the install compiles it. */
const structuralBlock = () =>
  compileRows({ lambda: 1, angle: 30, headRadius: 0.09, srcA: 0, srcB: 1, preampDb: -3, eqProcess: EQ });

/**
 * Write one running engine onto the wire-side signals, the matrix engine on.
 *
 * @param {{ rows?: PipelineRow[], bauer?: boolean }} [o]
 */
function wire({ rows = passthrough(STEREO), bauer = false } = {}) {
  engineState.value = { state: "2", active_chain: "pcm", filter_junk: "0", filter1x: "0", filterNx: "0", shaper: "0" };
  enums.value = { junk_filters: [], filters: [], shapers: [] };
  engineStatus.value = { status: { active_rate: "352800" }, metadata: { samplerate: "44100", bits: "16" } };
  config.value = { fields: [{ name: "direct_sdm", value: false }] };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: true },
      { name: "post_bauer_enabled", value: bauer },
      { name: "post_correction_enabled", value: false },
    ],
    live_active: "Desk nearfield",
    rows,
  };
  staged.value = { live: {}, http: {} };
  liveOverride.value = {};
  speakers.value = { enabled: false, channels: [] };
  hiddenStages.value = [];
  volume.value = "-20";
  volumeDrag.value = null;
  volumeRange.value = null;
}

/**
 * Whether one stage of the rail decided from the running picture is lit, `null` when the rail has no such stage.
 *
 * @param {string} id
 * @returns {boolean | null}
 */
const lit = (id) => railStages(railNow()).find((s) => s.id === id)?.on ?? null;

/**
 * The DSP pipelines lamp over a set of running pipelines.
 *
 * @param {PipelineRow[]} rows
 * @returns {boolean | null}
 */
function pipelinesLit(rows) {
  wire({ rows });
  return lit("pipelines");
}

/**
 * The Crossfeed lamp over a set of running pipelines, the Bauer switch off.
 *
 * @param {PipelineRow[]} rows
 * @returns {boolean | null}
 */
function crossfeedLit(rows) {
  wire({ rows, bauer: false });
  return lit("crossfeed");
}

beforeEach(() => wire());

// --- crossfeed: either kind engages it ---------------------------------------

test("test_a_running_structural_crossfeed_block_lights_crossfeed_with_the_bauer_switch_off", () => {
  assert.equal(crossfeedLit(structuralBlock()), true);
});

test("test_a_structural_block_lights_crossfeed_where_a_plain_cross_routed_set_does_not", () => {
  const block = crossfeedLit(structuralBlock());
  const crossRouted = crossfeedLit([row(0, 0), row(1, 1), row(0, 1, { gain: "-6" }), row(1, 0, { gain: "-6" })]);
  assert.notEqual(block, crossRouted);
});

// --- crossfeed: the running picture names the kind that runs -----------------

test("test_a_running_structural_block_with_the_bauer_switch_off_reads_as_the_structural_crossfeed", () => {
  wire({ rows: structuralBlock(), bauer: false });
  assert.equal(railNow().crossfeed, "structural");
});

test("test_the_bauer_switch_on_over_passthrough_pipelines_reads_as_the_bauer_crossfeed", () => {
  wire({ rows: passthrough(STEREO), bauer: true });
  assert.equal(railNow().crossfeed, "bauer");
});

test("test_the_bauer_switch_off_over_passthrough_pipelines_reads_as_no_crossfeed", () => {
  wire({ rows: passthrough(STEREO), bauer: false });
  assert.equal(railNow().crossfeed, null);
});

// --- dsp pipelines: a passthrough set does no work ---------------------------

/** @type {[string, PipelineRow[]][]} */
const PASSTHROUGH = [
  ["a_stereo_passthrough_at_unity_db", passthrough(STEREO, { gain: UNITY_DB, gainunit: "dB" })],
  ["a_stereo_passthrough_at_unity_linear_gain", passthrough(STEREO, { gain: UNITY_LIN, gainunit: "Lin" })],
  ["a_six_channel_passthrough", passthrough(SURROUND)],
];

for (const [name, rows] of PASSTHROUGH) {
  test(`test_${name}_leaves_dsp_pipelines_unlit_under_a_running_matrix_engine`, () => {
    assert.equal(pipelinesLit(rows), false);
  });
}

// --- dsp pipelines: one pipeline doing work lights the lamp ------------------

/** @type {[string, PipelineRow][]} */
const WORK = [
  ["routing_to_another_channel", row(0, 1)],
  ["a_db_gain_off_unity", row(1, 1, { gain: "1", gainunit: "dB" })],
  ["a_linear_gain_off_unity", row(1, 1, { gain: "0.5", gainunit: "Lin" })],
  ["a_process_chain", row(1, 1, { process: EQ })],
];

for (const [name, changed] of WORK) {
  test(`test_one_pipeline_with_${name}_lights_dsp_pipelines_where_passthrough_leaves_them_unlit`, () => {
    const plain = pipelinesLit(passthrough(STEREO));
    assert.notEqual(pipelinesLit([row(0, 0), changed]), plain);
  });
}
