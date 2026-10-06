// Rendered suite for hqptuner/static/components/faceplate/settings/VisualBlocks.js, the Visual settings drawer's
// blocks: the accent picker (swatches and the custom hex box), the spectrum delay box, and the Hide from signal chain
// toggles.
//
// Renders through preact-render-to-string; a tap or a change is fired through the vnode seam
// (tests/js/support/vnodeseam.js), since server rendering fires no events. The theme and faceplate stores write
// `document` and `localStorage`, so both are faked and taken away after every test, and every signal a test touches is
// reset before it. Controls are found by option value (`data-v`), roles and element names; the hexes come from the theme
// store, never restated.
//
// What a typed box holds lives in the DOM, which server rendering never builds, so the delay box's typing case mounts
// the block through preact's own client render on a fake document: elements carry the members preact's diff touches,
// and an element's `value` reads back as a string, as a browser's does. Effects after paint run through preact's
// `options.requestAnimationFrame` seam, flushed by hand once each render returns, so no frame timer runs. Focus is
// `document.activeElement`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/visual-blocks.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { options, render as mount } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import {
  AccentBlock,
  DelayBlock,
  HideBlock,
} from "../../../../hqptuner/static/components/faceplate/settings/VisualBlocks.js";
import { accent, accentHex } from "../../../../hqptuner/static/store/ui/theme.js";
import { hiddenStages } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { spectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
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
  spectrumOffset.value = 0.25;
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

test("test_a_delay_change_writes_the_spectrum_offset_in_seconds", () => {
  fire(DelayBlock, (type) => type === "input", "onChange", { target: { value: "0.5" } });
  assert.equal(spectrumOffset.value, 0.5);
});

test("test_the_delay_box_takes_an_offset_down_to_minus_five_seconds", () => {
  const box = markup(DelayBlock).find((e) => e.name === "input");
  assert.equal(box ? attr(box, "min") : undefined, "-5");
});

test("test_a_negative_delay_change_writes_a_negative_spectrum_offset", () => {
  fire(DelayBlock, (type) => type === "input", "onChange", { target: { value: "-0.5" } });
  assert.equal(spectrumOffset.value, -0.5);
});

/** A node of the fake document: the tree members preact's diff walks. */
class Node {
  /** @param {number} nodeType */
  constructor(nodeType) {
    this.nodeType = nodeType;
    /** @type {Element | null} */
    this.parentNode = null;
  }

  get nextSibling() {
    const kin = this.parentNode ? this.parentNode.childNodes : [];
    return kin[kin.indexOf(this) + 1] ?? null;
  }
}

/** A text node. */
class Text extends Node {
  /** @param {string} data */
  constructor(data) {
    super(3);
    this.data = data;
  }
}

/** An element, whose `value` reads back as a string. */
class Element extends Node {
  /** @param {string} localName */
  constructor(localName) {
    super(1);
    this.localName = localName;
    /** @type {Node[]} */
    this.childNodes = [];
    /** @type {{ name: string, value: string }[]} */
    this.attributes = [];
    this.style = { cssText: "", setProperty: () => undefined };
    this.typed = "";
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get value() {
    return this.typed;
  }

  set value(v) {
    this.typed = v == null ? "" : String(v);
  }

  /**
   * @param {Node} node
   * @param {Node | null} before
   */
  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node);
    node.parentNode = this;
    return node;
  }

  /** @param {Node} node */
  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }

  setAttribute() {}

  removeAttribute() {}

  addEventListener() {}

  removeEventListener() {}
}

/**
 * The first element named `name` under `node`.
 *
 * @param {Node} node
 * @param {string} name
 * @returns {Element | null}
 */
function first(node, name) {
  if (!(node instanceof Element)) return null;
  if (node.localName === name) return node;
  for (const child of node.childNodes) {
    const hit = first(child, name);
    if (hit) return hit;
  }
  return null;
}

/**
 * The delay box's value as mounted, and again after the user focuses it, types `typed` and a render brings `next`.
 *
 * @param {string} typed
 * @param {number} next
 * @returns {string[]}
 */
function typedAcross(typed, next) {
  const page = {
    .../** @type {object} */ (env.document),
    /** @type {Element | null} */ activeElement: null,
    createElementNS: (/** @type {string} */ _ns, /** @type {string} */ name) => new Element(name),
    createTextNode: (/** @type {string} */ data) => new Text(data),
  };
  env.document = page;
  const root = new Element("div");
  const paint = () => {
    /** @type {Array<() => void>} */
    const after = [];
    const frame = options.requestAnimationFrame;
    options.requestAnimationFrame = (/** @type {() => void} */ flush) => after.push(flush);
    try {
      mount(tree(DelayBlock), /** @type {ParentNode} */ (/** @type {unknown} */ (root)));
    } finally {
      options.requestAnimationFrame = frame;
    }
    after.forEach((flush) => flush());
  };
  paint();
  const box = first(root, "input");
  const shown = box ? box.value : "";
  page.activeElement = box;
  if (box) box.value = typed;
  spectrumOffset.value = next;
  paint();
  const kept = box ? box.value : "";
  mount(null, /** @type {ParentNode} */ (/** @type {unknown} */ (root)));
  return [shown, kept];
}

test("test_a_focused_delay_box_keeps_what_was_typed_when_the_delay_changes", () => {
  assert.deepEqual(typedAcross("0.7", 1), ["0.25", "0.7"]);
});
