// Rendered suite for the Signal path drawer's block (components/faceplate/settings/SignalPath.js) over the v1 store: one
// node group per map node, the nodes the path playing lights, a matrix part reading bypassed under a stopped matrix
// engine, and the Direct SDM bypass lighting on the direct path.
//
// The wire is the seam: /api/state into `engineState`, the Status frame into `engineStatus`, the /config and /matrix
// forms into `config` and `matrixConfig`. Node groups are found by `data-id`, edges by the node ids they join (`data-a`,
// `data-b`), lamps by the `lit` and `off` classes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/signal-path.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import {
  SIGPATH_DRAWER,
  SignalPathBlock,
} from "../../../../hqptuner/static/components/faceplate/settings/SignalPath.js";
import { NODES } from "../../../../hqptuner/static/store/faceplate/settings/sigpath.js";
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
import { attr, classes, elements } from "../../support/markup.js";

const PCM_1X = { source: "44100", output: "352800" };
const DSD_TO_SDM = { source: "11289600", output: "22579200" };

/**
 * Write one playing engine onto the wire-side signals.
 *
 * @param {{ source?: string, output?: string, direct?: boolean, matrix?: boolean, rows?: object[] }} [o]
 */
function wire({ source = PCM_1X.source, output = PCM_1X.output, direct = false, matrix = true, rows = [] } = {}) {
  engineState.value = { state: "2", active_chain: "pcm" };
  enums.value = null;
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: source, bits: "24" } };
  config.value = { fields: [{ name: "direct_sdm", value: direct }] };
  matrixConfig.value = { fields: [{ name: "enabled", value: matrix }], live_active: "", rows };
  staged.value = { live: {}, http: {} };
  liveOverride.value = {};
  speakers.value = { enabled: true, channels: [] };
  hiddenStages.value = [];
  volume.value = null;
  volumeDrag.value = null;
  volumeRange.value = null;
}

beforeEach(() => wire());

const block = () =>
  elements(render(html`<${SignalPathBlock} schema=${SIGPATH_DRAWER} here=${{ drawer: "sigpath" }} />`));

/** Every node group the block draws. */
const nodeGroups = () => block().filter((e) => e.name === "g" && attr(e, "data-id") !== undefined);

/**
 * The ids of the node groups carrying `cls`, sorted.
 *
 * @param {string} cls
 */
const nodesWith = (cls) =>
  nodeGroups()
    .filter((e) => classes(e).includes(cls))
    .map((e) => String(attr(e, "data-id")))
    .sort();

/**
 * Whether the node group `id` carries `cls`, or null when it is not drawn.
 *
 * @param {string} id
 * @param {string} cls
 */
function nodeHas(id, cls) {
  const g = nodeGroups().find((e) => attr(e, "data-id") === id);
  return g ? classes(g).includes(cls) : null;
}

/** Whether the Direct SDM bypass, the edge from the DSD source to Speakers, reads lit, or null when it is not drawn. */
function bypassLit() {
  const edge = block().find((e) => e.name === "path" && attr(e, "data-a") === "ds" && attr(e, "data-b") === "sp");
  return edge ? classes(edge).includes("lit") : null;
}

test("test_the_map_draws_one_group_per_node", () => {
  assert.equal(nodeGroups().length, NODES.length);
});

test("test_a_1x_pcm_source_to_pcm_lights_its_path_nodes", () => {
  assert.deepEqual(nodesWith("lit"), ["dc", "di", "f1", "ld", "out", "p1", "pl", "sp", "vo", "xf"]);
});

/** Running pipelines that do work: the left channel carries an EQ, the right passes through. */
const WORKING = [
  { source: "0", mixdown: "0", gain: "0", gainunit: "dB", process: "iir:type=peak;f=1000;q=1;g=-3" },
  { source: "1", mixdown: "1", gain: "0", gainunit: "dB", process: "" },
];

test("test_a_matrix_part_on_the_path_reads_bypassed_only_under_a_stopped_matrix", () => {
  wire({ rows: WORKING });
  const engaged = nodeHas("pl", "off");
  wire({ matrix: false, rows: WORKING });
  assert.deepEqual([engaged, nodeHas("pl", "off")], [false, true]);
});

test("test_the_direct_sdm_bypass_lights_only_on_the_direct_path", () => {
  wire({ ...DSD_TO_SDM, direct: false });
  const remodulated = bypassLit();
  wire({ ...DSD_TO_SDM, direct: true });
  assert.deepEqual([remodulated, bypassLit()], [false, true]);
});
