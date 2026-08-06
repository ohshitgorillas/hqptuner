// Behavioral suite for lib/dom.js userEdit — a slider edit is honored only with
// explicit user provenance. On macOS a scroll gesture over a range input injects
// a value change at platform level and dispatches NO wheel event: an `input`
// event simply appears on the control. Separately, a right-click during a drag
// eats the pointerup, and the slider keeps editing with no button held. The
// policy under test: the wrapped handler runs only while the user demonstrably
// holds a pointer on the element or has just pressed a slider key on it;
// anything else is refused and the control snaps back to the canonical value.
//
// Provenance is tracked by document-capture listeners dom.js installs at module
// load, so a document must exist BEFORE the import — hence the dynamic import
// below rather than a static one, which node would hoist above the setup. The
// fake document records what dom.js registers and replays events to it the way
// the browser's capture phase would; the events are plain objects carrying
// exactly the surface those listeners read. Elements are fresh per test, and
// provenance is per element, so no test can lend state to the next.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/useredit.test.js

import test from "node:test";
import assert from "node:assert/strict";

const registered = new Map();
globalThis.document = {
  addEventListener(type, fn) {
    registered.set(type, [...(registered.get(type) || []), fn]);
  },
};

const { userEdit } = await import("../../../hqptuner/static/lib/dom.js");

// One document-level event, delivered to every listener dom.js registered for
// its type — the browser's capture phase, which sees the event whatever element
// it targets.
function documentSees(type, target, extra = {}) {
  const event = { type, target, ...extra };
  for (const fn of registered.get(type) || []) fn(event);
}

const press = (el) => documentSees("pointerdown", el, { button: 0, buttons: 1 });
const rightPress = (el) => documentSees("pointerdown", el, { button: 2, buttons: 2 });
const release = (el) => documentSees("pointerup", el, { buttons: 0 });
const cancel = (el) => documentSees("pointercancel", el, { buttons: 0 });
const glide = (el, buttons) => documentSees("pointermove", el, { buttons });
const keydown = (el, key) => documentSees("keydown", el, { key });

// A browser announces a focus change twice, and a document-level capture listener
// sees both: `focus`/`blur` (which do not bubble but are capturable) and
// `focusin`/`focusout` (which bubble). Both spellings are delivered, in the order
// a browser fires them, so a case states "the element was focused" rather than
// which of the two the implementation chose to listen for. A slider keystroke
// carries provenance only while the element holds focus (the whole of that gate
// is owned by tests/js/lib/useredit-focus.test.js), so every keyboard edit here
// is preceded by the focus a real keystroke implies.
const focus = (el) => {
  documentSees("focus", el, { relatedTarget: null });
  documentSees("focusin", el, { relatedTarget: null });
};

// A range element mid-edit: the browser has already moved its value to 63 by
// the time the input event fires; 50 is the canonical value the app last knew.
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

const SLIDER_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];

// --- edits with provenance go through ------------------------------------------

test("test_input_while_a_pointer_is_held_on_the_slider_is_honored", () => {
  const { el, calls, handler } = setup();
  press(el);
  const event = fire(handler, el, "input");
  assert.deepEqual(calls, [event]);
});

// A track click: pointerdown jumps the thumb, the input event lands between the
// down and the up.
test("test_input_between_pointerdown_and_pointerup_is_honored", () => {
  const { el, calls, handler } = setup();
  press(el);
  fire(handler, el, "input");
  release(el);
  assert.equal(calls.length, 1);
});

for (const key of SLIDER_KEYS) {
  test(`test_input_after_${key}_keydown_on_the_slider_is_honored`, () => {
    const { el, calls, handler } = setup();
    focus(el);
    keydown(el, key);
    fire(handler, el, "input");
    assert.equal(calls.length, 1);
  });
}

test("test_the_change_following_a_key_honored_input_is_honored_too", () => {
  const { el, calls, handler } = setup();
  focus(el);
  keydown(el, "ArrowUp");
  fire(handler, el, "input");
  fire(handler, el, "change");
  assert.equal(calls.length, 2);
});

// A native range fires its committing change AFTER pointerup, so releasing the
// drag must arm exactly that one change.
test("test_the_change_arriving_after_pointerup_is_honored", () => {
  const { el, calls, handler } = setup();
  press(el);
  fire(handler, el, "input");
  release(el);
  fire(handler, el, "change");
  assert.equal(calls.length, 2);
});

test("test_the_release_arm_is_one_shot_a_second_change_is_refused", () => {
  const { el, calls, handler } = setup();
  press(el);
  fire(handler, el, "input");
  release(el);
  fire(handler, el, "change");
  fire(handler, el, "change");
  assert.equal(calls.length, 2);
});

// --- edits without provenance are refused ---------------------------------------

test("test_input_with_no_held_pointer_and_no_slider_key_is_not_honored", () => {
  const { el, calls, handler } = setup();
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

test("test_a_refused_input_resets_the_value_to_canonical", () => {
  const { el, handler } = setup();
  fire(handler, el, "input");
  assert.equal(el.value, "50");
});

test("test_the_change_trailing_a_refused_input_is_refused_too", () => {
  const { el, calls, handler } = setup();
  fire(handler, el, "input");
  fire(handler, el, "change");
  assert.deepEqual(calls, []);
});

// The stuck drag: a right-click mid-drag eats the pointerup, but the next
// pointermove reports no button held — that clears the held state.
test("test_a_buttonless_pointermove_ends_the_drag_so_later_input_is_refused", () => {
  const { el, calls, handler } = setup();
  press(el);
  glide(el, 0);
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

// A real drag: the pointer moves across the slider with the button still down.
// The held state must survive those moves — an implementation clearing held on
// every pointermove would refuse the very edits a drag produces.
test("test_a_pointermove_with_the_button_held_keeps_the_drag_alive", () => {
  const { el, calls, handler } = setup();
  press(el);
  glide(el, 1);
  fire(handler, el, "input");
  assert.equal(calls.length, 1);
});

// The realistic stuck-drag shape: after the right-click eats the pointerup, the
// pointer has wandered off the control, so the buttonless move targets some
// other element — it must still clear the slider's held state.
test("test_a_buttonless_pointermove_on_another_element_still_ends_the_drag", () => {
  const { el, calls, handler } = setup();
  const other = { tagName: "DIV" };
  press(el);
  glide(other, 0);
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

test("test_a_refused_change_resets_the_value_to_canonical", () => {
  const { el, handler } = setup();
  fire(handler, el, "change");
  assert.equal(el.value, "50");
});

// The element holds focus, so the KEY is the only thing that varies: a focused
// slider, a non-slider key, nothing armed. Leaving `el` unfocused here would
// confound "not a slider key" with "no focus", and the case would pass against
// an implementation that armed on ANY key so long as it kept the focus gate.
for (const key of ["a", "Tab"]) {
  test(`test_a_${key}_keydown_does_not_arm_the_slider`, () => {
    const { el, calls, handler } = setup();
    focus(el);
    keydown(el, key);
    fire(handler, el, "input");
    assert.deepEqual(calls, []);
  });
}

// The key arm is one-shot: the honored input+change pair consumes it, so a
// further input on the same element with no new keydown and no held pointer
// carries no provenance.
test("test_a_key_arm_is_consumed_by_its_input_change_pair", () => {
  const { el, calls, handler } = setup();
  focus(el);
  keydown(el, "ArrowUp");
  fire(handler, el, "input");
  fire(handler, el, "change");
  fire(handler, el, "input");
  assert.equal(calls.length, 2);
});

// A cancelled pointer (touch stolen by scroll, pointer capture lost) never
// delivers a pointerup — pointercancel must clear the held state itself.
test("test_pointercancel_clears_the_held_pointer_so_later_input_is_refused", () => {
  const { el, calls, handler } = setup();
  press(el);
  cancel(el);
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

// The element under test holds focus, and the keydown lands on a DIFFERENT
// slider — so the target is the only thing that varies. Leaving `el` unfocused
// here would confound "wrong target" with "no focus", and the case would pass
// against an implementation that armed on ANY slider keydown.
test("test_a_slider_keydown_on_a_different_element_lends_no_provenance", () => {
  const { el, calls, handler } = setup();
  const other = { tagName: "INPUT", type: "range", value: "10" };
  focus(el);
  keydown(other, "ArrowUp");
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

// Only the PRIMARY button grants held provenance: a right-click lands as a
// pointerdown too, but it opens a context menu, not a drag — an input riding on
// it carries no user intent to edit.
test("test_a_right_button_pointerdown_lends_no_provenance", () => {
  const { el, calls, handler } = setup();
  rightPress(el);
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

// A contextmenu on the slider ends any edit gesture: whatever pointer was held,
// the user is now in the menu, so a trailing input carries no provenance.
test("test_a_contextmenu_revokes_the_held_pointer_so_later_input_is_refused", () => {
  const { el, calls, handler } = setup();
  press(el);
  documentSees("contextmenu", el);
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});

test("test_a_pointer_held_on_a_different_element_lends_no_provenance", () => {
  const { el, calls, handler } = setup();
  const other = { tagName: "INPUT", type: "range", value: "10" };
  press(other);
  fire(handler, el, "input");
  assert.deepEqual(calls, []);
});
