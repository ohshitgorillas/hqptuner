// Readers for the custom combobox's rendered rows, shared by the suites that
// ask what an option row shows and what its affordances do
// (controls/Combobox.js, rendered through a Field).
//
// Two halves, because a combobox is read two ways. The MARKUP half scans the
// SSR output the way tests/js/support/markup.js does — a tag-balancing scan, so
// an assertion can ask what a row encloses without naming any structure the
// component is free to change. The VNODE half reads the tree preact built
// (tests/js/support/vnodeseam.js), which is how an affordance SSR renders but
// cannot click is activated: through the onClick its vnode carries, collected
// via preact's own `options.vnode` hook — the renderer's public seam.
//
// `dd-opt`, `dd-box` and `dd-fav` are wire-side markings the combobox suites
// already pin, not copy: a markup change fails the suites that use these
// readers for a reason that is not a regression — check the row shape before
// reading such a failure as one.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../wheel.js").VNode} VNode */

// --- the markup half ---------------------------------------------------------

// --- the vnode half ------------------------------------------------------------

/**
 * The class tokens a vnode carries, under either prop spelling.
 *
 * @param {VNode} vnode
 * @returns {string[]}
 */
export const classTokens = (vnode) => {
  const cls = (vnode.props && (vnode.props.class || vnode.props.className)) || "";
  return typeof cls === "string" ? cls.split(/\s+/) : [];
};

/**
 * Every clickable vnode strictly inside a subtree (never the subtree root).
 *
 * @param {unknown} node
 * @param {VNode[]} [found]
 * @returns {VNode[]}
 */
export function clickablesIn(node, found = []) {
  if (Array.isArray(node)) {
    for (const kid of node) clickablesIn(kid, found);
    return found;
  }
  if (!node || typeof node !== "object" || !("props" in node) || !node.props) return found;
  const vnode = /** @type {VNode} */ (node);
  if (typeof vnode.props.onClick === "function") found.push(vnode);
  return clickablesIn(vnode.props.children, found);
}

/**
 * Fire a vnode's own click handler, with the event a pointer would bring.
 *
 * @param {VNode} vnode
 * @returns {void}
 */
export const click = (vnode) =>
  /** @type {(event: object) => void} */ (vnode.props.onClick)({ preventDefault() {}, stopPropagation() {} });
