// The fake elements of tests/js/support/painters/elementtree.js: each node of the tree and the element that answers
// for it, built from small factories, one per surface (style, dataset, attributes, queries, tree reads). No test()
// and no assert lives here.
//
// Every element of one tree shares a context: whether the tree is dark, the nodes written since the last mark, and the
// host the selectors are matched under. A dark tree answers every read as if it were empty; writes still land and are
// kept.

import { classesOf, matchesAny, parseSelector } from "./selector.js";

/** @typedef {import("../elementtree.js").FakeElement} FakeElement */

/**
 * @typedef {object} Node
 * @property {string} name
 * @property {Map<string, string>} attrs
 * @property {Node[]} kids
 * @property {Node | null} parent
 * @property {Map<string, unknown>} style
 * @property {FakeElement} el
 * @property {number} start
 * @property {number} end
 */

/**
 * The state one tree's elements share.
 *
 * @typedef {object} Ctx
 * @property {boolean} dark  whether every read answers as if the tree were empty
 * @property {Set<Node>} written  the nodes written since the last mark
 * @property {Node} host  the node the markup was rendered into, under which selectors are matched
 */

/**
 * The attribute a `dataset` key stands for: `data-` and the key with each capital turned into `-` and its lower case.
 *
 * @param {string} key
 * @returns {string}
 */
const dataAttr = (key) => `data-${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;

/**
 * @param {Ctx} ctx
 * @param {Node} n
 * @returns {Record<string, unknown> & { setProperty(name: string, value: string): void }}
 */
function styleOf(ctx, n) {
  return /** @type {Record<string, unknown> & { setProperty(name: string, value: string): void }} */ (
    new Proxy(/** @type {Record<string, unknown>} */ ({}), {
      get(_, prop) {
        if (prop === "setProperty") {
          return (/** @type {string} */ name, /** @type {string} */ value) => {
            ctx.written.add(n);
            n.style.set(name, value);
          };
        }
        return ctx.dark ? undefined : n.style.get(String(prop));
      },
      set(_, prop, value) {
        ctx.written.add(n);
        n.style.set(String(prop), value);
        return true;
      },
    })
  );
}

/**
 * @param {Ctx} ctx
 * @param {Node} n
 * @returns {Record<string, string | undefined>}
 */
function datasetOf(ctx, n) {
  return new Proxy(/** @type {Record<string, string | undefined>} */ ({}), {
    get(_, prop) {
      if (ctx.dark || typeof prop !== "string") return undefined;
      return n.attrs.get(dataAttr(prop));
    },
    set(_, prop, value) {
      ctx.written.add(n);
      n.attrs.set(dataAttr(String(prop)), String(value));
      return true;
    },
  });
}

/**
 * @param {Ctx} ctx
 * @param {Node} n
 */
function attributeCalls(ctx, n) {
  return {
    classList: { contains: (/** @type {string} */ k) => !ctx.dark && classesOf(n.attrs).includes(k) },
    getAttribute: (/** @type {string} */ name) => (ctx.dark ? null : (n.attrs.get(name) ?? null)),
    hasAttribute: (/** @type {string} */ name) => !ctx.dark && n.attrs.has(name),
    setAttribute: (/** @type {string} */ name, /** @type {unknown} */ value) => {
      ctx.written.add(n);
      n.attrs.set(name, String(value));
    },
    removeAttribute: (/** @type {string} */ name) => {
      ctx.written.add(n);
      n.attrs.delete(name);
    },
  };
}

/**
 * Every node under `n`, in document order.
 *
 * @param {Node} n
 * @returns {Node[]}
 */
function descendants(n) {
  /** @type {Node[]} */
  const out = [];
  for (const k of n.kids) out.push(k, ...descendants(k));
  return out;
}

/**
 * The nodes under `n` that match `selector`; none in a dark tree, though an unsupported selector still throws.
 *
 * @param {Ctx} ctx
 * @param {Node} n
 * @param {string} selector
 * @returns {Node[]}
 */
function select(ctx, n, selector) {
  const chains = parseSelector(selector);
  if (ctx.dark) return [];
  return descendants(n).filter((d) => matchesAny(d, chains, ctx.host));
}

/**
 * The element of `n` or its nearest ancestor that matches `s`; none in a dark tree.
 *
 * @param {Ctx} ctx
 * @param {Node} n
 * @param {string} s
 * @returns {FakeElement | null}
 */
function closestOf(ctx, n, s) {
  if (ctx.dark) return null;
  const chains = parseSelector(s);
  for (let up = /** @type {Node | null} */ (n); up !== null; up = up.parent) {
    if (matchesAny(up, chains, ctx.host)) return up.el;
  }
  return null;
}

/**
 * @param {Ctx} ctx
 * @param {Node} n
 */
function queryCalls(ctx, n) {
  return {
    querySelector: (/** @type {string} */ s) => select(ctx, n, s)[0]?.el ?? null,
    querySelectorAll: (/** @type {string} */ s) => select(ctx, n, s).map((d) => d.el),
    matches: (/** @type {string} */ s) => !ctx.dark && matchesAny(n, parseSelector(s), ctx.host),
    closest: (/** @type {string} */ s) => closestOf(ctx, n, s),
  };
}

/**
 * The tree reads an element answers from its node, each with what it answers in a dark tree.
 *
 * @type {Map<string, { live: (n: Node) => unknown, dark: () => unknown }>}
 */
const READS = new Map([
  ["children", { live: (n) => n.kids.map((k) => k.el), dark: () => [] }],
  ["firstElementChild", { live: (n) => n.kids[0]?.el ?? null, dark: () => null }],
  ["parentElement", { live: (n) => n.parent?.el ?? null, dark: () => null }],
]);

/**
 * The element that answers for `n`. Any property assigned to it is kept and read back, a tree read excepted.
 *
 * @param {Ctx} ctx
 * @param {Node} n
 * @returns {FakeElement}
 */
function makeElement(ctx, n) {
  const methods = {
    tagName: n.name,
    localName: n.name.toLowerCase(),
    style: styleOf(ctx, n),
    dataset: datasetOf(ctx, n),
    ...attributeCalls(ctx, n),
    ...queryCalls(ctx, n),
  };
  /** @type {Record<string, unknown>} */
  const assigned = {};
  return /** @type {FakeElement} */ (
    new Proxy(methods, {
      get(target, prop) {
        if (typeof prop !== "string") return Reflect.get(target, prop);
        const read = READS.get(prop);
        if (read !== undefined) return ctx.dark ? read.dark() : read.live(n);
        if (prop in assigned) return ctx.dark ? undefined : assigned[prop];
        return Reflect.get(target, prop);
      },
      set(_, prop, value) {
        ctx.written.add(n);
        assigned[String(prop)] = value;
        return true;
      },
    })
  );
}

/**
 * A node of the tree, with no parent or children yet, and its element.
 *
 * @param {Ctx} ctx
 * @param {{ name: string, attrs: Map<string, string>, start: number, end: number }} at  its tag, attributes and span
 * @returns {Node}
 */
export function node(ctx, { name, attrs, start, end }) {
  /** @type {Node} */
  const n = { name, attrs, kids: [], parent: null, style: new Map(), el: /** @type {FakeElement} */ ({}), start, end };
  n.el = makeElement(ctx, n);
  return n;
}
