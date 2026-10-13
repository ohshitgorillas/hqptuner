// Shared reads and taps of the rendered stage-drawer suites (tests/js/components/faceplate-drawers/): a drawer drawn
// from its schema through preact-render-to-string, read as markup in document order, and an option of one of its own
// fields fired through the vnode seam since server rendering fires no events.

import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { attr, classes, elements } from "../markup.js";
import { renderTree } from "../vnodeseam.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../vnodeseam.js").VNode} VNode */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/**
 * Every element of a drawer's markup, in document order.
 *
 * @param {DrawerSchema} schema
 * @returns {MarkupElement[]}
 */
export const drawerMarkup = (schema) =>
  elements(render(html`<${Drawer} schema=${schema} />`)).sort((a, b) => a.start - b.start);

/**
 * The ids of the tabs carrying a dirty dot.
 *
 * @param {DrawerSchema} schema
 * @returns {(string | undefined)[]}
 */
export const dottedTabs = (schema) =>
  drawerMarkup(schema)
    .filter((e) => attr(e, "role") === "tab" && classes(e).includes("dirty"))
    .map((e) => attr(e, "data-tab"));

/**
 * The first vnode in a subtree whose props match `pred`.
 *
 * @param {unknown} node
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @returns {VNode | undefined}
 */
function findIn(node, pred) {
  if (Array.isArray(node)) return node.map((n) => findIn(n, pred)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  const v = /** @type {VNode} */ (node);
  if (v.props && pred(v.props)) return v;
  return findIn(v.props?.children, pred);
}

/**
 * Tap option `value` of the field `id` in the drawer drawn from `schema`, or nothing when no such option is drawn.
 *
 * @param {DrawerSchema} schema
 * @param {string} id
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function tapFieldOption(schema, id, value) {
  const { seen } = renderTree(html`<${Drawer} schema=${schema} />`);
  const field = seen.find((v) => v.props?.["data-field"] === id);
  const hit = findIn(field?.props.children, (p) => p["data-v"] === value);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}
