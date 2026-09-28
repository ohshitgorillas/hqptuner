// Behavioral suite for the Pipelines card's row callbacks in
// components/matrix/Tab.js: adding a pipeline and removing it again leaves the
// staged pipeline list exactly where it started.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/matrix/matrixtab-add-remove.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../../../hqptuner/static/components/matrix/Tab.js";
import { FlowRow } from "../../../../hqptuner/static/components/matrix/FlowRow.js";
import { config, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { effectivePipelines } from "../../../../hqptuner/static/store/resolve.js";
import { showDescriptions } from "../../../../hqptuner/static/store/ui/prefs.js";
import { plottedRows } from "../../../../hqptuner/static/components/matrix/Plot.js";
import { selectedStage } from "../../../../hqptuner/static/components/matrix/BandStrip.js";
import { stagingWire, quiesce } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */

/** @param {Partial<PipelineRow>} patch */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

const FIXTURE = () => [ROW({}), ROW({ source: "1", mixdown: "1" })];

test("test_adding_then_removing_a_pipeline_leaves_the_two_fixture_pipelines", async () => {
  const w = stagingWire();
  showDescriptions.value = true;
  plottedRows.value = new Set();
  selectedStage.value = null;
  matrixConfig.value = { fields: [], rows: [], live_profiles: [], live_active: "[Default]", file_profiles: {} };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(FIXTURE()) } };
  await discardAll();
  const add = renderTree(html`<${MatrixTab} />`).seen.find((v) => v.props["data-testid"] === "matrix-add-row")?.props
    .onClick;
  if (typeof add !== "function") throw new Error("no add-row button rendered");
  add();
  await quiesce(w);
  const remove = renderTree(html`<${MatrixTab} />`).seen.find((v) => v.type === FlowRow && v.props.index === 2)?.props
    .remove;
  if (typeof remove !== "function") throw new Error("no FlowRow at index 2 rendered");
  remove();
  await quiesce(w);
  assert.deepEqual(effectivePipelines.value, FIXTURE());
});
