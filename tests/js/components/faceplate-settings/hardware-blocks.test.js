// Rendered suite for hqptuner/static/components/faceplate/settings/HardwareBlocks.js, the hardware drawer's two blocks:
// Blocks per cycle (the `Set manually` box gating the slider, and the values a tick and an untick draft) and CUDA
// devices (the two device boxes, which gray under each CUDA offload value, the gray line convolution-only draws, and
// the key each box drafts).
//
// Renders through preact-render-to-string; a change is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The store is driven at the wire: `GET /api/engine` answers the engine table
// a case hands the fake, and the draft is read back through `hardwareDraft`. Controls are found by input type and by
// the `data-k` wire key; every string asserted is a wire value the test put there or the daemon's own auto value.
//
// Not reachable here: a slider drag and its release, which fire input and change events SSR never fires. A browser
// run closes it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/hardware-blocks.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import {
  CudaDevicesBlock,
  NblocksBlock,
} from "../../../../hqptuner/static/components/faceplate/settings/HardwareBlocks.js";
import {
  discardHardware,
  hardwareDraft,
  loadHardware,
} from "../../../../hqptuner/static/store/faceplate/settings/hardware.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {Record<string, string>} EngineTable */

const SCHEMA = { id: "hardware", title: "hardware", aria: "hardware", tabs: [] };
const HERE = { drawer: "hardware", tab: "gpu" };

//: The engine as the daemon reports it: full CUDA offload, a manual block count, both devices picked.
const ENGINE = { cuda: "1", multicore: "auto", ecores: "default", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

/**
 * Load the engine table a fake daemon reports into the draft.
 *
 * @param {Partial<EngineTable>} [over]  attributes over ENGINE
 */
async function load(over = {}) {
  const engine = { ...ENGINE, ...over };
  stagingWire({ routes: (path) => (path === "/api/engine" ? ok({ engine }) : undefined) });
  await loadHardware();
}

beforeEach(async () => {
  discardHardware();
  await load();
});

/** @param {unknown} Block */
const tree = (Block) => html`<${Block} schema=${SCHEMA} here=${HERE} />`;

/** Every element of a block's markup. @param {unknown} Block @returns {MarkupElement[]} */
const markup = (Block) => elements(render(tree(Block)));

/** @param {string} type @returns {(e: MarkupElement) => boolean} */
const input = (type) => (e) => e.name === "input" && attr(e, "type") === type;

/** Whether the slider's range is disabled. */
function rangeDisabled() {
  const el = markup(NblocksBlock).find(input("range"));
  return el ? hasAttr(el, "disabled") : null;
}

/**
 * Fire the change handler of the first vnode of `Block` matching `pred`, with `target` as the event's currentTarget.
 *
 * @param {unknown} Block
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @param {Record<string, unknown>} target
 */
function change(Block, pred, target) {
  const { seen } = renderTree(tree(Block));
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props.onChange);
  if (fn) fn({ currentTarget: target });
}

/** @param {boolean} checked */
const tick = (checked) => change(NblocksBlock, (p) => p.type === "checkbox", { checked });

/** @param {string} k @param {string} value */
const typeInto = (k, value) => change(CudaDevicesBlock, (p) => p["data-k"] === k, { value });

test("test_the_slider_is_disabled_while_automatic_and_live_once_ticked", async () => {
  await load({ nblocks: "0" });
  const automatic = rangeDisabled();
  tick(true);
  assert.deepEqual([automatic, rangeDisabled()], [true, false]);
});

test("test_each_device_box_drafts_its_own_key", () => {
  typeInto("cuda_dev", "5");
  typeInto("cuda_cdev", "3");
  const { cuda_dev, cuda_cdev } = hardwareDraft().values;
  assert.deepEqual([cuda_dev, cuda_cdev], ["5", "3"]);
});
