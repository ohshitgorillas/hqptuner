// Write tracking and darkening for the fake page's nodes (tests/js/support/page.js). No test() and no assert lives here.
//
// Every write to a node is kept: `setAttribute`, `removeAttribute`, any assignment to an element property, any
// assignment to or `setProperty` on its `style`, `classList` changes. Building the page, parsing its `html` and moving
// nodes in the tree are not writes. `writes()` is the attached elements written since the last `mark()`, each once, in
// document order. `darken()` makes every read an element answers come back as if the document were empty: queries find
// nothing; attributes, properties, `dataset`, `classList` and style read absent; no nodes, no text, every box empty.
// Writes still land, methods can still be called, and `writes`, `within` and `rotation` still see them. `within(el,
// inside)` is whether `el` is `inside` or under it. `rotation(el)` is the angle `el` was last turned to, degrees
// clockwise from upright: the first argument of `rotate(...)` in its `transform` attribute, else its style's
// `transform`, unit deg, rad, grad or turn (none means degrees), NaN when it carries none.
//
// The page object these take holds `written`, the set of nodes written, `dark`, set by `darken()`, and `inside`, how
// deep the page's own work is nested; a read made inside the page's own work is never darkened and a write made there
// is not kept.

/** @typedef {{ x: number, y: number, width: number, height: number, top: number, left: number, right: number, bottom: number }} Rect */

/** @param {Partial<Rect>} r @returns {Rect} */
export function rectOf(r) {
  const x = r.x ?? r.left ?? 0;
  const y = r.y ?? r.top ?? 0;
  const width = r.width ?? 0;
  const height = r.height ?? 0;
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

/** @param {string} prop */
export const kebab = (prop) => (prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`));

//: Degrees in one of each unit `rotate(...)` takes; no unit means degrees.
const UNITS = /** @type {Record<string, number>} */ ({ "": 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 });

/**
 * The angle of the first `rotate(...)` in a transform, degrees clockwise from upright; NaN when it carries none.
 *
 * @param {unknown} transform
 * @returns {number}
 */
export function rotateOf(transform) {
  if (typeof transform !== "string") return NaN;
  const m = /rotate\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(deg|rad|grad|turn)?/i.exec(transform);
  if (!m) return NaN;
  return Number(m[1]) * UNITS[(m[2] ?? "").toLowerCase()];
}

/**
 * Runs `fn` as the page's own work: its reads are never darkened and its writes are not kept.
 *
 * @template T
 * @param {any} page
 * @param {() => T} fn
 * @returns {T}
 */
export function quietly(page, fn) {
  page.inside += 1;
  try {
    return fn();
  } finally {
    page.inside -= 1;
  }
}

/**
 * Runs `fn`, code under test called back from the page's own work, with its reads darkened and its writes kept again.
 *
 * @template T
 * @param {any} page
 * @param {() => T} fn
 * @returns {T}
 */
export function loudly(page, fn) {
  const was = page.inside;
  page.inside = 0;
  try {
    return fn();
  } finally {
    page.inside = was;
  }
}

/** Whether a read made now answers as if the document were empty. @param {any} page */
export const isDark = (page) => page.dark && page.inside === 0;

/**
 * An inline style: properties by their CSS name, read and written as camelCase or kebab-case members, through
 * `setProperty`/`getPropertyValue`/`removeProperty`, or whole through `cssText`. Every write is kept as a write to
 * `owner()`; in a darkened page every read is empty.
 *
 * @param {any} page
 * @param {() => object} owner
 * @returns {Record<string, any>}
 */
export function inlineStyle(page, owner) {
  /** @type {Map<string, string>} */
  const props = new Map();
  const wrote = () => void page.written.add(owner());
  const api = {
    /** @param {string} name @param {unknown} value */
    setProperty: (name, value) => {
      wrote();
      if (value == null || value === "") props.delete(name);
      else props.set(name, String(value));
    },
    /** @param {string} name */
    getPropertyValue: (name) => (isDark(page) ? "" : (props.get(name) ?? "")),
    /** @param {string} name */
    removeProperty: (name) => {
      wrote();
      const was = isDark(page) ? "" : (props.get(name) ?? "");
      props.delete(name);
      return was;
    },
  };
  return new Proxy(api, {
    get: (target, key) => {
      if (typeof key !== "string") return undefined;
      if (key in target) return /** @type {any} */ (target)[key];
      if (key === "length") return isDark(page) ? 0 : props.size;
      if (isDark(page)) return "";
      if (key === "cssText") return [...props].map(([k, v]) => `${k}: ${v};`).join(" ");
      return props.get(kebab(key)) ?? "";
    },
    set: (_target, key, value) => {
      if (typeof key !== "string") return false;
      wrote();
      if (key === "cssText") {
        props.clear();
        for (const decl of String(value).split(";")) {
          const at = decl.indexOf(":");
          if (at > 0) props.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
        }
      } else api.setProperty(kebab(key), value);
      return true;
    },
  });
}

//: The node behind each tracked node, so a node's own `classList` and `dataset` read its attributes undarkened.
export const RAW = /** @type {WeakMap<object, any>} */ (new WeakMap());

//: Calls on a node that are writes to it.
const WRITE_CALLS = new Set(["setAttribute", "removeAttribute", "setAttributeNS", "removeAttributeNS"]);

//: Members of a node a darkened page still answers: what the node is and where it lives, not what it holds.
const KEPT = new Set([
  "page",
  "ownerDocument",
  "nodeType",
  "localName",
  "namespaceURI",
  "nodeName",
  "tagName",
  "listeners",
  "style",
]);

/** @returns {Rect} */
const noBox = () => rectOf({});

//: What each read a node answers in a darkened page, made fresh on each read: no nodes, no text, no attributes, no box.
const DARK_READS = /** @type {Record<string, () => unknown>} */ ({
  childNodes: () => [],
  children: () => [],
  firstChild: () => null,
  lastChild: () => null,
  firstElementChild: () => null,
  nextSibling: () => null,
  previousSibling: () => null,
  parentNode: () => null,
  parentElement: () => null,
  isConnected: () => false,
  textContent: () => "",
  innerHTML: () => "",
  data: () => "",
  nodeValue: () => "",
  attrs: () => new Map(),
  attributes: () => [],
  id: () => "",
  className: () => "",
  clientWidth: () => 0,
  clientHeight: () => 0,
  offsetWidth: () => 0,
  offsetHeight: () => 0,
  getAttribute: () => () => null,
  hasAttribute: () => () => false,
  matches: () => () => false,
  closest: () => () => null,
  contains: () => () => false,
  querySelector: () => () => null,
  querySelectorAll: () => () => [],
  getElementsByTagName: () => () => [],
  getBoundingClientRect: () => noBox,
  getClientRects: () => () => [noBox()],
});

/**
 * Whether a darkened page reads the node's own member `key` as absent: data it holds, not what it is or a method.
 *
 * @param {any} target
 * @param {string} key
 */
const hidesOwn = (target, key) => Object.hasOwn(target, key) && !KEPT.has(key) && typeof target[key] !== "function";

/**
 * The traps that keep a node's writes and darken its reads. A call to one of the node's own methods runs as the
 * page's own work; a call on `WRITE_CALLS` and any assignment to a member is a write to the node.
 *
 * @param {any} page
 * @returns {ProxyHandler<any>}
 */
export function tracking(page) {
  return {
    get(target, key, receiver) {
      if (typeof key !== "string" || page.inside > 0) return Reflect.get(target, key, receiver);
      if (page.dark && Object.hasOwn(DARK_READS, key)) return DARK_READS[key]();
      if (page.dark && hidesOwn(target, key)) return undefined;
      const own = Object.hasOwn(target, key);
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || own || key === "constructor") return value;
      return (/** @type {unknown[]} */ ...args) => {
        if (WRITE_CALLS.has(key)) page.written.add(receiver);
        return quietly(page, () => value.apply(receiver, args));
      };
    },
    set(target, key, value, receiver) {
      if (page.inside > 0) return Reflect.set(target, key, value, receiver);
      page.written.add(receiver);
      return quietly(page, () => Reflect.set(target, key, value, receiver));
    },
  };
}
