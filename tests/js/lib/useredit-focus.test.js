// Behavioral suite for the focus half of lib/dom.js userEdit: a slider KEYSTROKE
// carries provenance only while that element holds focus.
//
// Safari 26.5 on macOS turns a scroll gesture over an element carrying
// `role="slider"` into trusted arrow keydowns aimed at that element, without
// focusing it. A keystroke arm that asks only "was this a slider key on this
// element" therefore hands a page scroll the provenance of a deliberate edit,
// and the value moves under the user. The rule restored: the wheel moves the
// page, and only deliberate user input changes a control's value.
//
// tests/js/lib/useredit.test.js owns the rest of the provenance policy — held
// pointer, release arm, one-shot consumption, the refusals — and this file adds
// only the focus gate on the key arm, driven through the same seam: the fake
// document tests/js/support/useredit-dom.js hands to watchGestures, which
// attaches dom.js's capture listeners to it with no global installed, with
// events delivered through the page's capture, target and bubble phases.
//
// Focus and blur move the page's `activeElement` and fire `focus`/`focusin` or
// `blur`/`focusout` in the order a browser fires them, so a case states "the
// element was focused" rather than which signal the implementation chose to
// read. No case asserts on `document.activeElement` itself.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/useredit-focus.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { focus, keydown, setup, fire } from "../support/useredit-dom.js";

/** @typedef {import("../support/useredit-dom.js").ControlSeam} ControlSeam */

// The page moves its `activeElement` off the slider and fires the browser's
// `blur` and `focusout` at it.
/** @param {ControlSeam} el */
const blur = (el) => /** @type {any} */ (el).blur();

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

// The gate is on a slider KEYSTROKE, not on the arrows alone, so the refusal is
// swept over the whole key set a range input answers to — the same set
// tests/js/lib/useredit.test.js arms with.
const SLIDER_KEYS = [...ARROWS, "Home", "End", "PageUp", "PageDown"];

// --- a keystroke at an unfocused slider arms nothing -----------------------------

for (const key of SLIDER_KEYS) {
  test(`test_a_${key}_keydown_on_an_unfocused_slider_arms_nothing`, () => {
    const { el, calls, handler } = setup();
    keydown(el, key);
    fire(handler, el, "input");
    assert.deepEqual(calls, []);
  });
}

test("test_the_change_following_an_unfocused_keydown_is_refused_too", () => {
  const { el, calls, handler } = setup();
  keydown(el, "ArrowRight");
  fire(handler, el, "input");
  fire(handler, el, "change");
  assert.deepEqual(calls, []);
});

// --- the license does not outlive the focus --------------------------------------

test("test_a_keydown_after_the_slider_is_blurred_arms_nothing", () => {
  const { el, calls, handler } = setup();
  focus(el);
  blur(el);
  keydown(el, "ArrowUp");
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});
