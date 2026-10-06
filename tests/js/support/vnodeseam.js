// The renderer's vnode seam shared by the suites that activate an affordance
// SSR renders but cannot click: one render of a tree with every vnode preact
// builds along the way, collected through preact's own `options.vnode` creation hook — the
// renderer's public seam, nothing of HQPTuner's stubbed (docs/testing.md
// rule 4) — plus the subtree-text reader an affordance is found by.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { options } from "preact";
import { render } from "preact-render-to-string";

/** @typedef {import("./wheel.js").VNode} VNode */

/**
 * One render of any tree, with every vnode preact builds along the way.
 * `options.vnode` is restored even if the render throws.
 *
 * @param {Parameters<typeof render>[0]} tree
 * @returns {{ out: string, seen: VNode[] }}
 */
export function renderTree(tree) {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(tree), seen };
  } finally {
    options.vnode = previous;
  }
}

/**
 * Concatenated text of a vnode subtree.
 *
 * @param {unknown} node
 * @returns {string}
 */
export function textOf(node) {
  if (node === false || node == null) return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object" || node === null) return "";
  const props = /** @type {VNode} */ (node).props;
  return props ? textOf(props.children) : "";
}
