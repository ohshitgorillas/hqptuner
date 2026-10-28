// The document seam the two `lib/dom.js` userEdit suites drive provenance
// through, plus the gestures and the wrapped-handler fixture both suites share.
// dom.js attaches its capture listeners to the document handed to
// watchGestures, so this module hands it a fake document that records them and
// replays each gesture to every listener of its type. No global is installed.

import { userEdit, watchGestures } from "../../../hqptuner/static/lib/dom.js";

/**
 * A control as the provenance listeners and the wrapped handler read one: the
 * three members they touch, with the two a bare DIV does not carry optional.
 *
 * @typedef {{ tagName: string, type?: string, value?: string }} ControlSeam
 */

/** @type {Map<string, Function[]>} */
const registered = new Map();

const page = {
  addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
    registered.set(type, [...(registered.get(type) || []), fn]);
  },
};

watchGestures(/** @type {Document} */ (/** @type {unknown} */ (page)));

// One document-level event, delivered to every listener dom.js registered for
// its type — the browser's capture phase, which sees the event whatever element
// it targets.
/**
 * @param {string} type
 * @param {unknown} target
 * @param {Record<string, unknown>} [extra]
 * @returns {void}
 */
export function documentSees(type, target, extra = {}) {
  const event = { type, target, ...extra };
  for (const fn of registered.get(type) || []) fn(event);
}

/** @typedef {import("../../../hqptuner/static/lib/dom.js").ControlEvent} ControlEvent */

/** @param {ControlSeam} el */
export const press = (el) => documentSees("pointerdown", el, { button: 0, buttons: 1 });

/**
 * @param {ControlSeam} el
 * @param {string} key
 */
export const keydown = (el, key) => documentSees("keydown", el, { key });

// A browser announces a focus change twice, and a document-level capture
// listener sees both: `focus`/`blur` (which do not bubble but are capturable)
// and `focusin`/`focusout` (which bubble). Both spellings are delivered, in the
// order a browser fires them, so a case states "the element was focused" rather
// than which of the two the implementation chose to listen for.
/** @param {ControlSeam} el */
export const focus = (el) => {
  documentSees("focus", el, { relatedTarget: null });
  documentSees("focusin", el, { relatedTarget: null });
};

// A range element mid-edit: the browser has already moved its value to 63 by the
// time the input event fires; 50 is the canonical value the app last knew.
/**
 * @returns {{ el: ControlSeam, calls: ControlEvent[], handler: (e: ControlEvent) => void }}
 */
export function setup() {
  /** @type {ControlSeam} */
  const el = { tagName: "INPUT", type: "range", value: "63" };
  /** @type {ControlEvent[]} */
  const calls = [];
  const handler = userEdit(50, (ev) => calls.push(ev));
  return { el, calls, handler };
}

// The event carries exactly the surface the wrapped handler reads, and is handed
// over as the handler's declared parameter.
/**
 * @param {(e: ControlEvent) => void} handler
 * @param {ControlSeam} el
 * @param {string} type
 * @returns {ControlEvent}
 */
export function fire(handler, el, type) {
  const event = /** @type {ControlEvent} */ (/** @type {unknown} */ ({ type, target: el, currentTarget: el }));
  handler(event);
  return event;
}
