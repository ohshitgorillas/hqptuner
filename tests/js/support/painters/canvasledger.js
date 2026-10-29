// Canvases for a page mounted into tests/js/support/painters/livedom.js, and a ledger of every drawing context asked
// of them. No test() and no assert lives here.
//
// `canvasLedger()`, called after the live document is installed, makes every canvas the page creates through that
// document answer `getContext`, and counts each ask by the kind of context asked for. A "2d" ask is answered by a
// tests/js/support/raster.js context; a "webgl2" ask by a WebGL2 context that draws nothing, whose shaders compile and
// whose programs link, every create call handing back a fresh object; any other kind by null. A painter takes its
// context from its canvas, so two runs that paint alike ask alike unless one of them set up more painters. The page
// also reads `getComputedStyle` and `devicePixelRatio` off the document's window, its `defaultView`; the ledger puts
// them there, as a 1x screen with no stylesheet loaded has them, until it is uninstalled.

import { glContext } from "../page/canvas.js";
import { rasterCanvas } from "../raster.js";

//: The size of every raster context handed out, pixels.
const W = 64;
const H = 32;

/** A computed style as a page with no stylesheet loaded has it: every property empty. */
const unstyled = () =>
  new Proxy(
    {},
    { get: (_t, key) => (key === "getPropertyValue" ? () => "" : typeof key === "string" ? "" : undefined) },
  );

//: What a page sizing and coloring its canvases reads off its window, as a 1x screen with no stylesheet has it.
const WINDOW = /** @type {[string, unknown][]} */ ([
  ["getComputedStyle", unstyled],
  ["devicePixelRatio", 1],
]);

/**
 * Makes every canvas the installed document creates answer `getContext`, and counts the asks; puts WINDOW on the
 * document's `defaultView` until `uninstall()` puts back what it replaced.
 *
 * @returns {{ asked: (kind: string) => number, uninstall: () => void }}
 */
export function canvasLedger() {
  const doc = /** @type {any} */ (globalThis.document);
  /** @type {Record<string, unknown>} */
  const win = doc.defaultView;
  /** @type {Map<string, PropertyDescriptor | undefined>} */
  const prior = new Map();
  for (const [name, value] of WINDOW) {
    prior.set(name, Object.getOwnPropertyDescriptor(win, name));
    Object.defineProperty(win, name, { configurable: true, writable: true, value });
  }
  /** @type {Map<string, number>} */
  const asks = new Map();
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
    const gl = glContext(el, () => ({ width: W, height: H }));
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
        if (descriptor) Object.defineProperty(win, name, descriptor);
        else Reflect.deleteProperty(win, name);
      }
    },
  };
}
