// Behavioral suite for hqptuner/static/store/faceplate/drawers/pipelines.js, the DSP pipelines drawer's store half:
// the routing grid and the output tabs a pipeline set reads as, the crossfeed block it holds locked, the matrix bypass
// that grays it, and the edits it stages (a pipeline added or removed, a gain, a chain, a raw process string, an EQ
// imported onto the stereo pair).
//
// The store is driven at the wire: a staging fake answers the real REST paths (tests/js/support/wire/wire.js), the
// pipeline set reaches the store as the config file's canonical JSON, and every assertion reads the buffer the server
// ended up with or the view the store returns. The crossfeed block fixture is compiled by the vendored compiler, the
// same rows the Crossfeed drawer stages.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-pipelines.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, engineState, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { compileRows } from "../../../../hqptuner/static/vendor/eqlab/core/binaural/compile.js";
import {
  addPipeline,
  importEq,
  pipelinesView,
  removePipeline,
  setGain,
  setRaw,
  setStages,
} from "../../../../hqptuner/static/store/faceplate/drawers/pipelines.js";
import { quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} Row */

/** Two pipelines, In 1 to Out 1 and In 2 to Out 2, written with figures a serializer would not write. @type {Row[]} */
const STEREO = [
  {
    gain: "-3.50",
    gainunit: "dB",
    mixdown: "0",
    process: "iir:type=peak;f=1000.0;q=0.70;g=-3,delay:t=0.0010",
    source: "0",
  },
  { gain: "-3.50", gainunit: "dB", mixdown: "1", process: "iir:type=peak;f=1000.0;q=0.70;g=-3", source: "1" },
];

const EQ_TEXT = "Preamp: -6.4 dB\nFilter 1: ON PK Fc 100 Hz Gain -3.0 dB Q 1.41\n";

/** @type {ReturnType<typeof stagingWire>} */
let wire;

/**
 * Load a pipeline set as the config file's, with the engine's output channel count and the matrix engine's switch.
 *
 * @param {Row[]} rows
 * @param {{ channels?: number, engaged?: boolean }} [opts]
 */
function load(rows, { channels = 2, engaged = true } = {}) {
  config.value = {
    fields: [{ name: "channels", type: "number", value: channels }],
    file: { matrix_pipelines: JSON.stringify(rows) },
    active: "",
  };
  matrixConfig.value = { fields: [{ name: "enabled", type: "checkbox", value: engaged }], rows: [] };
}

/** The pipeline set the server's buffer holds, or null when none is staged. @returns {Row[] | null} */
function stagedRows() {
  const json = wire.staged.http.matrix_pipelines;
  return typeof json === "string" ? JSON.parse(json) : null;
}

beforeEach(async () => {
  wire = stagingWire();
  engineState.value = {};
  load(STEREO);
  await discardAll();
});

/** A row from one input to one output with no processing. @param {number} src @param {number} mix @returns {Row} */
const plain = (src, mix) => ({ gain: "0", gainunit: "dB", mixdown: String(mix), process: "", source: String(src) });

const STRUCTURAL = /** @type {Row[]} */ (
  compileRows({ lambda: 1, angle: 30, headRadius: 0.0875, srcA: 0, srcB: 1, preampDb: 0, eqProcess: "" })
);

test("test_the_grid_lights_the_crosspoints_the_set_routes", () => {
  const lit = pipelinesView().grid.map((row) => row.map((pin) => pin.on));
  assert.deepEqual(lit, [
    [true, false],
    [false, true],
  ]);
});

test("test_the_output_tabs_are_the_outputs_the_set_feeds", () => {
  load([plain(0, 0), plain(1, 3), plain(0, 3)]);
  assert.deepEqual(
    pipelinesView().outputs.map((t) => t.id),
    ["out0", "out3"],
  );
});

test("test_the_grid_spans_the_highest_channel_the_set_names", () => {
  load([plain(0, 0), plain(4, 1)]);
  const v = pipelinesView();
  assert.deepEqual([v.nIn, v.nOut], [5, 2]);
});

test("test_the_grid_spans_the_engines_output_channels", () => {
  load(STEREO, { channels: 6 });
  assert.equal(pipelinesView().nOut, 6);
});

test("test_output_tab_names_shorten_when_every_output_is_in_use", () => {
  const first = () => pipelinesView().outputs[0]?.label.length ?? 0;
  const two = first();
  load(
    [0, 1, 2, 3, 4, 5, 6, 7].map((c) => plain(c, c)),
    { channels: 8 },
  );
  assert.equal(two > first(), true);
});

test("test_a_crossfeed_block_marks_its_crosspoints", () => {
  const plainGen = pipelinesView().grid[0]?.[0]?.gen;
  load(STRUCTURAL);
  assert.deepEqual([plainGen, pipelinesView().grid[0]?.[0]?.gen], [undefined, "structural"]);
});

test("test_a_crossfeed_blocks_rows_hold_every_stage_locked", () => {
  load(STRUCTURAL);
  const flags = new Set(pipelinesView().pipes.flatMap((p) => p.stages.map((st) => st.blk === true)));
  assert.deepEqual([...flags], [true]);
});

test("test_a_bypassed_matrix_engine_grays_the_set", () => {
  const engaged = pipelinesView().gray;
  load(STEREO, { engaged: false });
  assert.deepEqual([engaged === "", pipelinesView().gray === ""], [true, false]);
});

test("test_adding_a_pipeline_stages_a_row_from_its_input_to_its_output", async () => {
  addPipeline(1, 0);
  await quiesce(wire);
  assert.deepEqual(stagedRows()?.at(-1), plain(1, 0));
});

test("test_adding_a_pipeline_returns_its_place_in_the_set", () => {
  assert.equal(addPipeline(1, 0), 2);
});

test("test_an_untouched_row_keeps_its_wire_text", async () => {
  await setGain(1, -2, "dB");
  await quiesce(wire);
  assert.equal(stagedRows()?.[0].process, STEREO[0].process);
});

test("test_a_gain_edit_stages_the_gain_in_its_unit", async () => {
  await setGain(1, 0.5, "Lin");
  await quiesce(wire);
  const row = stagedRows()?.[1];
  assert.deepEqual([row?.gain, row?.gainunit], ["0.5", "Lin"]);
});

test("test_a_chain_edit_rebuilds_only_the_stage_it_changed", async () => {
  const [eq] = pipelinesView().pipes[0]?.stages ?? [];
  await setStages(0, [eq, { kind: "delay", t: 0.002 }]);
  await quiesce(wire);
  assert.equal(stagedRows()?.[0].process, "iir:type=peak;f=1000.0;q=0.70;g=-3,delay:t=0.002");
});

test("test_removing_a_pipeline_drops_its_row", async () => {
  await removePipeline(0);
  await quiesce(wire);
  assert.deepEqual(
    stagedRows()?.map((r) => r.source),
    ["1"],
  );
});

test("test_a_raw_process_string_that_parses_stages_as_written", async () => {
  setRaw(1, "delay:t=0.01,iir:type=lp;f=120;q=0.707");
  await quiesce(wire);
  assert.equal(stagedRows()?.[1].process, "delay:t=0.01,iir:type=lp;f=120;q=0.707");
});

test("test_a_raw_process_string_that_does_not_parse_is_refused_unstaged", async () => {
  const refused = setRaw(1, "iir:type=bogus;f=100") !== "";
  await quiesce(wire);
  assert.deepEqual([refused, stagedRows()], [true, null]);
});

test("test_an_imported_eq_lands_on_the_stereo_pair_with_its_preamp", async () => {
  await importEq(EQ_TEXT, true);
  await quiesce(wire);
  assert.deepEqual(
    stagedRows()?.map((r) => r.gain),
    ["-6.4", "-6.4"],
  );
});

test("test_an_unmirrored_eq_leaves_the_other_side_as_it_was", async () => {
  await importEq(EQ_TEXT, false);
  await quiesce(wire);
  assert.deepEqual(stagedRows()?.[1], STEREO[1]);
});
