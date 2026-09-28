// Behavioral suite for the raw `{ }` chain view of components/matrix/FlowRow.js:
// text entered in the raw input reaches the row writer exactly as typed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrix/flowrow-raw.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { FlowRow } from "../../../../hqptuner/static/components/matrix/FlowRow.js";
import { selectedStage } from "../../../../hqptuner/static/components/matrix/BandStrip.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */
/** @typedef {(patch: Partial<PipelineRow>) => void} RowWriter */

/** @type {PipelineRow} */
const ROW = { source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=1000;q=1;g=-3" };

// Malformed stages, an empty part, an empty stage between commas, and padding
// at both ends.
const TYPED = "  iir:type=peak;f=abc;;q  , ,delay:t=  ";

/**
 * Renders one FlowRow for `ROW` writing through `update`, and returns the
 * `name` handler of the vnode whose `data-testid` is `id`, or undefined where
 * either is missing.
 *
 * @param {RowWriter} update
 * @param {string} id
 * @param {string} name
 * @returns {Function | undefined}
 */
function handlerOf(update, id, name) {
  const { seen } = renderTree(
    html`<${FlowRow}
      row=${ROW}
      index=${0}
      dirty=${false}
      summing=${false}
      canRemove=${true}
      eqLoaded=${false}
      update=${update}
      remove=${() => {}}
      importHere=${() => {}}
    />`,
  );
  const handler = seen.find((v) => v.props["data-testid"] === id)?.props[name];
  return typeof handler === "function" ? handler : undefined;
}

test("test_the_raw_input_commits_malformed_padded_text_verbatim", () => {
  const before = selectedStage.value;
  /** @type {Partial<PipelineRow>[]} */
  const patches = [];
  /** @type {RowWriter} */
  const update = (patch) => {
    patches.push(patch);
  };
  handlerOf(update, "raw-toggle", "onClick")?.();
  handlerOf(update, "raw-input", "onChange")?.({ target: { value: TYPED } });
  // Back to chip view, and the selection the toggle cleared put back.
  handlerOf(update, "raw-toggle", "onClick")?.();
  selectedStage.value = before;
  assert.deepEqual(patches, [{ process: TYPED }]);
});
