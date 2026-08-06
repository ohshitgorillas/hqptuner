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
// only the focus gate on the key arm, in that file's shape: a fake document
// installed BEFORE the import, because dom.js registers its capture listeners at
// module load, and events replayed to those listeners the way the capture phase
// delivers them.
//
// A browser announces a focus change twice, and a document-level capture
// listener sees both: `focus`/`blur` (which do not bubble but are capturable)
// and `focusin`/`focusout` (which bubble). Both are delivered here, in the order
// a browser fires them, so a case states "the element was focused" rather than
// which of the two spellings the implementation chose to listen for.
//
// `document.activeElement` is not used and not asserted on anywhere: on the
// engine this behaviour exists for it reports BODY for a keydown the slider is
// the target of, so it cannot answer the question.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/useredit-focus.test.js

import test from "node:test";
import assert from "node:assert/strict";

const registered = new Map();
globalThis.document = {
  addEventListener(type, fn) {
    registered.set(type, [...(registered.get(type) || []), fn]);
  },
};

const { userEdit } = await import("../../../hqptuner/static/lib/dom.js");

function documentSees(type, target, extra = {}) {
  const event = { type, target, ...extra };
  for (const fn of registered.get(type) || []) fn(event);
}

const focus = (el) => {
  documentSees("focus", el, { relatedTarget: null });
  documentSees("focusin", el, { relatedTarget: null });
};
const blur = (el) => {
  documentSees("blur", el, { relatedTarget: null });
  documentSees("focusout", el, { relatedTarget: null });
};
const keydown = (el, key) => documentSees("keydown", el, { key });
const press = (el) => documentSees("pointerdown", el, { button: 0, buttons: 1 });

// A range element mid-edit: the browser has already moved its value to 63 by the
// time the input event fires; 50 is the canonical value the app last knew.
function setup() {
  const el = { tagName: "INPUT", type: "range", value: "63" };
  const calls = [];
  const handler = userEdit(50, (ev) => calls.push(ev));
  return { el, calls, handler };
}

function fire(handler, el, type) {
  const event = { type, target: el, currentTarget: el };
  handler(event);
  return event;
}

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

test("test_an_input_refused_for_want_of_focus_snaps_back_to_canonical", () => {
  const { el, handler } = setup();
  keydown(el, "ArrowRight");
  fire(handler, el, "input");
  assert.equal(el.value, "50");
});

test("test_the_change_following_an_unfocused_keydown_is_refused_too", () => {
  const { el, calls, handler } = setup();
  keydown(el, "ArrowRight");
  fire(handler, el, "input");
  fire(handler, el, "change");
  assert.deepEqual(calls, []);
});

// --- with focus, the existing arming behaviour is unchanged ----------------------

for (const key of ARROWS) {
  test(`test_a_${key}_keydown_on_a_focused_slider_arms_the_input`, () => {
    const { el, calls, handler } = setup();
    focus(el);
    keydown(el, key);
    fire(handler, el, "input");
    assert.equal(calls.length, 1);
  });
}

test("test_the_change_closing_a_focused_key_edit_is_honored", () => {
  const { el, calls, handler } = setup();
  focus(el);
  keydown(el, "ArrowUp");
  fire(handler, el, "input");
  fire(handler, el, "change");
  assert.equal(calls.length, 2);
});

test("test_a_focused_key_arm_is_consumed_by_its_input_change_pair", () => {
  const { el, calls, handler } = setup();
  focus(el);
  keydown(el, "ArrowUp");
  fire(handler, el, "input");
  fire(handler, el, "change");
  fire(handler, el, "input");
  assert.equal(calls.length, 2);
});

// --- the licence does not outlive the focus --------------------------------------

test("test_a_keydown_after_the_slider_is_blurred_arms_nothing", () => {
  const { el, calls, handler } = setup();
  focus(el);
  blur(el);
  keydown(el, "ArrowUp");
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

// --- the pointer route is not focus-gated ----------------------------------------
// A user pressing the thumb has demonstrated intent whether or not the browser
// moved focus there, so the held-pointer provenance must not be narrowed by this
// change.

test("test_a_held_pointer_still_honors_an_input_on_an_unfocused_slider", () => {
  const { el, calls, handler } = setup();
  press(el);
  fire(handler, el, "input");
  assert.equal(calls.length, 1);
});
