// Behavioral suite for the document seam of lib/dom.js: the page hands dom.js its
// document once, at boot, through watchGestures(doc), and from then on userEdit
// honors or refuses a slider edit by the gestures seen on THAT document. No
// global is installed or patched; the document is a fake handed in, the way the
// page hands in its own.
//
// The fake keeps a table of what was registered on it and replays a gesture to
// every listener of that type, the way the capture phase reaches a document
// listener before any handler on the control. Events are plain objects carrying
// the surface a pointer, focus or key event exposes. Elements are fresh per test
// and provenance is per element, so no case lends state to the next.
//
// This file owns only the seam: that each route to provenance (a held pointer,
// a drag release, a focused slider keystroke) is read from the handed document.
// The rest of the policy is tests/js/lib/useredit.test.js and
// tests/js/lib/useredit-focus.test.js.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/watchgestures.test.js

import test, { before } from "node:test";
import assert from "node:assert/strict";

import { userEdit, watchGestures } from "../../../hqptuner/static/lib/dom.js";

/** The value the slider is rendering, which a refused edit snaps back to. */
const CANONICAL = 50;
const PRIMARY_BUTTON = 0;
const PRIMARY_HELD = 1;
const NO_BUTTONS = 0;

/** @typedef {{ tagName: string, type: string, value: string }} Slider */
/** @typedef {Record<string, unknown> & { type: string, target: unknown }} GestureSeam */
/** @typedef {((e: GestureSeam) => void) | { handleEvent(e: GestureSeam): void }} ListenerSeam */

/**
 * A document as the platform presents one to a listener: listeners registered by
 * type, and a gesture delivered to each of them.
 */
function fakeDocument() {
  /** @type {Map<string, ListenerSeam[]>} */
  const listeners = new Map();
  return {
    /**
     * @param {string} type
     * @param {ListenerSeam} listener
     */
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    /**
     * @param {string} type
     * @param {ListenerSeam} listener
     */
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
    /**
     * @param {string} type
     * @param {unknown} target
     * @param {Record<string, unknown>} [extra]
     */
    sees(type, target, extra = {}) {
      const event = { type, target, ...extra };
      for (const l of listeners.get(type) ?? []) {
        if (typeof l === "function") l(event);
        else l.handleEvent(event);
      }
    },
  };
}

const page = fakeDocument();

before(() => watchGestures(/** @type {Document} */ (/** @type {unknown} */ (page))));

/** @returns {{ el: Slider, calls: unknown[], handler: (e: { type: string, target: Slider }) => void }} */
function setup() {
  /** @type {Slider} */
  const el = { tagName: "INPUT", type: "range", value: "73" };
  /** @type {unknown[]} */
  const calls = [];
  const guarded = userEdit(CANONICAL, (e) => calls.push(e));
  const handler = (/** @type {{ type: string, target: Slider }} */ e) =>
    guarded(/** @type {import("../../../hqptuner/static/lib/dom.js").ControlEvent} */ (/** @type {unknown} */ (e)));
  return { el, calls, handler };
}

/** @param {Slider} el */
const press = (el) => page.sees("pointerdown", el, { button: PRIMARY_BUTTON, buttons: PRIMARY_HELD });
/** @param {Slider} el */
const release = (el) => page.sees("pointerup", el, { button: PRIMARY_BUTTON, buttons: NO_BUTTONS });
/** @param {Slider} el */
const focus = (el) => {
  page.sees("focus", el, { relatedTarget: null });
  page.sees("focusin", el, { relatedTarget: null });
};

test("test_a_pointer_held_on_the_handed_document_lets_a_slider_input_through", () => {
  const { el, calls, handler } = setup();
  press(el);
  handler({ type: "input", target: el });
  assert.equal(calls.length, 1);
});

// Two changes follow the release: the first is the native range's committing
// change and passes on the release arm; the second has no provenance left. A
// guard that never saw the release on the handed document would still count the
// pointer as held and let both through; one that saw nothing lets neither.
test("test_a_drag_released_on_the_handed_document_lets_exactly_its_committing_change_through", () => {
  const { el, calls, handler } = setup();
  press(el);
  release(el);
  handler({ type: "change", target: el });
  handler({ type: "change", target: el });
  assert.equal(calls.length, 1);
});

test("test_a_slider_key_pressed_on_the_handed_document_while_focused_lets_a_slider_input_through", () => {
  const { el, calls, handler } = setup();
  focus(el);
  page.sees("keydown", el, { key: "ArrowUp" });
  handler({ type: "input", target: el });
  assert.equal(calls.length, 1);
});
