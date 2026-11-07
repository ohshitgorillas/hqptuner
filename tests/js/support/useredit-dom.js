// The document seam the two `lib/dom.js` userEdit suites drive provenance
// through, plus the gestures and the wrapped-handler fixture both suites share.
// dom.js attaches its capture listeners to the document handed to
// watchGestures, so this module hands it the document of a fresh fake page
// (tests/js/support/page.js), whose `activeElement` moves on `focus()` and
// `blur()` and whose events run the capture, target and bubble phases. No
// global is installed.

import { userEdit, watchGestures } from "../../../hqptuner/static/lib/dom.js";
import { fakeClock } from "./clock.js";
import { fakePage } from "./page.js";

/**
 * A control as the provenance listeners and the wrapped handler read one: the
 * three members they touch, with the two a bare DIV does not carry optional,
 * and the document it lives in, which userEdit reads its gestures from.
 *
 * @typedef {{ tagName: string, type?: string, value?: string, ownerDocument?: unknown }} ControlSeam
 */

/**
 * A fresh page whose document's gestures dom.js watches.
 *
 * @returns {any}
 */
function watchedPage() {
  const { doc: page } = fakePage({ clock: fakeClock().clock });
  watchGestures(/** @type {Document} */ (page));
  return page;
}

// The document of the case in progress. Every setup() opens a new page, so no
// focus, gesture or listener of an earlier case reaches a later one.
let doc = watchedPage();

//: Gestures a browser fires without bubbling; every other one this seam sends bubbles.
const NON_BUBBLING = new Set(["focus", "blur"]);

// One gesture as the page delivers it. A control of the page receives it as its
// target, so the document's capture listeners see it on the way down; a bare
// stand-in for some other element, which is not in the page, is announced at the
// document itself, which every listener there sees whatever element it targets.
/**
 * @param {string} type
 * @param {unknown} target
 * @param {Record<string, unknown>} [extra]
 * @returns {void}
 */
export function documentSees(type, target, extra = {}) {
  const node = /** @type {any} */ (target);
  const bubbles = !NON_BUBBLING.has(type);
  if (typeof node?.dispatchEvent === "function") node.dispatchEvent({ type, bubbles, ...extra });
  else doc.dispatchEvent({ type, target, bubbles, ...extra });
}

/** @typedef {import("../../../hqptuner/static/lib/dom.js").ControlEvent} ControlEvent */

/** @param {ControlSeam} el */
export const press = (el) => documentSees("pointerdown", el, { button: 0, buttons: 1 });

/**
 * @param {ControlSeam} el
 * @param {string} key
 */
export const keydown = (el, key) => documentSees("keydown", el, { key });

// Focus moves the way a browser moves it: the page's `activeElement` becomes the
// control, and the page fires `blur`/`focusout` on the element losing focus, then
// `focus`/`focusin` on the control, so a case states "the element was focused"
// rather than which signal the implementation chose to read.
/** @param {ControlSeam} el */
export const focus = (el) => /** @type {any} */ (el).focus();

// A range element mid-edit: the browser has already moved its value to 63 by the
// time the input event fires; 50 is the canonical value the app last knew.
/**
 * @returns {{ el: ControlSeam, calls: ControlEvent[], handler: (e: ControlEvent) => void }}
 */
export function setup() {
  doc = watchedPage();
  /** @type {ControlSeam} */
  const el = doc.body.appendChild(doc.createElement("input"));
  el.type = "range";
  el.value = "63";
  /** @type {ControlEvent[]} */
  const calls = [];
  // The control's own handler runs its edit through userEdit, naming the control
  // whose document's gestures decide it.
  /** @param {ControlEvent} ev */
  const handler = (ev) => userEdit(/** @type {Element} */ (/** @type {unknown} */ (el)), "50", () => calls.push(ev));
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
