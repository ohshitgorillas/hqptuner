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

/**
 * The globals the guard reads, viewed as optional members: under `node --test`
 * there are none, and the DOM lib declares both as always present and fully
 * shaped. This view is what lets a case install a stand-in and take it away.
 *
 * @type {{ document?: unknown, window?: unknown }}
 */
const env = globalThis;

/**
 * The control the wheel arrives over, recording whether anything blurred it.
 *
 * @typedef {{ blurred: boolean, blur(): void }} Control
 */

/**
 * A wheel event as the guard reads one: the members it touches, plus the
 * cancellation flag a case reads back.
 *
 * @typedef {{ currentTarget: Control, deltaY: number, deltaMode: number,
 *   defaultPrevented: boolean, preventDefault(): void }} WheelSeam
 */

/**
 * The seam as the guard's declared parameter. A WheelEvent carries far more
 * than the guard reads, so the stand-in is handed over as the declared type.
 *
 * @param {WheelSeam} e
 * @returns {WheelEvent}
 */
const asWheelEvent = (e) => /** @type {WheelEvent} */ (/** @type {unknown} */ (e));

/**
 * @param {{ focused: boolean, deltaY?: number, deltaMode?: number }} spec
 * @returns {{ target: Control, event: WheelEvent, scrolls: number[][] }}
 */
function setup({ focused, deltaY = 120, deltaMode = 0 }) {
  /** @type {Control} */
  const target = {
    blurred: false,
    blur() {
      this.blurred = true;
    },
  };
  /** @type {WheelSeam} */
  const event = {
    currentTarget: target,
    deltaY,
    deltaMode,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  /** @type {number[][]} */
  const scrolls = [];
  env.document = { activeElement: focused ? target : null };
  env.window = { scrollBy: (/** @type {number} */ x, /** @type {number} */ y) => scrolls.push([x, y]) };
  return { target, event: asWheelEvent(event), scrolls };
}

afterEach(() => {
  delete env.document;
  delete env.window;
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
