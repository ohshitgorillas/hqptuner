// Behavioral suite for the chip-view `+ stage` callback of
// components/matrix/FlowRow.js: `addStage` appends one default peak stage after
// the row's existing chain and writes the whole chain back through
// `replaceStages`.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/matrix/flowrow-add-stage.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { FlowRow } from "../../../../hqptuner/static/components/matrix/FlowRow.js";
import { selectedStage } from "../../../../hqptuner/static/components/matrix/BandStrip.js";
import { parseProcess } from "../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js";
import { config, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, stagePipelines } from "../../../../hqptuner/static/store/actions.js";
import { effectivePipelines } from "../../../../hqptuner/static/store/resolve.js";
import { stagingWire, quiesce } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */

/** @type {PipelineRow} */
const ROW = { source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=1000;q=1;g=-3" };

test("test_add_stage_appends_a_default_peak_after_the_fixture_stage", async () => {
  const w = stagingWire();
  selectedStage.value = null;
  matrixConfig.value = { fields: [], rows: [], live_profiles: [], live_active: "[Default]", file_profiles: {} };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify([ROW]) } };
  await discardAll();
  const { seen } = renderTree(
    html`<${FlowRow}
      row=${ROW}
      index=${0}
      dirty=${false}
      summing=${false}
      canRemove=${true}
      eqLoaded=${false}
      update=${(/** @type {Partial<PipelineRow>} */ patch) => stagePipelines([{ ...ROW, ...patch }])}
      remove=${() => {}}
      importHere=${() => {}}
    />`,
  );
  const addStage = seen.find((v) => typeof v.props.addStage === "function")?.props.addStage;
  if (typeof addStage !== "function") throw new Error("no addStage callback rendered");
  addStage();
  await quiesce(w);
  selectedStage.value = null;
  const parsed = parseProcess(effectivePipelines.value[0].process);
  assert.deepEqual(
    [parsed.length, parsed[0]],
    [2, { kind: "iir", args: { type: "peak", f: "1000", q: "1", g: "-3" }, raw: "iir:type=peak;f=1000;q=1;g=-3" }],
  );
});
