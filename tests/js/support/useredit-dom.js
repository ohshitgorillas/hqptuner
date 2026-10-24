import { domEvent } from "./wheel.js";

/** @typedef {{ tagName: string, type?: string, value?: string }} ControlSeam */
/** @typedef {import("../../../hqptuner/static/lib/dom.js").ControlEvent} ControlEvent */

/** @type {Map<string, Array<(event: unknown) => void>>} */
const listeners = new Map();
/** @type {typeof import("../../../hqptuner/static/lib/dom.js").userEdit | undefined} */
let userEdit;

/** Install capture listeners with a temporary document, restoring the prior global even if import fails. */
export async function installUserEdit() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      /** @param {string} type @param {(event: unknown) => void} listener */
      addEventListener(type, listener) {
        const registered = listeners.get(type) || [];
        registered.push(listener);
        listeners.set(type, registered);
      },
    },
  });
  try {
    ({ userEdit } = await import("../../../hqptuner/static/lib/dom.js"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

/** @param {string} type @param {ControlSeam} el @param {Record<string, unknown>} [fields] */
export function documentSees(type, el, fields = {}) {
  const event = domEvent(type, el, fields);
  for (const listener of listeners.get(type) || []) listener(event);
}

/** @param {ControlSeam} el */
export function focus(el) {
  documentSees("focus", el, { relatedTarget: null });
  documentSees("focusin", el, { relatedTarget: null });
}

/** @param {ControlSeam} el @param {string} key */
export const keydown = (el, key) => documentSees("keydown", el, { key });

/** @param {ControlSeam} el */
export const press = (el) => documentSees("pointerdown", el, { button: 0, buttons: 1 });

/** Create a fresh control whose canonical value differs from the browser's pending edit. */
export function setup() {
  if (!userEdit) throw new Error("installUserEdit must run before setup");
  const el = { tagName: "INPUT", type: "range", value: "75" };
  /** @type {ControlEvent[]} */
  const calls = [];
  const handler = userEdit("50", (event) => void calls.push(event));
  return { el, calls, handler };
}

/** @param {(event: ControlEvent) => void} handler @param {ControlSeam} el @param {string} type */
export function fire(handler, el, type) {
  const event = /** @type {ControlEvent} */ (/** @type {unknown} */ (domEvent(type, el)));
  handler(event);
  return event;
}
