// Rendered suite for hqptuner/static/components/faceplate/drawers/pipelines/: the DSP pipelines drawer's Overview and
// output tabs. The pin grid (lit, crossfeed and bypassed pins, a pin tap staging a pipeline and showing its output's
// tab), an output tab's list, and a chip edit on the selected pipeline (a gain written, a stage removed, a crossfeed
// row's chips held locked).
//
// Renders through preact-render-to-string. A tap or a change is fired through the vnode seam
// (tests/js/support/vnodeseam.js), since server rendering fires no events; the store is driven at the wire by the
// staging fake. Pins are found by their crosspoint (`data-src`, `data-mix`), list lines by their place in the set
// (`data-i`), chips by their place in the strip (`data-chip`), controls by `data-testid`.
//
// Not reachable here: a band dragged on the plot (a pointer drag in the plot's SVG), the Import EQ popover's parking and
// its library search (a browser fetch of the AutoEq blob on first open), a file picked for upload, and the output tab
// finding its own panel, which reads the mounted DOM; server rendered, an output tab draws the shown tab's output. A
// browser run closes them.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/drawers-pipelines.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { config, engineState, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { showTab, shownTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { compileRows } from "../../../../hqptuner/static/vendor/eqlab/core/binaural/compile.js";
import { PipelinesOverview } from "../../../../hqptuner/static/components/faceplate/drawers/pipelines/Overview.js";
import { PipelinesOutput } from "../../../../hqptuner/static/components/faceplate/drawers/pipelines/Output.js";
import { quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} Row */

/** @type {DrawerSchema} */
const SCHEMA = {
  id: "pl-fixture",
  title: "pl-title",
  aria: "pl",
  family: "matrix",
  tabs: [
    { id: "overview", label: "overview", body: [{ block: "overview" }] },
    { id: "out0", label: "out0", body: [{ block: "out" }] },
    { id: "out1", label: "out1", body: [{ block: "out" }] },
  ],
};

/** A row from one input to one output with no processing. @param {number} src @param {number} mix @returns {Row} */
const plain = (src, mix) => ({ gain: "0", gainunit: "dB", mixdown: String(mix), process: "", source: String(src) });

/** @type {Row[]} */
const STEREO = [
  { gain: "-3.5", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=1000;q=0.7;g=-3,delay:t=0.001", source: "0" },
  { gain: "-3.5", gainunit: "dB", mixdown: "1", process: "iir:type=peak;f=1000;q=0.7;g=-3", source: "1" },
];

const STRUCTURAL = /** @type {Row[]} */ (
  compileRows({ lambda: 1, angle: 30, headRadius: 0.0875, srcA: 0, srcB: 1, preampDb: 0, eqProcess: "" })
);

/** @type {ReturnType<typeof stagingWire>} */
let wire;

/**
 * Load a pipeline set as the config file's, with the matrix engine's switch.
 *
 * @param {Row[]} rows
 * @param {boolean} [engaged]
 */
function load(rows, engaged = true) {
  config.value = {
    fields: [{ name: "channels", type: "number", value: 2 }],
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
  openPopover.value = null;
  load(STEREO);
  await discardAll();
  showTab(SCHEMA.id, "overview");
});

const overview = () => html`<${PipelinesOverview} schema=${SCHEMA} />`;
const output = () => html`<${PipelinesOutput} schema=${SCHEMA} />`;

/** @param {unknown} tree @returns {MarkupElement[]} */
const markup = (tree) => elements(render(/** @type {import("../../support/wheel.js").VNode} */ (tree)));

/**
 * The pin at one crosspoint, from the Overview's markup.
 *
 * @param {number} src
 * @param {number} mix
 */
const pin = (src, mix) =>
  markup(overview()).find((e) => attr(e, "data-src") === String(src) && attr(e, "data-mix") === String(mix));

/**
 * Fire the handler of the first element vnode matching `pred` in a tree, or nothing when none matches.
 *
 * @param {unknown} tree
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @param {string} [handler]
 * @param {unknown} [event]
 */
async function fire(tree, pred, handler = "onClick", event = undefined) {
  const { seen } = renderTree(/** @type {import("../../support/wheel.js").VNode} */ (tree));
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) await fn(event);
  await quiesce(wire);
}

/** Show output `o`'s tab with pipeline `i` picked from its list. @param {number} o @param {number} i */
async function pickLine(o, i) {
  showTab(SCHEMA.id, `out${o}`);
  await fire(output(), (p) => p.role === "option" && p["data-i"] === String(i));
}

test("test_a_routed_crosspoints_pin_is_lit", () => {
  const lit = (/** @type {number} */ s, /** @type {number} */ m) => {
    const el = pin(s, m);
    return el ? classes(el).includes("on") : null;
  };
  assert.deepEqual([lit(0, 0), lit(0, 1)], [true, false]);
});

test("test_a_crossfeed_blocks_pin_is_marked_as_the_blocks", () => {
  load(STRUCTURAL);
  const el = pin(0, 0);
  assert.equal(el ? classes(el).includes("gen") : null, true);
});

test("test_tapping_an_empty_pin_stages_a_pipeline_there", async () => {
  await fire(overview(), (p) => p["data-src"] === "1" && p["data-mix"] === "0");
  assert.deepEqual(stagedRows()?.at(-1), plain(1, 0));
});

test("test_tapping_a_pin_shows_its_outputs_tab", async () => {
  await fire(overview(), (p) => p["data-src"] === "1" && p["data-mix"] === "1");
  assert.equal(shownTab(SCHEMA), "out1");
});

test("test_a_bypassed_matrix_engine_disables_the_pins", () => {
  load(STEREO, false);
  const el = pin(0, 0);
  assert.equal(el ? hasAttr(el, "disabled") : null, true);
});

test("test_an_output_tab_lists_the_pipelines_of_the_input_it_shows", async () => {
  load([plain(0, 0), plain(1, 0), plain(0, 0)]);
  showTab(SCHEMA.id, "out0");
  await fire(output(), (p) => p["data-v"] === "1");
  await fire(output(), (p) => p["data-v"] === "0");
  const lines = markup(output()).filter((e) => attr(e, "role") === "option" && attr(e, "data-i") !== undefined);
  assert.deepEqual(
    lines.map((e) => attr(e, "data-i")),
    ["0", "2"],
  );
});

test("test_a_gain_edit_on_the_picked_pipeline_stages_its_gain", async () => {
  load([plain(0, 0), plain(1, 1)]);
  await pickLine(0, 0);
  await fire(output(), (p) => p["data-testid"] === "pl-gain", "onChange", { currentTarget: { value: "-4" } });
  assert.equal(stagedRows()?.[0].gain, "-4");
});

test("test_removing_a_chip_stages_the_chain_without_its_stage", async () => {
  await pickLine(0, 0);
  await fire(output(), (p) => p["data-testid"] === "pl-chipx" && p["data-chip"] === "1");
  assert.equal(stagedRows()?.[0].process, "iir:type=peak;f=1000;q=0.7;g=-3");
});

test("test_a_crossfeed_rows_chips_offer_no_remove", async () => {
  const removable = () => markup(output()).filter((e) => attr(e, "data-testid") === "pl-chipx").length;
  await pickLine(0, 0);
  const plainCount = removable();
  load(STRUCTURAL);
  await discardAll();
  await pickLine(0, 0);
  assert.deepEqual([plainCount > 0, removable()], [true, 0]);
});
