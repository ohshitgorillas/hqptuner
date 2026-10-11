// Rendered suite for the Signal path drawer's block (components/faceplate/settings/SignalPath.js) over the store: one
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
import { hiddenStages } from "../../../../hqptuner/static/store/ui/prefs.js";
import { attr, classes, elements } from "../../support/markup.js";

const PCM_1X = { source: "44100", output: "352800" };

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
 * Whether the node group `id` carries `cls`, or null when it is not drawn.
 *
 * @param {string} id
 * @param {string} cls
 */
function nodeHas(id, cls) {
  const g = nodeGroups().find((e) => attr(e, "data-id") === id);
  return g ? classes(g).includes(cls) : null;
}

test("test_the_map_draws_one_group_per_node", () => {
  assert.equal(nodeGroups().length, NODES.length);
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
