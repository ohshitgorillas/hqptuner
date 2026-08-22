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
// via preact's own `options.vnode` hook — the renderer's public seam, nothing
// of HQPTuner's stubbed (docs/testing.md rule 4).
//
// `dd-opt`, `dd-box` and `dd-fav` are wire-side markings the combobox suites
// already pin, not copy: a markup change fails the suites that use these
// readers for a reason that is not a regression — check the row shape before
// reading such a failure as one.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { elements, classes, attr } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */
/** @typedef {import("./wheel.js").VNode} VNode */

// --- the markup half ---------------------------------------------------------

/**
 * Where an element ends in the fragment it was scanned from.
 *
 * @param {MarkupElement} el
 * @returns {number}
 */
export const endOf = (el) => el.start + el.html.length;

/**
 * Whether `a` encloses `b` in the fragment (and is not `b` itself).
 *
 * @param {MarkupElement} a
 * @param {MarkupElement} b
 * @returns {boolean}
 */
export const encloses = (a, b) =>
  a.start <= b.start && endOf(a) >= endOf(b) && !(a.start === b.start && a.html.length === b.html.length);

/**
 * The dd-opt option rows of a render, in document order.
 *
 * @param {string} out
 * @returns {MarkupElement[]}
 */
export const rows = (out) =>
  elements(out)
    .filter((el) => classes(el).includes("dd-opt"))
    .sort((a, b) => a.start - b.start);

/**
 * The option row for one wire value, named by the `data-v` the row carries and
 * never by the words in it (docs/testing.md rule 9). Throws when no row carries
 * it, so an absence fails loudly instead of comparing against nothing.
 *
 * @param {string} out
 * @param {string} needle
 * @returns {MarkupElement}
 */
export function rowIncluding(out, needle) {
  const hit = rows(out).find((el) => attr(el, "data-v") === needle);
  if (!hit) throw new Error(`no option row carries data-v="${needle}"`);
  return hit;
}

/**
 * Text a user reads off the CLOSED combobox button: the dd-box element's own
 * content, tags stripped, so the caret the shape draws in its own element does
 * not ride along. Cases ask what that text EQUALS — "names the selection" is
 * only half the contract, and a button reading "0 sinc-M" satisfies a contains.
 *
 * @param {string} out
 * @returns {string}
 */
export function boxText(out) {
  const m = /<button\b[^<>]*\bclass="[^"]*\bdd-box\b[^"]*"[^<>]*>([\s\S]*?)<\/button>/.exec(out || "");
  if (!m) throw new Error("no closed combobox button in the rendered output");
  return m[1].replace(/<[^<>]*>/g, "").trim();
}

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
 * The dd-opt option rows among the vnodes one render built.
 *
 * @param {VNode[]} seen
 * @returns {VNode[]}
 */
export const vnodeRows = (seen) => seen.filter((v) => v && v.props && classTokens(v).includes("dd-opt"));

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
