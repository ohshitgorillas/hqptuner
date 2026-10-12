// The region of the rendered faceplate (the frame hqptuner/static/app.js composes) directly under its top bar, shared
// by the suites that ask what shows there. The top bar is the element the header renders first and the engine row the
// element the engine row renders first, each found in the frame's own render by its markup; the region under
// the top bar is every element that opens after the top bar closes and closes before the engine row opens. Nothing in a
// hidden or closed subtree shows, and neither does a dialog sheet, which opens over the plate rather than under the bar.
// A reader gets the region's shown text, its shown alert lines (elements carrying a severity), and the tap handler of a
// line found through the renderer's vnode seam, since render-to-string fires no events.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import "./domseam.js";
import { h, cloneElement } from "preact";
import { render } from "preact-render-to-string";

import { Faceplate } from "../../../hqptuner/static/app.js";
import { Header } from "../../../hqptuner/static/components/faceplate/Header.js";
import { EngineRow } from "../../../hqptuner/static/components/faceplate/EngineRow.js";
import { elements, hasAttr, attr } from "./markup.js";
import { renderTree } from "./vnodeseam.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */
/** @typedef {import("./wheel.js").VNode} VNode */
/** @typedef {(e?: unknown) => unknown} Tap */

/** @param {MarkupElement} e */
const end = (e) => e.start + e.html.length;

/**
 * The element a component renders first, found among a frame's elements: the first frame element with the tag and
 * attributes of the element that opens the component's render, rendered alone with the props the frame gave it.
 *
 * @param {VNode[]} seen
 * @param {MarkupElement[]} all
 * @param {Function} component
 * @returns {MarkupElement | undefined}
 */
function rootIn(seen, all, component) {
  const vnode = seen.find((v) => v.type === component);
  if (!vnode) return undefined;
  const alone = render(h(/** @type {any} */ (component), vnode.props));
  const root = elements(alone).find((e) => e.start === 0);
  return root && all.find((e) => e.name === root.name && e.attrs === root.attrs);
}

/**
 * Whether an element is kept from showing: hidden, closed, or a dialog sheet.
 *
 * @param {MarkupElement} e
 */
const unshown = (e) => hasAttr(e, "hidden") || hasAttr(e, "data-closed") || attr(e, "role") === "dialog";

/**
 * The markup of an element with every subtree inside it that does not show, itself included, cut out.
 *
 * @param {MarkupElement} el
 * @returns {string}
 */
function shownMarkup(el) {
  const cut = elements(el.html)
    .filter(unshown)
    .sort((a, b) => b.html.length - a.html.length);
  return cut.reduce((s, e) => s.split(e.html).join(""), el.html);
}

/**
 * One render of the faceplate: every vnode built along the way, and the shown markup of the region directly under its
 * top bar. Raises when the frame renders no top bar or no engine row to bound the region, so a frame the reader cannot
 * place never reads as an empty region.
 *
 * @returns {{ seen: VNode[], under: string }}
 */
export function readPlate() {
  const { out, seen } = renderTree(h(Faceplate, {}));
  const all = elements(out);
  const bar = rootIn(seen, all, Header);
  const row = rootIn(seen, all, EngineRow);
  if (!bar) throw new Error("the faceplate rendered no top bar");
  if (!row) throw new Error("the faceplate rendered no engine row");
  const inside = all.filter((e) => e.start >= end(bar) && end(e) <= row.start);
  const outermost = inside.filter((e) => !inside.some((o) => o !== e && o.start <= e.start && end(o) >= end(e)));
  return { seen, under: outermost.map(shownMarkup).join("") };
}

/**
 * What a reader sees in shown markup: tags stripped, whitespace collapsed.
 *
 * @param {string} markup
 * @returns {string}
 */
export const shownText = (markup) =>
  markup
    .replace(/<[^<>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The alert lines in shown markup: the elements carrying a severity.
 *
 * @param {string} markup
 * @returns {MarkupElement[]}
 */
export const shownLines = (markup) => elements(markup).filter((e) => hasAttr(e, "data-sev"));

/**
 * The first tap handler on a vnode or anywhere among its children, or undefined when there is none.
 *
 * @param {unknown} node
 * @returns {Tap | undefined}
 */
function handlerIn(node) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = handlerIn(child);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node === null || typeof node !== "object") return undefined;
  const props = /** @type {VNode} */ (node).props;
  if (!props) return undefined;
  const onClick = props.onClick;
  if (typeof onClick === "function") return /** @type {Tap} */ (onClick);
  return handlerIn(props.children);
}

/**
 * The tap handler of the first line of a severity in a faceplate render, on the line or inside it, kept to lines whose
 * markup lies inside `within` when it is given. Undefined when no such line takes a tap.
 *
 * @param {VNode[]} seen
 * @param {string} sev
 * @param {string} [within]
 * @returns {Tap | undefined}
 */
export function lineTap(seen, sev, within) {
  const lines = seen.filter((v) => typeof v.type === "string" && v.props["data-sev"] === sev);
  const inside =
    within === undefined ? lines : lines.filter((v) => within.includes(render(cloneElement(/** @type {any} */ (v)))));
  return handlerIn(inside[0]);
}
