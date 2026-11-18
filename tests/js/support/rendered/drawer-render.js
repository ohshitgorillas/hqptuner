// Shared reads and taps of the rendered stage-drawer suites (tests/js/components/faceplate-drawers/): a drawer drawn
// from its schema through preact-render-to-string, read as markup in document order, and an option of one of its own
// fields fired through the vnode seam since server rendering fires no events.

import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { generation } from "../../../../hqptuner/static/store/signals.js";
import { attr, classes, elements } from "../markup.js";
import { renderTree } from "../vnodeseam.js";
import { ok } from "../wire/wire.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../wire/wire.js").StagingWire} StagingWire */
/** @typedef {import("../vnodeseam.js").VNode} VNode */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/**
 * The drawer drawn from `schema`.
 *
 * @param {DrawerSchema} schema
 */
export const drawerTree = (schema) => html`<${Drawer} schema=${schema} />`;

/**
 * Every element of a drawer's markup, in document order.
 *
 * @param {DrawerSchema} schema
 * @returns {MarkupElement[]}
 */
export const drawerMarkup = (schema) => elements(render(drawerTree(schema))).sort((a, b) => a.start - b.start);

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
 * The route of a staging wire that answers GET /api/config with the field readings `served` gives for the wire, and
 * nothing else.
 *
 * @param {(w: StagingWire) => Record<string, unknown>} served
 * @returns {(path: string, opts: { method?: string }, w: StagingWire) => ReturnType<typeof ok> | undefined}
 */
export const configRoute = (served) => (path, opts, w) =>
  path === "/api/config" && (opts.method ?? "GET") === "GET"
    ? ok({ generation: generation.value, fields: served(w) })
    : undefined;

/**
 * Fire the handler `handler` of the first element vnode in one render of `tree` whose props match `pred`, or nothing
 * when none matches.
 *
 * @param {unknown} tree
 * @param {(props: Record<string, unknown>, type: unknown) => boolean} pred
 * @param {string} handler
 * @param {unknown} [event]
 * @returns {Promise<void>}
 */
export async function fire(tree, pred, handler, event = undefined) {
  const { seen } = renderTree(/** @type {Parameters<typeof renderTree>[0]} */ (tree));
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}, v.type));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) await fn(event);
}

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
export const within = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/**
 * The smallest drawer row enclosing every one of `inner`, or undefined when one of them is missing or no row holds
 * them all.
 *
 * @param {MarkupElement[]} all
 * @param {(MarkupElement | undefined)[]} inner
 */
export function rowHolding(all, inner) {
  if (inner.some((e) => e === undefined)) return undefined;
  const held = /** @type {MarkupElement[]} */ (inner);
  return all
    .filter((e) => classes(e).includes("drow") && held.every((i) => within(i, e)))
    .sort((a, b) => a.html.length - b.html.length)[0];
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
  const { seen } = renderTree(drawerTree(schema));
  const field = seen.find((v) => v.props?.["data-field"] === id);
  const hit = findIn(field?.props.children, (p) => p["data-v"] === value);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}
