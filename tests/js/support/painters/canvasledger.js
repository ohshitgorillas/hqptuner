// Canvases for a page mounted into tests/js/support/painters/livedom.js, and a ledger of every drawing context asked
// of them. No test() and no assert lives here.
//
// `canvasLedger()`, called after the live document is installed, makes every canvas the page creates through that
// document answer `getContext`, and counts each ask by the kind of context asked for. A "2d" ask is answered by a
// tests/js/support/raster.js context; a "webgl2" ask by a WebGL2 context that draws nothing, whose shaders compile and
// whose programs link, every create call handing back a fresh object; any other kind by null. A painter takes its
// context from its canvas, so two runs that paint alike ask alike unless one of them set up more painters. The page
// also reads `getComputedStyle` and `devicePixelRatio` off the window, which node lacks; the ledger puts them there,
// as a 1x screen with no stylesheet loaded has them, until it is uninstalled.

import { rasterCanvas } from "../raster.js";

//: The size of every raster context handed out, pixels.
const W = 64;
const H = 32;

//: What the WebGL2 context answers, by method, where the answer is not nothing.
const GL_ANSWERS = /** @type {Record<string, (...args: any[]) => unknown>} */ ({
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getShaderInfoLog: () => "",
  getProgramInfoLog: () => "",
  getAttribLocation: () => 0,
  getParameter: () => 4096,
  getError: () => 0,
  isContextLost: () => false,
  getExtension: () => null,
  getSupportedExtensions: () => [],
});

/**
 * A WebGL2 context on `canvas`: every upper-case name a constant of its own, every create call a fresh object, the
 * answers in GL_ANSWERS, and nothing from every other method.
 *
 * @param {unknown} canvas
 */
function glContext(canvas) {
  /** @type {Map<string, number>} */
  const constants = new Map();
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        const name = String(key);
        if (name === "canvas") return canvas;
        if (name === "drawingBufferWidth") return W;
        if (name === "drawingBufferHeight") return H;
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
          if (!constants.has(name)) constants.set(name, 0x10000 + constants.size);
          return constants.get(name);
        }
        if (name in GL_ANSWERS) return GL_ANSWERS[name];
        if (name.startsWith("create") || name === "getUniformLocation") return () => ({});
        return () => undefined;
      },
    },
  );
}

/** A computed style as a page with no stylesheet loaded has it: every property empty. */
const unstyled = () =>
  new Proxy(
    {},
    { get: (_t, key) => (key === "getPropertyValue" ? () => "" : typeof key === "string" ? "" : undefined) },
  );

//: The window globals a page sizing and coloring its canvases reads, as a 1x screen with no stylesheet has them.
const WINDOW = /** @type {[string, unknown][]} */ ([
  ["getComputedStyle", unstyled],
  ["devicePixelRatio", 1],
]);

/**
 * Makes every canvas the installed document creates answer `getContext`, and counts the asks; puts the WINDOW globals
 * on the global until `uninstall()` puts back what they replaced.
 *
 * @returns {{ asked: (kind: string) => number, uninstall: () => void }}
 */
export function canvasLedger() {
  /** @type {Map<string, PropertyDescriptor | undefined>} */
  const prior = new Map();
  for (const [name, value] of WINDOW) {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  /** @type {Map<string, number>} */
  const asks = new Map();
  const doc = /** @type {any} */ (globalThis.document);
  const create = doc.createElement;
  const createNS = doc.createElementNS;
  doc.createElement = (/** @type {string} */ name) => withContexts(create(name), name);
  doc.createElementNS = (/** @type {string | null} */ ns, /** @type {string} */ name) =>
    withContexts(createNS(ns, name), name);
  /**
   * @param {any} el
   * @param {string} name
   */
  function withContexts(el, name) {
    if (String(name).toLowerCase() !== "canvas") return el;
    const flat = rasterCanvas(W, H).getContext();
    const gl = glContext(el);
    el.getContext = (/** @type {string} */ kind) => {
      asks.set(kind, (asks.get(kind) ?? 0) + 1);
      if (kind === "2d") return flat;
      return kind === "webgl2" ? gl : null;
    };
    return el;
  }
  return {
    asked: (kind) => asks.get(kind) ?? 0,
    uninstall: () => {
      for (const [name, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
