import { render } from "preact";
import { fakeClock } from "./clock.js";
import { useEventSource } from "./eventsource.js";
import { stagingWire, quiesce } from "./wire/wire.js";

class PageNode {
  /** @param {string} name */
  constructor(name) {
    this.localName = name;
    this.nodeType = name === "#text" ? 3 : 1;
    /** @type {PageNode[]} */
    this.childNodes = [];
    /** @type {PageNode | null} */
    this.parentNode = null;
    /** @type {Record<string, string>} */
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    /** @type {Array<{ name: string, value: string }>} */
    this.attributes = [];
    this.data = "";
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  /** @param {PageNode} node @param {PageNode | null} before */
  insertBefore(node, before) {
    node.parentNode?.removeChild(node);
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  /** @param {PageNode} node */
  appendChild(node) {
    return this.insertBefore(node, null);
  }
  /** @param {PageNode} node */
  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  closest() {
    return null;
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
    return { x: 0, y: 0, width: 1000, height: 800, top: 0, left: 0, bottom: 800, right: 1000 };
  }
}

/** @param {PageNode} root */
function pageDocument(root) {
  return {
    hidden: false,
    documentElement: new PageNode("html"),
    body: new PageNode("body"),
    /** @param {string} id */
    getElementById: (id) => (id === "app" ? root : null),
    /** @param {string} name */
    createElement: (name) => new PageNode(name),
    /** @param {string} _namespace @param {string} name */
    createElementNS: (_namespace, name) => new PageNode(name),
    /** @param {string} text */
    createTextNode: (text) => Object.assign(new PageNode("#text"), { data: text }),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

/** Install a page for one boot test; its caller owns cleanup even when importing the app fails. */
export function installBootPage() {
  const root = new PageNode("div");
  const fake = fakeClock();
  /** @type {Array<(now: number) => void>} */
  let frames = [];
  /** @type {Map<string, PropertyDescriptor | undefined>} */
  const prior = new Map();
  /** @param {string} name @param {unknown} value */
  const install = (name, value) => {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  install("document", pageDocument(root));
  install("window", { addEventListener() {}, removeEventListener() {}, innerWidth: 1000, innerHeight: 800 });
  install("location", { hostname: "boot.test" });
  install("HTMLLinkElement", PageNode);
  install(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  install("performance", { now: fake.clock.now });
  install("setTimeout", fake.clock.setTimeout);
  install("clearTimeout", fake.clock.clearTimeout);
  install("setInterval", fake.clock.setInterval);
  install("clearInterval", fake.clock.clearInterval);
  install("queueMicrotask", fake.clock.queueMicrotask);
  install("requestAnimationFrame", (/** @type {(now: number) => void} */ fn) => frames.push(fn));
  install("EventSource", undefined);
  install("fetch", undefined);
  useEventSource();
  const wire = stagingWire();
  return {
    /** @param {number} ms */
    runFrame(ms) {
      fake.advance(ms - fake.clock.now());
      const pending = frames;
      frames = [];
      for (const fn of pending) fn(fake.clock.now());
    },
    async cleanup() {
      try {
        await quiesce(wire);
        render(null, /** @type {HTMLElement} */ (/** @type {unknown} */ (root)));
      } finally {
        frames = [];
        for (const [name, descriptor] of prior) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else Reflect.deleteProperty(globalThis, name);
        }
      }
    },
  };
}
