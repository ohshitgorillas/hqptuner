// A live fake document for suites that mount a component the way the browser does, with preact's client renderer, so
// its layout effects, effects, re-renders and resize observations run, and then hand its mounted elements to a painter.
// No test() and no assert lives here.
//
// `liveDom(boxOf)` returns a document whose elements answer what preact's renderer writes and reads (create, insert,
// remove, attributes, inline style, text), what a painter may read at creation (the queries
// tests/js/support/painters/elementtree.js answers, answered by that module over the live tree's current markup, plus
// attributes, `dataset`, `classList`, `children`, `parentElement`), and what a component may read to measure its space:
// `getBoundingClientRect`, `getBBox`, `clientWidth`/`clientHeight`, `offsetWidth`/`offsetHeight`, all from
// `boxOf(el)`, the test's table of laid-out sizes in CSS pixels. Every element answers its box from the start, as a
// laid-out page does. The document's `defaultView` is its window, which the page reaches through an element's
// `ownerDocument`; its `ResizeObserver` reports each observed element's box once after it is observed, as the
// browser's first observation does.
//
// `install()` puts the document on the global and takes over preact's two schedules, re-render
// and after-paint, so nothing runs on a timer: everything the mount scheduled runs at `settle()`, re-renders and
// effects and resize reports in turn until none is left. `uninstall()` puts back what `install()` replaced.
//
// Every write is kept: `setAttribute`, `removeAttribute`, any assignment to an element property, any assignment to or
// `setProperty` on its `style`, `classList` changes. `writes()` returns the elements written since the last `mark()`,
// in document order, attached ones only.
//
// `darken()` makes every read an element answers come back as if the document were empty: queries find nothing,
// attributes, properties, `dataset`, `classList` and style read absent, the tree has no nodes or text and every box
// is empty. Writes still land and `writes()`, `all()`, `within()`, `parentOf()` and `rotation()` still see them. A
// painter that found its elements and read what it needs at creation keeps working after `darken()`; one that reads
// on a paint does not.
//
// `rotation(el)` is the angle an element was last turned to, in degrees clockwise from upright, as
// tests/js/support/painters/elementtree.js reads it from the element's `transform` attribute and inline style
// transform.

import { options } from "preact";

import { elementTree } from "./elementtree.js";

/** @typedef {import("./elementtree.js").FakeElement} FakeElement */
/** @typedef {import("./elementtree.js").ElementTree} ElementTree */
/** @typedef {{ width: number, height: number }} Box */

/**
 * @typedef {object} LiveNode
 * @property {number} type  1 element, 3 text
 * @property {string} name
 * @property {string | null} ns
 * @property {Map<string, string>} attrs
 * @property {Map<string, string>} style
 * @property {Record<string, unknown>} props
 * @property {LiveNode[]} kids
 * @property {LiveNode | null} parent
 * @property {string} data
 * @property {any} el
 */

/**
 * The state one document's elements share.
 *
 * @typedef {object} Ctx
 * @property {(el: any) => Box} boxOf
 * @property {boolean} dark  whether every read answers as if the document were empty
 * @property {Set<LiveNode>} written
 * @property {Map<any, LiveNode>} byElement
 * @property {LiveNode} root
 * @property {Record<string, unknown>} document
 * @property {Record<string, unknown>} window  the document's `defaultView`
 * @property {{ renders: (() => void)[], afterPaint: (() => void)[], resizes: (() => void)[] }} queues
 */

/**
 * @typedef {object} LiveDom
 * @property {any} root  the element the component is mounted into
 * @property {() => void} install
 * @property {() => void} uninstall
 * @property {() => void} settle  run every re-render, effect and resize report the page has scheduled
 * @property {() => void} mark  forget the writes made so far
 * @property {() => any[]} writes  attached elements written since the last mark, each once, in document order
 * @property {() => any[]} all  every attached element under the root, in document order
 * @property {(el: any, inside: any) => boolean} within  whether `el` is `inside` or under it
 * @property {(el: any) => any | null} parentOf  the element `el` stands in, null at the root
 * @property {() => void} darken  make every read an element answers find nothing from now on
 * @property {(el: any) => number} rotation  degrees clockwise from upright, NaN when not rotated
 */

//: How many rounds `settle()` runs before it gives up on a page that keeps scheduling work.
const SETTLE_ROUNDS = 64;
const HTML_NS = "http://www.w3.org/1999/xhtml";
//: The box every element answers in a darkened document.
const DARK_BOX = /** @type {Box} */ ({ width: 0, height: 0 });

/**
 * @param {string} s
 * @returns {string}
 */
const escapeAttr = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/**
 * @param {string} s
 * @returns {string}
 */
const escapeText = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * @param {string} prop
 * @returns {string}
 */
const kebab = (prop) => (prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`));

/**
 * @param {LiveNode} n
 * @returns {LiveNode[]}
 */
function elementsUnder(n) {
  /** @type {LiveNode[]} */
  const out = [];
  for (const k of n.kids) {
    if (k.type !== 1) continue;
    out.push(k, ...elementsUnder(k));
  }
  return out;
}

/**
 * @param {LiveNode} n
 * @returns {string}
 */
function serialize(n) {
  if (n.type === 3) return escapeText(n.data);
  const attrs = [...n.attrs].map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  return `<${n.name}${attrs}>${n.kids.map(serialize).join("")}</${n.name}>`;
}

/**
 * @param {LiveNode} n
 * @returns {string}
 */
const textOf = (n) => (n.type === 3 ? n.data : n.kids.map(textOf).join(""));

/**
 * The live tree as tests/js/support/painters/elementtree.js sees it, and the live node each of its elements stands for.
 *
 * @param {Ctx} ctx
 * @returns {{ tree: ElementTree, live: Map<FakeElement, LiveNode> }}
 */
function snapshot(ctx) {
  const tree = elementTree(ctx.root.kids.map(serialize).join(""));
  const nodes = elementsUnder(ctx.root);
  /** @type {Map<FakeElement, LiveNode>} */
  const live = new Map(tree.all.map((el, i) => [el, nodes[i]]));
  live.set(tree.root, ctx.root);
  return { tree, live };
}

/**
 * The live tree as tests/js/support/painters/elementtree.js sees it, and the element in it standing for `n`.
 *
 * @param {Ctx} ctx
 * @param {LiveNode | undefined} n
 * @returns {{ tree: ElementTree, live: Map<FakeElement, LiveNode>, me: FakeElement | undefined }}
 */
function standIn(ctx, n) {
  const { tree, live } = snapshot(ctx);
  return { tree, live, me: [...live].find(([, m]) => m === n)?.[0] };
}

/**
 * Asks the elementtree element standing for `n` and carries its answer back to live elements.
 *
 * @param {Ctx} ctx
 * @param {LiveNode} n
 * @param {(me: FakeElement) => FakeElement[]} ask
 * @returns {any[]}
 */
function query(ctx, n, ask) {
  if (ctx.dark) return [];
  const { live, me } = standIn(ctx, n);
  if (me === undefined) return [];
  return ask(me).map((hit) => live.get(hit)?.el);
}

/**
 * The angle the element standing for `n` was last turned to, as tests/js/support/painters/elementtree.js reads it.
 *
 * @param {Ctx} ctx
 * @param {LiveNode | undefined} n
 * @returns {number}
 */
function rotationOf(ctx, n) {
  const { tree, me } = standIn(ctx, n);
  if (me === undefined || n === undefined) return NaN;
  const styled = n.style.get("transform");
  if (styled !== undefined) me.style.transform = styled;
  return tree.rotation(me);
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 * @returns {boolean}
 */
function attached(ctx, n) {
  for (let m = /** @type {LiveNode | null} */ (n); m !== null; m = m.parent) if (m === ctx.root) return true;
  return false;
}

/**
 * @param {LiveNode} n
 * @param {string | null} cssText
 */
function setCss(n, cssText) {
  n.style.clear();
  for (const decl of (cssText ?? "").split(";")) {
    const at = decl.indexOf(":");
    if (at > 0) n.style.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
  }
}

/**
 * @param {LiveNode} child
 */
function detach(child) {
  const from = child.parent;
  if (from === null) return;
  from.kids.splice(from.kids.indexOf(child), 1);
  child.parent = null;
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 * @returns {Record<string, unknown>}
 */
function styleOf(ctx, n) {
  /** @type {Record<string, unknown>} */
  const calls = {
    setProperty: (/** @type {string} */ name, /** @type {unknown} */ value) => {
      ctx.written.add(n);
      n.style.set(name, String(value));
    },
    removeProperty: (/** @type {string} */ name) => {
      ctx.written.add(n);
      n.style.delete(name);
    },
    getPropertyValue: (/** @type {string} */ name) => (ctx.dark ? "" : (n.style.get(name) ?? "")),
  };
  return new Proxy(/** @type {Record<string, unknown>} */ ({}), {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in calls) return calls[prop];
      if (ctx.dark) return "";
      if (prop === "cssText") return [...n.style].map(([k, v]) => `${k}: ${v}`).join("; ");
      return n.style.get(kebab(prop)) ?? "";
    },
    set(_, prop, value) {
      ctx.written.add(n);
      if (prop === "cssText") setCss(n, String(value));
      else if (value === null || value === "") n.style.delete(kebab(String(prop)));
      else n.style.set(kebab(String(prop)), String(value));
      return true;
    },
  });
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 * @returns {Record<string, string | undefined>}
 */
function datasetOf(ctx, n) {
  return new Proxy(/** @type {Record<string, string | undefined>} */ ({}), {
    get: (_, prop) => (typeof prop === "string" && !ctx.dark ? n.attrs.get(`data-${kebab(prop)}`) : undefined),
    set(_, prop, value) {
      ctx.written.add(n);
      n.attrs.set(`data-${kebab(String(prop))}`, String(value));
      return true;
    },
  });
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 */
function classListOf(ctx, n) {
  const now = () => (n.attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
  const put = (/** @type {string[]} */ list) => {
    ctx.written.add(n);
    n.attrs.set("class", [...new Set(list)].join(" "));
  };
  return {
    contains: (/** @type {string} */ k) => !ctx.dark && now().includes(k),
    add: (/** @type {string[]} */ ...ks) => put([...now(), ...ks]),
    remove: (/** @type {string[]} */ ...ks) => put(now().filter((k) => !ks.includes(k))),
    toggle: (/** @type {string} */ k, /** @type {boolean | undefined} */ force) => {
      const on = force ?? !now().includes(k);
      put(on ? [...now(), k] : now().filter((c) => c !== k));
      return on;
    },
  };
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 */
function attributeCalls(ctx, n) {
  return {
    getAttribute: (/** @type {string} */ name) => (ctx.dark ? null : (n.attrs.get(name) ?? null)),
    hasAttribute: (/** @type {string} */ name) => !ctx.dark && n.attrs.has(name),
    setAttribute: (/** @type {string} */ name, /** @type {unknown} */ value) => {
      ctx.written.add(n);
      if (name === "style") setCss(n, String(value));
      else n.attrs.set(name, String(value));
    },
    setAttributeNS: (/** @type {string | null} */ _ns, /** @type {string} */ name, /** @type {unknown} */ value) => {
      ctx.written.add(n);
      n.attrs.set(name, String(value));
    },
    removeAttribute: (/** @type {string} */ name) => {
      ctx.written.add(n);
      if (name === "style") n.style.clear();
      else n.attrs.delete(name);
    },
    removeAttributeNS: (/** @type {string | null} */ _ns, /** @type {string} */ name) => {
      ctx.written.add(n);
      n.attrs.delete(name);
    },
  };
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 */
function treeCalls(ctx, n) {
  const insertBefore = (/** @type {any} */ el, /** @type {any} */ before) => {
    const child = /** @type {LiveNode} */ (ctx.byElement.get(el));
    detach(child);
    const at = before ? n.kids.indexOf(/** @type {LiveNode} */ (ctx.byElement.get(before))) : -1;
    if (at < 0) n.kids.push(child);
    else n.kids.splice(at, 0, child);
    child.parent = n;
    return el;
  };
  return {
    insertBefore,
    appendChild: (/** @type {any} */ el) => insertBefore(el, null),
    removeChild: (/** @type {any} */ el) => {
      detach(/** @type {LiveNode} */ (ctx.byElement.get(el)));
      return el;
    },
    remove: () => detach(n),
    addEventListener() {},
    removeEventListener() {},
  };
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 */
function queryCalls(ctx, n) {
  return {
    querySelector: (/** @type {string} */ s) => query(ctx, n, (me) => me.querySelectorAll(s))[0] ?? null,
    querySelectorAll: (/** @type {string} */ s) => query(ctx, n, (me) => me.querySelectorAll(s)),
    matches: (/** @type {string} */ s) => query(ctx, n, (me) => (me.matches(s) ? [me] : [])).length > 0,
    closest: (/** @type {string} */ s) => query(ctx, n, (me) => [me.closest(s)].filter((x) => x !== null))[0] ?? null,
  };
}

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 */
function boxCalls(ctx, n) {
  const rect = () => {
    const { width, height } = ctx.dark ? DARK_BOX : ctx.boxOf(n.el);
    return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height };
  };
  return { getBoundingClientRect: rect, getBBox: rect, getClientRects: () => [rect()] };
}

/** @type {Record<string, (ctx: Ctx, n: LiveNode) => unknown>} */
const READS = {
  childNodes: (_, n) => n.kids.map((k) => k.el),
  children: (_, n) => n.kids.filter((k) => k.type === 1).map((k) => k.el),
  firstChild: (_, n) => n.kids[0]?.el ?? null,
  lastChild: (_, n) => n.kids[n.kids.length - 1]?.el ?? null,
  firstElementChild: (_, n) => n.kids.find((k) => k.type === 1)?.el ?? null,
  parentNode: (_, n) => n.parent?.el ?? null,
  parentElement: (_, n) => n.parent?.el ?? null,
  nextSibling: (_, n) => {
    const sibs = n.parent?.kids ?? [];
    return sibs[sibs.indexOf(n) + 1]?.el ?? null;
  },
  ownerDocument: (ctx) => ctx.document,
  isConnected: (ctx, n) => attached(ctx, n),
  data: (_, n) => n.data,
  nodeValue: (_, n) => n.data,
  textContent: (_, n) => textOf(n),
  clientWidth: (ctx, n) => ctx.boxOf(n.el).width,
  offsetWidth: (ctx, n) => ctx.boxOf(n.el).width,
  clientHeight: (ctx, n) => ctx.boxOf(n.el).height,
  offsetHeight: (ctx, n) => ctx.boxOf(n.el).height,
};

//: What each of READS answers in a darkened document where that is not null: no nodes, no text, no size.
const DARK_READS = /** @type {Record<string, () => unknown>} */ ({
  childNodes: () => [],
  children: () => [],
  isConnected: () => false,
  data: () => "",
  nodeValue: () => "",
  textContent: () => "",
  clientWidth: () => 0,
  offsetWidth: () => 0,
  clientHeight: () => 0,
  offsetHeight: () => 0,
});

/**
 * @param {Ctx} ctx
 * @param {LiveNode} n
 * @returns {any}
 */
function makeElement(ctx, n) {
  const element = n.type === 1;
  const methods = {
    style: styleOf(ctx, n),
    dataset: datasetOf(ctx, n),
    classList: classListOf(ctx, n),
    nodeType: n.type,
    localName: element ? n.name : undefined,
    nodeName: element ? n.name.toUpperCase() : "#text",
    tagName: element ? n.name.toUpperCase() : undefined,
    namespaceURI: n.ns,
    ...attributeCalls(ctx, n),
    ...treeCalls(ctx, n),
    ...queryCalls(ctx, n),
    ...boxCalls(ctx, n),
  };
  return new Proxy(methods, {
    get(target, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (prop in READS) return ctx.dark ? (DARK_READS[prop]?.() ?? null) : READS[prop](ctx, n);
      if (prop in n.props) return ctx.dark ? undefined : n.props[prop];
      return Reflect.get(target, prop);
    },
    set(_, prop, value) {
      ctx.written.add(n);
      if (prop === "data" || prop === "nodeValue") n.data = String(value);
      else n.props[String(prop)] = value;
      return true;
    },
  });
}

/**
 * @param {Ctx} ctx
 * @param {number} type
 * @param {string} name
 * @param {string | null} ns
 * @returns {LiveNode}
 */
function node(ctx, type, name, ns) {
  /** @type {LiveNode} */
  const n = {
    type,
    name,
    ns,
    attrs: new Map(),
    style: new Map(),
    props: {},
    kids: [],
    parent: null,
    data: "",
    el: null,
  };
  n.el = makeElement(ctx, n);
  ctx.byElement.set(n.el, n);
  return n;
}

/**
 * @param {Ctx} ctx
 * @returns {Record<string, unknown>}
 */
function documentOf(ctx) {
  return {
    createElement: (/** @type {string} */ name) => node(ctx, 1, name, HTML_NS).el,
    createElementNS: (/** @type {string | null} */ ns, /** @type {string} */ name) => node(ctx, 1, name, ns).el,
    createTextNode: (/** @type {string} */ text) => {
      const t = node(ctx, 3, "#text", null);
      t.data = String(text);
      return t.el;
    },
    defaultView: ctx.window,
    body: ctx.root.el,
    documentElement: ctx.root.el,
    getElementById: () => null,
    querySelector: (/** @type {string} */ s) => ctx.root.el.querySelector(s),
    querySelectorAll: (/** @type {string} */ s) => ctx.root.el.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };
}

/**
 * The ResizeObserver class of one document: each observation reports the target's box once, at the next settle.
 *
 * @param {Ctx} ctx
 */
function resizeObserverOf(ctx) {
  return class ResizeObserver {
    /** @param {(entries: unknown[], observer: unknown) => void} report */
    constructor(report) {
      this.report = report;
      this.live = true;
    }
    /** @param {any} target */
    observe(target) {
      ctx.queues.resizes.push(() => {
        if (!this.live) return;
        const { width, height } = ctx.boxOf(target);
        const size = [{ inlineSize: width, blockSize: height }];
        const contentRect = { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height };
        this.report([{ target, contentRect, borderBoxSize: size, contentBoxSize: size }], this);
      });
    }
    unobserve() {}
    disconnect() {
      this.live = false;
    }
  };
}

/**
 * Installs and uninstalls the globals and preact's schedules.
 *
 * @param {Ctx} ctx
 * @returns {{ install: () => void, uninstall: () => void }}
 */
function installer(ctx) {
  /** @type {Map<string, PropertyDescriptor | undefined>} */
  const prior = new Map();
  /** @type {Record<string, unknown>} */
  const hooks = /** @type {any} */ (options);
  /** @type {Record<string, unknown>} */
  const priorHooks = {};
  const globals = /** @type {[string, unknown][]} */ ([["document", ctx.document]]);
  return {
    install() {
      for (const [name, value] of globals) {
        prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
      }
      priorHooks.debounceRendering = hooks.debounceRendering;
      priorHooks.requestAnimationFrame = hooks.requestAnimationFrame;
      hooks.debounceRendering = (/** @type {() => void} */ run) => void ctx.queues.renders.push(run);
      hooks.requestAnimationFrame = (/** @type {() => void} */ run) => void ctx.queues.afterPaint.push(run);
    },
    uninstall() {
      hooks.debounceRendering = priorHooks.debounceRendering;
      hooks.requestAnimationFrame = priorHooks.requestAnimationFrame;
      for (const [name, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      prior.clear();
    },
  };
}

/**
 * @param {Ctx} ctx
 */
function settle(ctx) {
  const q = ctx.queues;
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const due = [...q.renders, ...q.afterPaint, ...q.resizes];
    if (due.length === 0) return;
    q.renders = [];
    q.afterPaint = [];
    q.resizes = [];
    for (const run of due) run();
  }
  throw new Error(`livedom: the page was still scheduling work after ${SETTLE_ROUNDS} rounds`);
}

/**
 * Builds the document.
 *
 * @param {(el: any) => Box} boxOf
 * @returns {LiveDom}
 */
export function liveDom(boxOf) {
  const ctx = /** @type {Ctx} */ ({ boxOf, dark: false, written: new Set(), byElement: new Map(), document: {} });
  ctx.queues = { renders: [], afterPaint: [], resizes: [] };
  ctx.root = node(ctx, 1, "div", HTML_NS);
  ctx.window = { ResizeObserver: resizeObserverOf(ctx) };
  ctx.document = documentOf(ctx);
  return {
    root: ctx.root.el,
    ...installer(ctx),
    settle: () => settle(ctx),
    mark: () => void ctx.written.clear(),
    writes: () =>
      elementsUnder(ctx.root)
        .filter((n) => ctx.written.has(n))
        .map((n) => n.el),
    all: () => elementsUnder(ctx.root).map((n) => n.el),
    within: (el, inside) => {
      const target = ctx.byElement.get(inside);
      for (let n = ctx.byElement.get(el) ?? null; n !== null; n = n.parent) if (n === target) return true;
      return false;
    },
    parentOf: (el) => {
      const up = ctx.byElement.get(el)?.parent ?? null;
      return up === null || up === ctx.root ? null : up.el;
    },
    darken: () => {
      ctx.dark = true;
    },
    rotation: (el) => rotationOf(ctx, ctx.byElement.get(el)),
  };
}
