// Behavioral suite for the document seam of lib/dom.js: the page hands dom.js its
// document once, at boot, through watchGestures(doc), and from then on userEdit
// honors or refuses a slider edit by the gestures seen on THAT document. No
// global is installed or patched; the document is a fake page's
// (tests/js/support/page.js), handed in the way the page hands in its own.
//
// Each slider is an element of that page, and a gesture is fired at it, so the
// document's capture listeners see it before any handler on the control; focus
// moves the page's `activeElement` and fires the browser's focus events. Events
// are plain objects carrying the surface a pointer, focus or key event exposes.
// Elements are fresh per test and provenance is per element, so no case lends
// state to the next.
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
import { fakeClock } from "../support/clock.js";
import { fakePage } from "../support/page.js";

/** The value the slider is rendering, which a refused edit snaps back to. */
const CANONICAL = 50;
const PRIMARY_BUTTON = 0;
const PRIMARY_HELD = 1;
const NO_BUTTONS = 0;

/** @typedef {{ tagName: string, type: string, value: string, ownerDocument: unknown }} Slider */
const page = fakePage({ clock: fakeClock().clock }).doc;

before(() => watchGestures(/** @type {Document} */ (page)));

/**
 * A gesture fired at `el` the way the page delivers it: it bubbles, and the
 * document's capture listeners see it on the way down to `el`.
 *
 * @param {Slider} el
 * @param {string} type
 * @param {Record<string, unknown>} extra
 */
const sees = (el, type, extra) => /** @type {any} */ (el).dispatchEvent({ type, bubbles: true, ...extra });

/** @returns {{ el: Slider, calls: unknown[], handler: (e: { type: string, target: Slider }) => void }} */
function setup() {
  /** @type {Slider} */
  const el = page.body.appendChild(page.createElement("input"));
  el.type = "range";
  el.value = "73";
  /** @type {unknown[]} */
  const calls = [];
  // The control's own handler runs its edit through userEdit, naming the control
  // whose document's gestures decide it.
  const handler = (/** @type {{ type: string, target: Slider }} */ e) =>
    userEdit(/** @type {Element} */ (/** @type {unknown} */ (el)), String(CANONICAL), () => calls.push(e));
  return { el, calls, handler };
}

/** @param {Slider} el */
const press = (el) => sees(el, "pointerdown", { button: PRIMARY_BUTTON, buttons: PRIMARY_HELD });
/** @param {Slider} el */
const release = (el) => sees(el, "pointerup", { button: PRIMARY_BUTTON, buttons: NO_BUTTONS });
// The page moves its `activeElement` to the slider and fires the browser's
// `focus` and `focusin` at it.
/** @param {Slider} el */
const focus = (el) => /** @type {any} */ (el).focus();

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
  sees(el, "keydown", { key: "ArrowUp" });
  handler({ type: "input", target: el });
  assert.equal(calls.length, 1);
});
