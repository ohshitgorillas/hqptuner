// Rendered suite for hqptuner/static/components/faceplate/settings/VisualBlocks.js, the Visual settings drawer's two
// blocks: the accent picker (swatches and the custom hex box) and the Hide from signal chain toggles.
//
// Renders through preact-render-to-string; a tap or a change is fired through the vnode seam
// (tests/js/support/vnodeseam.js), since server rendering fires no events. The theme and faceplate stores write
// `document` and `localStorage`, so both are faked and taken away after every test, and every signal a test touches is
// reset before it. Controls are found by option value (`data-v`), roles and element names; the hexes come from the theme
// store, never restated.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/visual-blocks.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { AccentBlock, HideBlock } from "../../../../hqptuner/static/components/faceplate/settings/VisualBlocks.js";
import { accent, accentHex } from "../../../../hqptuner/static/store/ui/theme.js";
import { hiddenStages } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { dropStorage, useStorage } from "../../support/storage.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const SCHEMA = { id: "visual", title: "visual", aria: "visual", tabs: [] };
const HERE = { drawer: "visual", tab: "display" };

/** @type {{ document?: unknown }} */
const env = globalThis;

beforeEach(() => {
  useStorage();
  env.document = {
    documentElement: { dataset: {}, style: { setProperty: () => undefined, removeProperty: () => undefined } },
  };
  accent.value = "amber";
  accentHex.value = "";
  hiddenStages.value = [];
  openStage.value = null;
});

afterEach(() => {
  dropStorage();
  delete env.document;
});

/** @param {unknown} Block */
const tree = (Block) => html`<${Block} schema=${SCHEMA} here=${HERE} />`;

/**
 * Every element of a block's markup.
 *
 * @param {unknown} Block
 * @returns {MarkupElement[]}
 */
const markup = (Block) => elements(render(tree(Block)));

/**
 * The `data-v` of every swatch the accent block draws pressed.
 *
 * @returns {(string | undefined)[]}
 */
const pressedSwatches = () =>
  markup(AccentBlock)
    .filter((e) => e.name === "button" && attr(e, "aria-pressed") === "true")
    .map((e) => attr(e, "data-v"));

/**
 * Fire a handler of the first vnode in a block matching `pred`.
 *
 * @param {unknown} Block
 * @param {(type: string, props: Record<string, unknown>) => boolean} pred
 * @param {string} [handler]
 * @param {unknown} [event]
 */
function fire(Block, pred, handler = "onClick", event = undefined) {
  const { seen } = renderTree(tree(Block));
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.type, v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) fn(event);
}

/**
 * The button whose option value is `v`.
 *
 * @param {string} v
 */
const button = (v) => (/** @type {string} */ type, /** @type {Record<string, unknown>} */ p) =>
  type === "button" && p["data-v"] === v;

test("test_the_stored_pick_is_the_one_pressed_swatch", () => {
  accent.value = "blue";
  const blue = pressedSwatches();
  accent.value = "violet";
  assert.deepEqual([blue, pressedSwatches()], [["blue"], ["violet"]]);
});

test("test_a_swatch_tap_writes_the_accent", () => {
  fire(AccentBlock, button("green"));
  assert.equal(accent.value, "green");
});

test("test_a_hex_change_writes_the_custom_hex", () => {
  fire(AccentBlock, (type) => type === "input", "onChange", { target: { value: "#123456" } });
  assert.equal(accentHex.value, "#123456");
});

test("test_a_toggle_tap_hides_its_stage_and_closes_its_open_drawer", () => {
  openStage.value = "crossfeed";
  fire(HideBlock, button("crossfeed"));
  assert.deepEqual([hiddenStages.value, openStage.value], [["crossfeed"], null]);
});

test("test_a_second_toggle_tap_shows_the_stage_again", () => {
  fire(HideBlock, button("loudness"));
  const hidden = [...hiddenStages.value];
  fire(HideBlock, button("loudness"));
  assert.deepEqual([hidden, hiddenStages.value], [["loudness"], []]);
});

test("test_a_hidden_stage_lights_its_toggle", () => {
  hiddenStages.value = ["speakers"];
  const lit = markup(HideBlock)
    .filter((e) => e.name === "button" && classes(e).includes("on") && attr(e, "aria-pressed") === "true")
    .map((e) => attr(e, "data-v"));
  assert.deepEqual(lit, ["speakers"]);
});
