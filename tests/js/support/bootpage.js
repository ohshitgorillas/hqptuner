// The browser the entry module (hqptuner/static/app.js) boots in, for the suites that ask what the app runs once it has
// started. Importing this module installs, before anything of HQPTuner's loads, the platform surface the boot reaches:
// a document holding the mount element and the favicon link, elements enough for preact to render the frame into,
// the layout observers and media queries the frame's effects read, a fetch that answers every path with an empty JSON
// object, the EventSource fake (tests/js/support/eventsource.js) and the storage fake (tests/js/support/storage.js).
//
// Wall time is the page's own: `performance.now()` reads it and an animation frame is handed it, and it moves only
// when a suite runs the frames the page has asked for through `runFrame(ms)`. Nothing of HQPTuner's is stubbed.
//
// No test() and no assert lives here. Not a *.test.js file on purpose: the runner glob would execute it.

import "./domseam.js";
import { useEventSource } from "./eventsource.js";
import { useStorage } from "./storage.js";

/**
 * The globals this module installs, viewed as optional, loosely typed members: the DOM lib declares each one as
 * always present and fully shaped, which these stand-ins are not.
 *
 * @type {Record<string, any>}
 */
const env = globalThis;

/** A DOM node with the surface preact and the frame's effects reach: a tree, attributes, a style, no layout. */
class FakeNode {
  /**
   * @param {string} name
   * @param {number} [type]
   */
  constructor(name, type = 1) {
    this.nodeName = name;
    this.localName = name;
    this.nodeType = type;
    this.data = "";
    /** @type {FakeNode[]} */
    this.childNodes = [];
    /** @type {FakeNode | null} */
    this.parentNode = null;
    /** @type {Record<string, string>} */
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.ownerDocument = env.document;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  /** @param {FakeNode} child */
  appendChild(child) {
    return this.insertBefore(child, null);
  }

  /**
   * @param {FakeNode} child
   * @param {FakeNode | null} before
   */
  insertBefore(child, before) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    if (at < 0) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }

  /** @param {FakeNode} child */
  removeChild(child) {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  /**
   * @param {string} name
   * @param {unknown} value
   */
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  /**
   * @param {string | null} _ns
   * @param {string} name
   * @param {unknown} value
   */
  setAttributeNS(_ns, name, value) {
    this.setAttribute(name, value);
  }

  /** @param {string} name */
  removeAttribute(name) {
    delete this.attributes[name];
  }

  /** @param {string} name */
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  /** @param {string} name */
  hasAttribute(name) {
    return name in this.attributes;
  }

  addEventListener() {}
  removeEventListener() {}
  focus() {}
  blur() {}
  closest() {
    return null;
  }
  matches() {
    return false;
  }
  contains() {
    return false;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getContext() {
    return null;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

class FakeLink extends FakeNode {
  constructor() {
    super("link");
  }
}

/** The page's wall time, ms. */
let now = 0;

/** The animation frames the page has asked for and not yet been handed, by handle. @type {Map<number, (ms: number) => void>} */
let asked = new Map();
let handles = 0;

env.window = globalThis;
env.addEventListener = () => {};
env.removeEventListener = () => {};
env.HTMLLinkElement = FakeLink;
env.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
env.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
env.getComputedStyle = () => ({ getPropertyValue: () => "" });
env.location = { href: "http://hqptuner.test/", origin: "http://hqptuner.test", pathname: "/", search: "", hash: "" };
Object.defineProperty(globalThis, "performance", {
  value: { now: () => now },
  configurable: true,
  writable: true,
});
env.requestAnimationFrame = (/** @type {(ms: number) => void} */ fn) => {
  handles += 1;
  asked.set(handles, fn);
  return handles;
};
env.cancelAnimationFrame = (/** @type {number} */ handle) => void asked.delete(handle);
env.fetch = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

const mount = new FakeNode("div");
Object.assign(env.document, {
  readyState: "complete",
  documentElement: new FakeNode("html"),
  getElementById: (/** @type {string} */ id) => (id === "favicon" ? new FakeLink() : mount),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (/** @type {string} */ name) => new FakeNode(name),
  createElementNS: (/** @type {string} */ _ns, /** @type {string} */ name) => new FakeNode(name),
  createTextNode: (/** @type {string} */ text) => Object.assign(new FakeNode("#text", 3), { data: text }),
});

useEventSource();
useStorage();

/**
 * Move the page's wall time to `ms` and hand every animation frame asked for before then that time, as the browser
 * does at a frame. A frame asked for while they run waits for the next call.
 *
 * @param {number} ms
 */
export function runFrame(ms) {
  now = ms;
  const due = asked;
  asked = new Map();
  for (const fn of due.values()) fn(ms);
}
