// Behavioral suite for lib/dom.js wheelGuard — the policy that the mouse wheel
// never changes a control's value. The wheel over a control scrolls the page and
// nothing else: the event's default action is cancelled every time, whatever the
// control's state, and the control is never blurred (blurring a number box
// mid-type commits a half-typed figure through its change handler).
//
// document and window are environment seams; the event is a plain object
// carrying exactly the surface a wheel event exposes to the handler. Both
// globals are restored after every test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/wheelguard.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { wheelGuard } from "../../../hqptuner/static/lib/dom.js";

function setup({ focused, deltaY = 120, deltaMode = 0 }) {
  const target = {
    blurred: false,
    blur() {
      this.blurred = true;
    },
  };
  const event = {
    currentTarget: target,
    deltaY,
    deltaMode,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  const scrolls = [];
  globalThis.document = { activeElement: focused ? target : null };
  globalThis.window = { scrollBy: (x, y) => scrolls.push([x, y]) };
  return { target, event, scrolls };
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

// --- the wheel never edits the control ----------------------------------------

test("test_a_wheel_over_a_control_is_cancelled", () => {
  const { event } = setup({ focused: false });
  wheelGuard(event);
  assert.equal(event.defaultPrevented, true);
});

test("test_a_wheel_over_a_focused_control_is_cancelled_too", () => {
  const { event } = setup({ focused: true });
  wheelGuard(event);
  assert.equal(event.defaultPrevented, true);
});

// --- the page gets the wheel instead --------------------------------------------

test("test_the_page_scrolls_once_by_the_wheel_delta", () => {
  const { event, scrolls } = setup({ focused: false });
  wheelGuard(event);
  assert.deepEqual(scrolls, [[0, 120]]);
});

test("test_a_focused_control_scrolls_the_page_the_same_way", () => {
  const { event, scrolls } = setup({ focused: true });
  wheelGuard(event);
  assert.deepEqual(scrolls, [[0, 120]]);
});

// A line-mode wheel (deltaMode 1) reports its delta in LINES, not pixels; the
// guard hands the raw figure to scrollBy without converting it.
test("test_the_raw_delta_is_passed_through_whatever_its_unit", () => {
  const { event, scrolls } = setup({ focused: false, deltaY: 3, deltaMode: 1 });
  wheelGuard(event);
  assert.deepEqual(scrolls, [[0, 3]]);
});

// --- the control keeps its focus -------------------------------------------------
//
// Both of these are ABSENCE assertions and neither constrains anything on its
// own: a wheelGuard with an empty body passes them. They are spec item 5 and
// worth stating — blurring a number box mid-type commits a half-typed figure —
// but the weight is carried by the cancel and scroll cases above, which fail on
// a guard that does nothing.

test("test_an_unfocused_control_is_not_blurred", () => {
  const { target, event } = setup({ focused: false });
  wheelGuard(event);
  assert.equal(target.blurred, false);
});

test("test_a_focused_control_is_not_blurred", () => {
  const { target, event } = setup({ focused: true });
  wheelGuard(event);
  assert.equal(target.blurred, false);
});
