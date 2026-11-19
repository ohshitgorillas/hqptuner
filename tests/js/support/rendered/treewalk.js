// Walkers over one render shared by the rendered suites that find a control by its tag and classes: the markup side
// reads render-to-string's output through markup.js, the vnode side walks the tree preact builds, and `fire` calls a
// vnode's handler since render-to-string fires no events. Every walker returns what it finds and asserts nothing.
// The last section is the page's logged wire, which the app boot suites share.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { elements, classes } from "../markup.js";
import { propsOf } from "../wheel.js";
import { renderTree } from "../vnodeseam.js";
import { useEventSource } from "../eventsource.js";
import { stagingWire } from "../wire/wire.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../wheel.js").VNode} VNode */

/** @type {{ fetch?: unknown }} */
const env = globalThis;

// --- markup ------------------------------------------------------------------------------------------------------

/**
 * Whether an element is a `name` carrying every class in `cls`.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} name
 * @param {string[]} cls
 */
export const isEl = (e, name, cls) => e !== undefined && e.name === name && cls.every((c) => classes(e).includes(c));

/**
 * Every element of a list that is a `name` with the classes in `cls`.
 *
 * @param {MarkupElement[]} all
 * @param {string} name
 * @param {...string} cls
 */
export const every = (all, name, ...cls) => all.filter((e) => isEl(e, name, cls));

/**
 * The elements inside `e`, `e` itself left out; none when `e` is missing.
 *
 * @param {MarkupElement | undefined} e
 */
export const inside = (e) => (e ? elements(e.html).slice(0, -1) : []);

/**
 * The elements directly inside `e`.
 *
 * @param {MarkupElement | undefined} e
 */
export const kids = (e) => {
  const all = inside(e);
  return all.filter(
    (k) => !all.some((o) => o !== k && o.start <= k.start && o.start + o.html.length >= k.start + k.html.length),
  );
};

/**
 * The first `name.cls…` inside `e`.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} name
 * @param {...string} cls
 */
export const first = (e, name, ...cls) => every(inside(e), name, ...cls)[0];

// --- vnodes ------------------------------------------------------------------------------------------------------

/** A vnode's classes. @param {VNode | undefined} v */
export const vcls = (v) => (v ? String(propsOf(v).class ?? propsOf(v).className ?? "").split(/\s+/) : []);

/**
 * Whether a vnode is a host `name` carrying every class in `cls`.
 *
 * @param {VNode | undefined} v
 * @param {string} name
 * @param {...string} cls
 */
export const isV = (v, name, ...cls) => v !== undefined && v.type === name && cls.every((c) => vcls(v).includes(c));

/**
 * Whether a value is a vnode.
 *
 * @param {unknown} c
 * @returns {c is VNode}
 */
const isVNode = (c) => typeof c === "object" && c !== null && "type" in c && "props" in c;

/**
 * The vnodes directly under `v`, empty slots left out.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
const vkids = (v) => (v ? [propsOf(v).children].flat(Infinity).filter(isVNode) : []);

/**
 * `v` and every vnode under it, in document order; a component's own output is not under it.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
export const descend = (v) => (v ? [v, ...vkids(v).flatMap(descend)] : []);

/**
 * Fire one handler of a vnode, if it carries it.
 *
 * @param {VNode | undefined} v
 * @param {string} [handler]
 * @param {Record<string, unknown>} [extra]  what the event carries beyond the no-op methods
 */
export async function fire(v, handler = "onClick", extra = {}) {
  await fireNow(v, handler, extra);
}

/**
 * Call one handler of a vnode at once, if it carries it, and hand back what it returns.
 *
 * @param {VNode | undefined} v
 * @param {string} [handler]
 * @param {Record<string, unknown>} [extra]  what the event carries beyond the no-op methods
 */
function fireNow(v, handler = "onClick", extra = {}) {
  const fn = v ? propsOf(v)[handler] : undefined;
  if (typeof fn === "function") return fn({ preventDefault: () => {}, stopPropagation: () => {}, ...extra });
  return undefined;
}

/**
 * Click the button carrying `data-v` `v` in one render of `tree`, or do nothing when no button carries it.
 *
 * @param {Parameters<typeof renderTree>[0]} tree
 * @param {string} v
 */
export function pickValue(tree, v) {
  const { seen } = renderTree(tree);
  fireNow(seen.find((n) => n.type === "button" && n.props?.["data-v"] === v));
}

// --- the page's wire ---------------------------------------------------------------------------------------------

/**
 * The page's wire for a case that expects it to ask for nothing: the EventSource fake, and the staging fetch fake
 * behind a log of every path it is handed, the staging paths it answers itself included.
 *
 * @returns {{ wire: ReturnType<typeof stagingWire>, asked: string[] }}
 */
export function askedWire() {
  useEventSource();
  /** @type {string[]} every path the page asked the wire for */
  const asked = [];
  const wire = stagingWire();
  const served = /** @type {(path: string, opts?: object) => Promise<unknown>} */ (env.fetch);
  env.fetch = (/** @type {string} */ path, /** @type {object | undefined} */ opts) => {
    asked.push(path);
    return served(path, opts);
  };
  return { wire, asked };
}
