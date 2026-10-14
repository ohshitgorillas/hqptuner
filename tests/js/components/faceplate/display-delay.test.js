// Rendered suite for the spectrum delay in the Display popover
// (hqptuner/static/components/faceplate/page/DisplayOptions.js): the panel holds a box taking the spectrum's delay in
// seconds, and a change in it writes the delay the spectrum is drawn at.
//
// The box is found inside the row carrying the delay's field identifier in `data-field`, as the one control there taking
// a change, which is fired through the vnode seam (tests/js/support/vnodeseam.js), since server rendering fires no
// events.
//
// What a typed box holds lives in the DOM, which server rendering never builds, so the typing case mounts the popover
// through preact's own client render on a fake document: elements carry the members preact's diff and the popover's
// parking touch, and an element's `value` reads back as a string, as a browser's does. Effects after paint run through
// preact's `options.requestAnimationFrame` seam, flushed by hand once each render returns, so no frame timer runs. Focus
// is `document.activeElement`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/display-delay.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { options, render as mount } from "preact";

import "../../support/domseam.js";
import { useStorage } from "../../support/storage.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { DisplayOptions } from "../../../../hqptuner/static/components/faceplate/page/DisplayOptions.js";
import { openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { spectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

//: The Display popover's id, which its trigger and its panel both carry as `data-pop`.
const DISPLAY = "display";

//: The delay row's field identifier, as its `data-field` carries it.
const DELAY_FIELD = "vdelay";

//: The delay in force before each case, in seconds, as the box shows it once mounted.
const START = 0.25;

/** @type {{ document?: unknown }} */
const env = globalThis;

beforeEach(() => {
  useStorage();
  openPopover.value = DISPLAY;
  spectrumOffset.value = START;
});

/**
 * The first vnode under `node`, itself included, whose `onChange` is a handler.
 *
 * @param {unknown} node
 * @returns {VNode | undefined}
 */
function changeable(node) {
  if (Array.isArray(node)) return node.map(changeable).find(Boolean);
  if (typeof node !== "object" || node === null) return undefined;
  const vnode = /** @type {VNode} */ (node);
  if (typeof vnode.props?.onChange === "function") return vnode;
  return changeable(vnode.props?.children);
}

/**
 * Change the delay box in the popover to `value`, or nothing when the popover draws no such box.
 *
 * @param {string} value
 */
function change(value) {
  const { seen } = renderTree(html`<${DisplayOptions} />`);
  const row = seen.find((/** @type {VNode} */ n) => n.props?.["data-field"] === DELAY_FIELD);
  const fn = changeable(row?.props.children)?.props.onChange;
  if (typeof fn === "function") fn({ target: { value } });
}

test("test_a_delay_change_in_the_display_popover_writes_the_spectrum_offset_in_seconds", () => {
  change("0.5");
  assert.equal(spectrumOffset.value, 0.5);
});

test("test_a_negative_delay_change_in_the_display_popover_writes_a_negative_spectrum_offset", () => {
  change("-0.5");
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

/** An element, whose `value` reads back as a string, standing in no page the popover could park against. */
class Element extends Node {
  /** @param {string} localName */
  constructor(localName) {
    super(1);
    this.localName = localName;
    /** @type {Node[]} */
    this.childNodes = [];
    /** @type {{ name: string, value: string }[]} */
    this.attributes = [];
    /** @type {Record<string, string>} */
    this.dataset = {};
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

  closest() {
    return null;
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
  const before = env.document;
  const page = {
    .../** @type {object} */ (before),
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
      mount(html`<${DisplayOptions} />`, /** @type {ParentNode} */ (/** @type {unknown} */ (root)));
    } finally {
      options.requestAnimationFrame = frame;
    }
    after.forEach((flush) => flush());
  };
  try {
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
  } finally {
    env.document = before;
  }
}

test("test_a_focused_delay_box_in_the_display_popover_keeps_what_was_typed_when_the_delay_changes", () => {
  assert.deepEqual(typedAcross("0.7", 1), [String(START), "0.7"]);
});
