// A value typed into one of the filter primer's number boxes, committed and the
// box left, delivered the way a browser delivers one.
//
// The dispatch contract is the one tests/js/support/knobedit.js documents for a
// number box: an `input` as the value changes, a `change` when it is committed,
// a `blur` on the way out. Whichever of those handlers the row actually mounts
// is fired, and a gesture that reached none of them throws rather than returning
// quietly, so a case dispatching into nothing fails loudly instead of reporting
// that no callback ran and calling that a behavior. Nothing of HQPTuner's is
// stubbed (docs/testing.md rule 4): the handler invoked is the row's own, reached
// through preact's own `options.vnode` creation hook.
//
// `knobBoxEdit` cannot be reused: its `pick()` requires exactly one non-range
// input in the whole render, and the primer's control block renders three.
//
// WHICH BOX, and why by `min`. The three rows carry distinct minima — Length
// 0.1, Roll-off 0, Transient 2 — and every box carries its row's, so the minimum
// names the row unambiguously. That selector is a SPEC FACT, not an inference
// from the markup: if a row's minimum ever changes, these cases must fail as a
// broken selector rather than quietly typing into the wrong row and asserting on
// a signal nothing touched. Anything other than exactly one match therefore
// throws.
//
// The boxes are located in the FLAT vnode list, never by walking down from the
// control block: `props.children` does not cross a component boundary (support/
// wheel.js states the same limit), so a subtree walk from a wrapper reaches no
// row a child component rendered.

import { propsOf } from "./wheel.js";
import { renderTree } from "./vnodeseam.js";

/** @typedef {import("./wheel.js").VNode} VNode */

/** @param {VNode} v */
const isBox = (v) => v && typeof v === "object" && v.type === "input" && propsOf(v).type !== "range";

/**
 * The one number box in the render whose row carries `min`.
 *
 * @param {VNode[]} seen
 * @param {number} min
 * @returns {VNode}
 */
function pickBox(seen, min) {
  const hits = seen.filter((v) => isBox(v) && Number(propsOf(v).min) === min);
  if (hits.length !== 1) throw new Error(`expected one number box with min=${min} in the render, found ${hits.length}`);
  return hits[0];
}

// The element the event targets, carrying the value the browser has already put
// in the box by the time the handler runs. A type=number input reports "" for
// both an empty box and unparseable text, and `valueAsNumber` is NaN for either.
/**
 * @param {VNode} node
 * @param {string | number} value
 */
function element(node, value) {
  return {
    tagName: "INPUT",
    type: propsOf(node).type,
    value: String(value),
    valueAsNumber: Number(String(value) === "" ? NaN : value),
    dataset: {},
    focus() {},
    blur() {},
    select() {},
    closest: () => null,
  };
}

/**
 * @param {string} type
 * @param {ReturnType<typeof element>} el
 */
const boxEvent = (type, el) => ({
  type,
  target: el,
  currentTarget: el,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopPropagation() {},
});

/**
 * Fire one of the box's own handlers, if it mounts that one.
 *
 * @param {VNode} node
 * @param {ReturnType<typeof element>} el
 * @param {string} type
 * @param {string} prop
 * @returns {number}
 */
function deliver(node, el, type, prop) {
  const handler = propsOf(node)[prop];
  if (typeof handler !== "function") return 0;
  handler(boxEvent(type, el));
  return 1;
}

/**
 * `value` typed into the number box of the row whose minimum is `min`,
 * committed, and the box left.
 *
 * @param {unknown} tree
 * @param {number} min
 * @param {string | number} value
 * @returns {void}
 */
export function primerBoxEdit(tree, min, value) {
  const { seen } = renderTree(/** @type {Parameters<typeof renderTree>[0]} */ (tree));
  const node = pickBox(seen, min);
  const el = element(node, value);
  let reached = deliver(node, el, "input", "onInput");
  reached += deliver(node, el, "change", "onChange");
  reached += deliver(node, el, "blur", "onBlur");
  if (reached === 0)
    throw new Error(`nothing received the edit: the box with min=${min} mounts no input, change or blur handler`);
}
