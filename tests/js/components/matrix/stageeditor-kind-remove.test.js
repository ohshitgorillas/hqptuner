// Behavioral suite for the stage editor's kind switch and delete callbacks in
// components/matrix/StageEditor.js: switching the first stage to another kind
// and then deleting it leaves only the second stage staged.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/matrix/stageeditor-kind-remove.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { StageEditor, setSelected } from "../../../../hqptuner/static/components/matrix/StageEditor.js";
import { parseProcess, serializeProcess } from "../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js";
import { discardAll, stagePipelines } from "../../../../hqptuner/static/store/actions.js";
import { effectivePipelines } from "../../../../hqptuner/static/store/resolve.js";
import { stagingWire, quiesce } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").MatrixStage} MatrixStage */
/** @typedef {import("../../support/wheel.js").VNode} VNode */

const FIXTURE = "iir:type=peak;f=1000;q=1;g=0,delay:t=0.01";

const ROW = { source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: FIXTURE };

/** @returns {MatrixStage[]} */
const stagedStages = () => parseProcess(effectivePipelines.value[0].process);

/**
 * The handler named `name` on the first vnode `match` accepts, from a fresh
 * render of the editor docked on the first staged stage; a missing handler
 * throws rather than reading as a no-op.
 *
 * @param {(v: VNode) => boolean} match
 * @param {string} name
 * @returns {Function}
 */
function handlerOf(match, name) {
  const replaceStages = (/** @type {MatrixStage[]} */ next) =>
    stagePipelines([{ ...ROW, process: serializeProcess(next) }]);
  const tree = html`<${StageEditor} stages=${stagedStages()} stageIndex=${0} replaceStages=${replaceStages} />`;
  const handler = renderTree(tree).seen.find(match)?.props[name];
  if (typeof handler !== "function") throw new Error(`no ${name} handler rendered`);
  return handler;
}

/** @param {VNode} v */
const isKindPicker = (v) =>
  v.type === "select" &&
  [v.props.children].flat(2).some((o) => /** @type {VNode | null} */ (o)?.props?.value === "conv");

/** @param {VNode} v */
const isRemove = (v) => v.type === "button" && String(v.props.class).includes("mtx-remove");

test("test_switching_the_first_stage_kind_then_removing_it_leaves_the_second_fixture_stage", async () => {
  const w = stagingWire();
  setSelected(null);
  await discardAll();
  await stagePipelines([ROW]);
  await quiesce(w);
  handlerOf(isKindPicker, "onChange")({ target: { value: "delay" } });
  await quiesce(w);
  handlerOf(isRemove, "onClick")();
  await quiesce(w);
  assert.deepEqual(stagedStages(), [parseProcess(FIXTURE)[1]]);
});
