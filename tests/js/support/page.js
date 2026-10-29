// The fake page every suite hands its code instead of the browser's globals. No test() and no assert lives here.
//
// `fakePage({ clock, html, dpr })` builds a document and its window and installs nothing on `globalThis`: the code
// under test reaches them through what it is handed, an element's `ownerDocument` and that document's `defaultView`.
//
// The document answers what preact's renderer and the page code read and write: create, insert and remove nodes,
// attributes, `id`, `className`, `classList`, `dataset`, inline `style`, text, `innerHTML`, queries by the selectors
// tests/js/support/painters/elementtree/selector.js parses and matches, `getElementById`, `activeElement` moved by `focus()` and `blur()` with a browser's `blur`, `focusout`, `focus` and
// `focusin`, `hidden` with `visibilityState`, and events that run capture listeners from the window down, then the
// target's own, then bubble back up when `bubbles` is set. `html` is parsed into the body. SVG `getBBox` is the border box.
//
// The window holds the page's `location` (host `page.test`), `devicePixelRatio` (`dpr`, 1 when not given),
// `getComputedStyle` (each element's inline style, every other property empty, as a page with no stylesheet has it),
// `matchMedia` (nothing matches), `scrollBy`/`scrollTo` moving `scrollX`/`scrollY`, a `ResizeObserver`, an
// `OffscreenCanvas`, and `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask` and `performance.now`
// all handed to `clock`, so time moves only when the suite moves its clock.
//
// A `ResizeObserver` reports each element it observes once, on the clock's next frame, with the box the element has
// then, as the browser's first observation does. `resize(el, rect)` gives `el` that border box, which its
// `getBoundingClientRect` and client size answer from then on, and reports it at once to every observer watching `el`.
// A report's `contentRect` and `contentBoxSize` are the content box: the border box less the element's inline
// padding and border widths, as a browser's are; its `borderBoxSize` is the border box.
//
// A canvas, a `canvas` element of the document or an `OffscreenCanvas` of the window, answers `getContext("2d")` with
// a context that keeps its drawing state and draws nothing, and `getContext("webgl2")` with a context whose shaders
// compile and whose programs link, every create call handing back a fresh object; any other kind gets null. Every
// context asked, every call made on a context and every property it is given is a row of that canvas's ledger, in
// order: `{ call: "getContext", args: [kind] }`, `{ call: name, args }`, `{ set: name, value }`. `ledger(canvas)`
// returns the rows so far.
//
// `hidden` starts as `opts.hidden`; `setHidden` flips it and dispatches `visibilitychange`. `settle()` runs every queued
// re-render, after-paint and first resize report, and all they queue, until none is left. `hostPage(page)`, the one
// global write here, makes `page.doc` preact's global `document` and queues preact's re-render and after-paint schedules
// on the page, one page at a time; its release puts the global and both schedules back.
//
// `boxOf(el)`, when given, is every element's border box from its creation until a `resize` of it. `asked(kind)` is how
// many times any canvas of the page was asked for a `kind` context.
//
// `mark`, `writes`, `darken`, `within` and `rotation` read the write tracking and darkening that
// tests/js/support/page/tracking.js keeps on every node.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

/** @typedef {import("./clock.js").fakeClock} FakeClockFactory */
/** @typedef {ReturnType<FakeClockFactory>["clock"]} Clock */
/** @typedef {import("./page/tracking.js").Rect} Rect */
/** @typedef {import("./page/canvas.js").LedgerRow} LedgerRow */
/** @typedef {{ fn: Function, capture: boolean }} Listener */
/** @typedef {import("./painters/elementtree/selector.js").SelectorNode} SelectorNode */

import { options as preactOptions } from "preact";

import { asCanvas } from "./page/canvas.js";
import { RAW, inlineStyle, isDark, kebab, loudly, quietly, rectOf, rotateOf, tracking } from "./page/tracking.js";
import { matchesAny, parseSelector } from "./painters/elementtree/selector.js";

export { rotateOf };

const HTML_NS = "http://www.w3.org/1999/xhtml";
//: Elements that never hold children, so their tags close themselves.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"]);
//: The size a canvas has before anything sets it, as the browser's default.
const CANVAS_W = 300;
const CANVAS_H = 150;
//: The window's viewport, CSS pixels.
const VIEW_W = 1024;
const VIEW_H = 768;

/** @param {string} s */
const decode = (s) =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/** @param {string} s */
const escapeText = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * `el` as tests/js/support/painters/elementtree/selector.js reads a node; null for anything that is not an element.
 *
 * @param {any} el
 * @returns {SelectorNode | null}
 */
const selectorNode = (el) =>
  el?.nodeType === 1
    ? {
        name: el.localName,
        attrs: el.attrs,
        get parent() {
          return selectorNode(el.parentNode);
        },
      }
    : null;

//: The scope selectors are matched under: the whole page, every ancestor up to the root counted.
const WHOLE_PAGE = /** @type {SelectorNode} */ (/** @type {unknown} */ ({ parent: null }));

/**
 * A selector list, parsed by tests/js/support/painters/elementtree/selector.js, as a test of an element.
 *
 * @param {string} selector
 * @returns {(el: any) => boolean}
 */
function matcher(selector) {
  const chains = parseSelector(selector);
  return (el) => el.nodeType === 1 && matchesAny(/** @type {SelectorNode} */ (selectorNode(el)), chains, WHOLE_PAGE);
}

/**
 * Every element under `root`, in document order.
 *
 * @param {any} root
 * @returns {any[]}
 */
function descendants(root) {
  /** @type {any[]} */
  const out = [];
  const walk = (/** @type {any} */ n) => {
    for (const kid of n.childNodes) {
      if (kid.nodeType === 1) {
        out.push(kid);
        walk(kid);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Parses markup into nodes of `doc`, appended to `parent`.
 *
 * @param {any} doc
 * @param {any} parent
 * @param {string} html
 */
function parseInto(doc, parent, html) {
  const stack = [parent];
  const tokens =
    /<!--[\s\S]*?-->|<\/\s*([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(tokens)) {
    if (m[1]) closeTag(stack, m[1]);
    else if (m[2]) openTag(doc, stack, m);
    else if (m[5]) stack[stack.length - 1].appendChild(doc.createTextNode(decode(m[5])));
  }
}

/**
 * Closes the nearest open element named `name`, and every element opened inside it.
 *
 * @param {any[]} stack
 * @param {string} name
 */
function closeTag(stack, name) {
  const at = stack.map((n) => n.localName).lastIndexOf(name.toLowerCase());
  if (at > 0) stack.length = at;
}

/**
 * Appends the element an opening tag writes, its name `tag[2]` and attributes `tag[3]`, to the innermost open
 * element, and opens it unless `tag[4]` closes it or it holds no children.
 *
 * @param {any} doc
 * @param {any[]} stack
 * @param {RegExpMatchArray} tag
 */
function openTag(doc, stack, tag) {
  const el = doc.createElement(tag[2]);
  const selfClosing = Boolean(tag[4]);
  for (const a of (tag[3] ?? "").matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ""));
  }
  stack[stack.length - 1].appendChild(el);
  if (!selfClosing && !VOID.has(el.localName)) stack.push(el);
}

/**
 * Markup of `n`'s children.
 *
 * @param {any} n
 * @returns {string}
 */
function serialize(n) {
  return n.childNodes
    .map((/** @type {any} */ kid) => {
      if (kid.nodeType === 3) return escapeText(kid.data);
      const attrs = [...kid.attrs].map(([k, v]) => ` ${k}="${v.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`);
      const open = `<${kid.localName}${attrs.join("")}>`;
      return VOID.has(kid.localName) ? open : `${open}${serialize(kid)}</${kid.localName}>`;
    })
    .join("");
}

/**
 * Event listeners by type, with dispatch through the capture, target and bubble phases.
 */
class Target {
  constructor() {
    /** @type {Map<string, Listener[]>} */
    this.listeners = new Map();
  }
  /** @param {string} type @param {Function} fn @param {boolean | { capture?: boolean }} [options] */
  addEventListener(type, fn, options) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const list = this.listeners.get(type) ?? [];
    if (!list.some((l) => l.fn === fn && l.capture === capture)) list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  /** @param {string} type @param {Function} fn @param {boolean | { capture?: boolean }} [options] */
  removeEventListener(type, fn, options) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => !(l.fn === fn && l.capture === capture)),
    );
  }
  /** @returns {Target[]} this target and every target above it, nearest first */
  path() {
    return [this];
  }
  /**
   * @param {any} event a plain object with a `type`; `target`, `currentTarget` and `eventPhase` are written on it
   * @returns {boolean} false when a listener called `preventDefault`
   */
  dispatchEvent(event) {
    const flags = arm(event, this);
    const path = this.path();
    const page = /** @type {any} */ (this).page;
    /** @param {Listener} l @param {Target} at */
    const call = (l, at) => (page ? loudly(page, () => l.fn.call(at, event)) : l.fn.call(at, event));
    /** @param {Target} at @param {(l: Listener) => boolean} which @param {number} phase */
    const run = (at, which, phase) => {
      if (flags.stopped) return;
      event.currentTarget = at;
      event.eventPhase = phase;
      for (const l of [...(at.listeners.get(event.type) ?? [])].filter(which)) call(l, at);
    };
    for (const at of [...path].reverse().slice(0, -1)) run(at, (l) => l.capture, 1);
    run(this, () => true, 2);
    if (event.bubbles) for (const at of path.slice(1)) run(at, (l) => !l.capture, 3);
    return !(flags.prevented || event.defaultPrevented);
  }
}

/**
 * Readies a plain event object for dispatch at `target`: its target, unless it has one, and a `preventDefault` and
 * `stopPropagation`, unless it has them, that set the returned flags.
 *
 * @param {any} event
 * @param {Target} target
 * @returns {{ stopped: boolean, prevented: boolean }}
 */
function arm(event, target) {
  const flags = { stopped: false, prevented: false };
  if (!event.target) event.target = target;
  if (!event.preventDefault) event.preventDefault = () => void (flags.prevented = true);
  if (!event.stopPropagation) event.stopPropagation = () => void (flags.stopped = true);
  return flags;
}

/**
 * A node of the fake document: an element (`nodeType` 1) or text (`nodeType` 3). What the constructor hands back is
 * the node seen through `tracking`.
 */
class PageNode extends Target {
  /** @param {any} page @param {number} nodeType @param {string} name @param {string | null} ns */
  constructor(page, nodeType, name, ns) {
    super();
    this.page = page;
    this.ownerDocument = page.doc;
    this.nodeType = nodeType;
    this.localName = name;
    this.namespaceURI = ns;
    this.nodeName = nodeType === 3 ? "#text" : ns === HTML_NS ? name.toUpperCase() : name;
    this.tagName = this.nodeName;
    /** @type {any[]} */
    this.childNodes = [];
    /** @type {any} */
    this.parentNode = null;
    /** @type {Map<string, string>} */
    this.attrs = new Map();
    const self = new Proxy(this, tracking(page));
    RAW.set(self, this);
    this.style = inlineStyle(page, () => self);
    this.data = "";
    return self;
  }
  path() {
    /** @type {Target[]} */
    const up = [];
    for (let n = /** @type {any} */ (this); n; n = n.parentNode) up.push(n);
    if (up[up.length - 1] === this.page.doc) up.push(this.page.win);
    return up;
  }
  get isConnected() {
    return this.path().includes(this.page.doc);
  }
  get nodeValue() {
    return this.nodeType === 3 ? this.data : null;
  }
  set nodeValue(v) {
    if (this.nodeType === 3) this.data = String(v);
  }
  get textContent() {
    return this.nodeType === 3 ? this.data : this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(v) {
    if (this.nodeType === 3) {
      this.data = String(v);
      return;
    }
    for (const kid of [...this.childNodes]) this.removeChild(kid);
    if (v != null && v !== "") this.appendChild(this.page.doc.createTextNode(String(v)));
  }
  get innerHTML() {
    return serialize(this);
  }
  set innerHTML(html) {
    for (const kid of [...this.childNodes]) this.removeChild(kid);
    parseInto(this.page.doc, this, String(html));
  }
  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get nextSibling() {
    const kin = this.parentNode?.childNodes ?? [];
    return kin[kin.indexOf(this) + 1] ?? null;
  }
  get previousSibling() {
    const kin = this.parentNode?.childNodes ?? [];
    return kin[kin.indexOf(this) - 1] ?? null;
  }
  /** @param {any} node @param {any} before */
  insertBefore(node, before) {
    node.parentNode?.removeChild(node);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node);
    node.parentNode = this;
    return node;
  }
  /** @param {any} node */
  appendChild(node) {
    return this.insertBefore(node, null);
  }
  /** @param {...any} nodes */
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === "string" ? this.page.doc.createTextNode(n) : n);
  }
  /** @param {any} node */
  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
    if (this.page.doc.activeElement === node || node.contains?.(this.page.doc.activeElement)) {
      this.page.doc.activeElement = this.page.doc.body;
    }
    return node;
  }
  /** @param {any} node @param {any} old */
  replaceChild(node, old) {
    this.insertBefore(node, old);
    return this.removeChild(old);
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  /** @param {any} other */
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  /** @param {string} name @param {unknown} value */
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  /** @param {string} name */
  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }
  /** @param {string} name */
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  /** @param {string} name */
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  /** @param {string | null} _ns @param {string} name @param {unknown} value */
  setAttributeNS(_ns, name, value) {
    this.setAttribute(name, value);
  }
  /** @param {string | null} _ns @param {string} name */
  removeAttributeNS(_ns, name) {
    this.removeAttribute(name);
  }
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  set id(v) {
    this.setAttribute("id", v);
  }
  get className() {
    return this.getAttribute("class") ?? "";
  }
  set className(v) {
    this.setAttribute("class", v);
  }
  get classList() {
    const attrs = /** @type {Map<string, string>} */ ((RAW.get(this) ?? this).attrs);
    const names = () => (attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
    const write = (/** @type {string[]} */ list) => this.setAttribute("class", [...new Set(list)].join(" "));
    const shown = () => (isDark(this.page) ? [] : names());
    return {
      contains: (/** @type {string} */ c) => shown().includes(c),
      add: (/** @type {string[]} */ ...cs) => write([...names(), ...cs]),
      remove: (/** @type {string[]} */ ...cs) => write(names().filter((c) => !cs.includes(c))),
      /** @param {string} c @param {boolean} [force] */
      toggle: (c, force) => {
        const on = force ?? !names().includes(c);
        write(on ? [...names(), c] : names().filter((n) => n !== c));
        return on;
      },
      /** @param {string} a @param {string} b */
      replace: (a, b) => write(names().map((n) => (n === a ? b : n))),
      get length() {
        return shown().length;
      },
    };
  }
  get dataset() {
    const attrs = /** @type {Map<string, string>} */ ((RAW.get(this) ?? this).attrs);
    const attr = (/** @type {string | symbol} */ key) => `data-${kebab(String(key))}`;
    const read = (/** @type {string | symbol} */ key) => (isDark(this.page) ? undefined : attrs.get(attr(key)));
    return new Proxy(
      {},
      {
        get: (_t, key) => (typeof key === "string" ? read(key) : undefined),
        set: (_t, key, value) => {
          this.setAttribute(attr(key), value);
          return true;
        },
        deleteProperty: (_t, key) => {
          this.removeAttribute(attr(key));
          return true;
        },
        has: (_t, key) => read(key) !== undefined,
        ownKeys: () =>
          isDark(this.page)
            ? []
            : [...attrs.keys()]
                .filter((k) => k.startsWith("data-"))
                .map((k) => k.slice(5).replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase())),
        getOwnPropertyDescriptor: (_t, key) =>
          read(key) === undefined ? undefined : { configurable: true, enumerable: true, value: read(key) },
      },
    );
  }
  /** @param {string} selector */
  matches(selector) {
    return matcher(selector)(this);
  }
  /** @param {string} selector */
  closest(selector) {
    const test = matcher(selector);
    for (let n = /** @type {any} */ (this); n && n.nodeType === 1; n = n.parentNode) if (test(n)) return n;
    return null;
  }
  /** @param {string} selector */
  querySelector(selector) {
    return descendants(this).find(matcher(selector)) ?? null;
  }
  /** @param {string} selector */
  querySelectorAll(selector) {
    return descendants(this).filter(matcher(selector));
  }
  /** @param {string} name */
  getElementsByTagName(name) {
    return this.querySelectorAll(name);
  }
  getBoundingClientRect() {
    const { boxes, boxOf } = this.page;
    return { ...(boxes.get(this) ?? (boxOf ? rectOf(boxOf(this)) : rectOf({}))) };
  }
  getClientRects() {
    return [this.getBoundingClientRect()];
  }
  get clientWidth() {
    return this.getBoundingClientRect().width;
  }
  get clientHeight() {
    return this.getBoundingClientRect().height;
  }
  get offsetWidth() {
    return this.getBoundingClientRect().width;
  }
  get offsetHeight() {
    return this.getBoundingClientRect().height;
  }
  focus() {
    if (this.page.doc.activeElement !== this) moveFocus(this.page.doc, this);
  }
  blur() {
    if (this.page.doc.activeElement === this) moveFocus(this.page.doc, null);
  }
}

/** Focus leaves `from` for `to` (null: the body). @param {any} doc @param {any} to @param {any} [from] */
function moveFocus(doc, to, from = doc.activeElement === doc.body ? null : doc.activeElement) {
  for (const type of ["blur", "focusout"]) from?.dispatchEvent({ type, bubbles: type !== "blur", relatedTarget: to });
  doc.activeElement = to ?? doc.body;
  for (const type of ["focus", "focusin"]) to?.dispatchEvent({ type, bubbles: type !== "focus", relatedTarget: from });
}

/**
 * The window's ResizeObserver: each observed element reported once on the clock's next frame, and again on every
 * `resize` of it, its content box never below zero.
 *
 * @param {any} page
 */
function resizeObserverOf(page) {
  return class ResizeObserver {
    /** @param {(entries: object[], observer: ResizeObserver) => void} report */
    constructor(report) {
      this.report = report;
      /** @type {Set<any>} */
      this.watched = new Set();
    }
    /** @param {any} el */
    observe(el) {
      if (this.watched.has(el)) return;
      this.watched.add(el);
      page.observers.add(this);
      let reported = false;
      const first = () => void (!reported && (reported = true) && this.watched.has(el) && this.deliver(el));
      page.queued.push(first);
      page.clock.requestAnimationFrame(first);
    }
    /** @param {any} el */
    unobserve(el) {
      this.watched.delete(el);
    }
    disconnect() {
      this.watched.clear();
      page.observers.delete(this);
    }
    /** @param {any} el */
    deliver(el) {
      const box = el.getBoundingClientRect();
      const px = (/** @type {string} */ prop) => parseFloat(el.style[prop]) || 0;
      const edge = (/** @type {string} */ side) => px(`padding${side}`) + px(`border${side}Width`);
      const inset = { left: px("paddingLeft"), top: px("paddingTop") };
      const width = Math.max(0, box.width - edge("Left") - edge("Right"));
      const height = Math.max(0, box.height - edge("Top") - edge("Bottom"));
      const contentRect = rectOf({ x: inset.left, y: inset.top, width, height });
      const contentBoxSize = [{ inlineSize: width, blockSize: height }];
      const borderBoxSize = [{ inlineSize: box.width, blockSize: box.height }];
      this.report([{ target: el, contentRect, contentBoxSize, borderBoxSize }], this);
    }
  };
}

//: The page's address.
const LOCATION = Object.freeze({
  protocol: "http:",
  hostname: "page.test",
  host: "page.test",
  port: "",
  origin: "http://page.test",
  href: "http://page.test/",
  pathname: "/",
  search: "",
  hash: "",
});

/**
 * A computed style of `el` as a page with no stylesheet has it: its inline style, every other property empty.
 *
 * @param {any} el
 */
const computedStyle = (el) =>
  new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === "getPropertyValue") return (/** @type {string} */ name) => el.style.getPropertyValue(name);
        return typeof key === "string" ? el.style[key] : undefined;
      },
    },
  );

/**
 * The window: timers handed to the page's clock, a pixel ratio of `dpr`, and the window members the page code reads.
 *
 * @param {any} page
 * @param {number} dpr
 * @returns {any}
 */
function windowOf(page, dpr) {
  const clock = /** @type {Clock} */ (page.clock);
  const win = Object.assign(new Target(), {
    devicePixelRatio: dpr,
    innerWidth: VIEW_W,
    innerHeight: VIEW_H,
    scrollX: 0,
    scrollY: 0,
    location: { ...LOCATION },
    performance: { now: () => clock.now() },
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => clock.setTimeout(fn, ms ?? 0),
    clearTimeout: (/** @type {unknown} */ h) => clock.clearTimeout(h),
    setInterval: (/** @type {() => void} */ fn, /** @type {number} */ ms) => clock.setInterval(fn, ms),
    clearInterval: (/** @type {unknown} */ h) => clock.clearInterval(h),
    requestAnimationFrame: (/** @type {(now: number) => void} */ fn) => clock.requestAnimationFrame(fn),
    cancelAnimationFrame: (/** @type {unknown} */ h) => clock.clearTimeout(h),
    queueMicrotask: (/** @type {() => void} */ fn) => clock.queueMicrotask(fn),
    // Both take the browser's two forms, `(x, y)` or one `{ left, top }` options object.
    /** @param {number | ScrollToOptions} [x] @param {number} [y] */
    scrollBy(x, y) {
      const to = typeof x === "object" ? x : { left: x, top: y };
      win.scrollX += to.left ?? 0;
      win.scrollY += to.top ?? 0;
    },
    /** @param {number | ScrollToOptions} [x] @param {number} [y] */
    scrollTo(x, y) {
      const to = typeof x === "object" ? x : { left: x ?? 0, top: y ?? 0 };
      win.scrollX = to.left ?? win.scrollX;
      win.scrollY = to.top ?? win.scrollY;
    },
    getComputedStyle: computedStyle,
    /** @param {string} media */
    matchMedia: (media) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: resizeObserverOf(page),
    OffscreenCanvas: class OffscreenCanvas {
      /** @param {number} width @param {number} height */
      constructor(width, height) {
        page.canvases.push(asCanvas(page.ledgers, this, width, height));
      }
    },
  });
  return win;
}

/**
 * The document of `win`, its `html`, `head` and `body` in place and nothing in the body yet.
 *
 * @param {any} page
 * @param {any} win
 * @returns {any}
 */
function documentOf(page, win) {
  /** @param {string} name @param {string | null} ns */
  const element = (name, ns) =>
    quietly(page, () => {
      const el = new PageNode(page, 1, ns === HTML_NS ? name.toLowerCase() : name, ns);
      if (ns === "http://www.w3.org/2000/svg") Object.assign(el, { getBBox: () => el.getBoundingClientRect() });
      if (el.localName !== "canvas") return el;
      page.canvases.push(el);
      return asCanvas(page.ledgers, el, CANVAS_W, CANVAS_H);
    });
  /** @type {any} */
  const doc = Object.assign(new Target(), {
    nodeType: 9,
    defaultView: win,
    path: () => [doc, win],
    hidden: Boolean(page.hidden),
    /** @param {string} name */
    createElement: (name) => element(name, HTML_NS),
    /** @param {string | null} ns @param {string} name */
    createElementNS: (ns, name) => element(name, ns),
    /** @param {string} text */
    createTextNode: (text) =>
      quietly(page, () => Object.assign(new PageNode(page, 3, "#text", null), { data: String(text) })),
    /** @param {string} id */
    getElementById: (id) => descendants(doc.documentElement).find((el) => el.getAttribute("id") === id) ?? null,
    /** @param {string} selector */
    querySelector: (selector) => doc.documentElement.querySelector(selector),
    /** @param {string} selector */
    querySelectorAll: (selector) => doc.documentElement.querySelectorAll(selector),
    /** @param {any} other */
    contains: (other) => doc.documentElement.contains(other),
  });
  Object.defineProperty(doc, "visibilityState", { get: () => (doc.hidden ? "hidden" : "visible") });
  page.doc = doc;
  quietly(page, () => {
    const root = doc.createElement("html");
    root.parentNode = doc;
    const head = root.appendChild(doc.createElement("head"));
    const body = root.appendChild(doc.createElement("body"));
    Object.assign(doc, { documentElement: root, head, body, activeElement: body, childNodes: [root] });
  });
  return doc;
}

/**
 * A fake document and its window, handed to the code under test; nothing is installed on `globalThis`.
 *
 * @param {{ clock: Clock, html?: string, dpr?: number, hidden?: boolean, boxOf?: (el: any) => Partial<Rect> }} opts
 * @returns {{ doc: any, win: any, resize: (el: any, rect: Partial<Rect>) => void, ledger: (canvas: object) => LedgerRow[], asked: (kind: string) => number, settle: () => void, setHidden: (hidden: boolean) => void, mark: () => void, writes: () => any[], darken: () => void, within: (el: any, inside: any) => boolean, rotation: (el: any) => number }}
 */
export function fakePage(opts) {
  const { clock, html = "", dpr = 1, hidden = false, boxOf } = opts;
  const page = /** @type {any} */ ({ clock, hidden, boxOf, queued: [], boxes: new Map(), observers: new Set() });
  Object.assign(page, { ledgers: new WeakMap(), canvases: [], written: new Set(), dark: false, inside: 0 });
  const win = windowOf(page, dpr);
  const doc = documentOf(page, win);
  page.win = win;
  win.document = doc;
  quietly(page, () => parseInto(doc, doc.body, html));
  queues.set(doc, page.queued);
  return {
    doc,
    win,
    resize(el, rect) {
      page.boxes.set(el, rectOf(rect));
      for (const observer of [...page.observers]) if (observer.watched.has(el)) observer.deliver(el);
    },
    ledger: (canvas) => [...(page.ledgers.get(canvas) ?? [])],
    asked: (kind) =>
      page.canvases
        .flatMap((/** @type {object} */ canvas) => page.ledgers.get(canvas) ?? [])
        .filter((/** @type {any} */ row) => row.call === "getContext" && row.args[0] === kind).length,
    mark: () => void page.written.clear(),
    writes: () =>
      quietly(page, () => {
        const root = doc.documentElement;
        return [root, ...descendants(root)].filter((el) => page.written.has(el));
      }),
    darken: () => void (page.dark = true),
    within: (el, inside) => quietly(page, () => inside.contains(el)),
    rotation: (el) =>
      quietly(page, () => {
        const turned = rotateOf(el.getAttribute("transform"));
        return Number.isNaN(turned) ? rotateOf(el.style.transform) : turned;
      }),
    settle() {
      for (let pass = 0; page.queued.length > 0; pass += 1) {
        if (pass === 1000) throw new Error("settle: the page still queues work after 1000 passes");
        for (const fn of page.queued.splice(0)) fn();
      }
    },
    setHidden(next) {
      doc.hidden = next;
      doc.dispatchEvent({ type: "visibilitychange" });
    },
  };
}

//: Each page's queued re-renders, after-paints and first resize reports, by its document.
const queues = /** @type {WeakMap<object, Array<() => void>>} */ (new WeakMap());
//: The global preact builds nodes through, as an optional member: under `node --test` there is none.
const env = /** @type {{ document?: unknown }} */ (globalThis);
let hosted = /** @type {object | null} */ (null);

/** Host `page` as the header says; returns its release. @param {ReturnType<typeof fakePage>} page @returns {() => void} */
export function hostPage(page) {
  if (hosted) throw new Error("hostPage: a page is already hosted; release it first");
  const hooks = /** @type {any} */ (preactOptions);
  const was = [Object.getOwnPropertyDescriptor(env, "document"), hooks.debounceRendering, hooks.requestAnimationFrame];
  const queue = queues.get(page.doc) ?? [];
  env.document = page.doc;
  hooks.debounceRendering = hooks.requestAnimationFrame = (/** @type {() => void} */ fn) => void queue.push(fn);
  hosted = page;
  return () => {
    if (hosted !== page) return;
    if (was[0]) Object.defineProperty(env, "document", was[0]);
    else delete env.document;
    [, hooks.debounceRendering, hooks.requestAnimationFrame] = was;
    hosted = null;
  };
}
