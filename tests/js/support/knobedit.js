// An edit made through a knob's OTHER two controls — the horizontal slider and
// the number box — delivered the way a browser delivers one.
//
// There is no DOM under `node --test`, so what is reproduced is the browser's
// dispatch contract for each gesture, which is short and documented:
//
//   1. dragging a range input: a `pointerdown` on it, then an `input` for every
//      value the thumb passes through, then a `pointerup`, then one `change`
//      that closes the edit. The pointer events reach the document's capture
//      listeners whatever element they target, which is how lib/dom.js knows an
//      edit came from a user rather than from the platform (tests/js/lib/
//      useredit.test.js pins that policy) — so they are delivered here too,
//      rather than firing the control's handler on its own and calling that a
//      drag.
//   2. typing in a number box and leaving it: an `input` as the value changes, a
//      `change` when it is committed, and a `blur` on the way out.
//
// Whichever of those handlers the component actually mounts is fired; a gesture
// that reached none at all throws instead of returning quietly, so a case
// dispatching into nothing fails loudly rather than reporting that no callback
// ran and calling that a behaviour. Which handler a component chooses is its
// own shape — the contract is what the gesture produces, so all of them are
// offered and at least one must answer.
//
// Importing this module installs the document seam (./domseam.js), so it must be
// imported BEFORE lib/dom.js or any component that pulls it in.

import { documentSees } from "./domseam.js";
import { propsOf, renderWith } from "./wheel.js";

/** @typedef {import("./wheel.js").VNode} VNode */
/** @typedef {import("./wheel.js").VNodeProps} VNodeProps */

/** @param {VNode} v */
const isInput = (v) => v && typeof v === "object" && v.type === "input";

/** @param {VNode} v */
const typeOf = (v) => propsOf(v).type;

// The one input of its kind in the render: the horizontal slider is the range
// input, and the number box is the other one — named by what it is not, since
// which `type` a text-shaped box carries is the component's own choice and a box
// spelled `number`, `text` or `tel` is the same box to a user. Anything other
// than exactly one match throws rather than editing something else.
/**
 * @param {VNode[]} seen
 * @param {"slider" | "box"} kind
 * @returns {VNode}
 */
function pick(seen, kind) {
  const wanted = (/** @type {VNode} */ v) => (kind === "slider" ? typeOf(v) === "range" : typeOf(v) !== "range");
  const hits = seen.filter((v) => isInput(v) && wanted(v));
  if (hits.length !== 1) throw new Error(`expected one ${kind} input in the render, found ${hits.length}`);
  return hits[0];
}

// The element the event targets, carrying the value the browser has already
// moved the control to by the time the handler runs.
/**
 * @param {VNode} node
 * @param {string | number} value
 */
function element(node, value) {
  /** @type {VNodeProps} */
  const p = node.props || {};
  return {
    tagName: "INPUT",
    type: p.type,
    value: String(value),
    valueAsNumber: Number(value),
    dataset: {},
    focus() {},
    blur() {},
    select() {},
    closest: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 }),
  };
}

/**
 * @param {string} type
 * @param {ReturnType<typeof element>} el
 */
function controlEvent(type, el) {
  return {
    type,
    target: el,
    currentTarget: el,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  };
}

// Fire one of the control's own handlers, if it mounts that one. Returns how
// many recipients the event had.
/**
 * @param {VNode} node
 * @param {ReturnType<typeof element>} el
 * @param {string} type
 * @param {string} prop
 * @returns {number}
 */
function deliver(node, el, type, prop) {
  const handler = node.props && node.props[prop];
  if (typeof handler !== "function") return 0;
  handler(controlEvent(type, el));
  return 1;
}

/** @param {ReturnType<typeof element>} el */
const press = (el) => documentSees("pointerdown", el, { button: 0, buttons: 1 });

/** @param {ReturnType<typeof element>} el */
const release = (el) => documentSees("pointerup", el, { buttons: 0 });

/**
 * A drag of the knob's horizontal slider to `value`, released on it.
 *
 * @param {unknown} vnode
 * @param {string | number} value
 * @returns {void}
 */
export function knobSliderEdit(vnode, value) {
  const { seen } = renderWith(vnode);
  const node = pick(seen, "slider");
  const el = element(node, value);
  press(el);
  let reached = deliver(node, el, "input", "onInput");
  release(el);
  reached += deliver(node, el, "change", "onChange");
  if (reached === 0)
    throw new Error("nothing received the slider edit: the range input mounts no input or change handler");
}

/**
 * `value` typed into the knob's number box, committed, and the box left.
 *
 * @param {unknown} vnode
 * @param {string | number} value
 * @returns {void}
 */
export function knobBoxEdit(vnode, value) {
  const { seen } = renderWith(vnode);
  const node = pick(seen, "box");
  const el = element(node, value);
  let reached = deliver(node, el, "input", "onInput");
  reached += deliver(node, el, "change", "onChange");
  reached += deliver(node, el, "blur", "onBlur");
  if (reached === 0)
    throw new Error("nothing received the box edit: the number input mounts no input, change or blur handler");
}
