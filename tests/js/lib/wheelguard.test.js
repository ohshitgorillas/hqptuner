// Behavioral suite for lib/dom.js wheelGuard — the policy that the mouse wheel
// never changes a control's value. The wheel over a control scrolls the page and
// nothing else: the event's default action is canceled every time, whatever the
// control's state, and the control is never blurred (blurring a number box
// mid-type commits a half-typed figure through its change handler).
//
// document and window are environment seams; the event is a plain object
// carrying exactly the surface a wheel event exposes to the handler. Both
// globals are restored after every test.
//
// The same file holds the other half of what a typed box promises the user,
// lib/dom.js useSyncWhenIdle: a box the user is typing in keeps what they typed
// when a render brings a new value, and a box they are not in shows the new
// value. The hook is mounted through preact's own client render, since server
// rendering runs no effects; its host binds the returned ref to a plain box
// carrying the one member the hook writes, as preact binds an element's `ref`.
// Effects after paint run through preact's `options.requestAnimationFrame`
// seam, flushed by hand once each render returns, so no frame timer runs.
// Focus is `document.activeElement`, the environment seam the hook reads.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/wheelguard.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { h, options, render } from "preact";

import { useSyncWhenIdle, wheelGuard } from "../../../hqptuner/static/lib/dom.js";

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

/** @type {{ firstChild: null, childNodes: never[] } | null} */
let host = null;

afterEach(() => {
  if (host) render(null, host);
  host = null;
  delete env.document;
  delete env.window;
});

// --- the wheel never edits the control ----------------------------------------

test("test_a_wheel_over_a_control_is_canceled", () => {
  const { event } = setup({ focused: false });
  wheelGuard(event);
  assert.equal(event.defaultPrevented, true);
});

test("test_a_wheel_over_a_focused_control_is_canceled_too", () => {
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

// --- a typed box syncs from the store only while the user is not in it ----------

/**
 * A typed box as the hook reads one: the member it writes.
 *
 * @typedef {{ value: string }} Box
 */

/**
 * The hook's host: binds the returned ref to `box`, as preact binds an element's `ref`.
 *
 * @param {{ value: string | number | null, box: Box }} props
 */
function Synced({ value, box }) {
  /** @type {{ current: unknown }} */ (/** @type {unknown} */ (useSyncWhenIdle(value))).current = box;
  return null;
}

/**
 * Render the host with `value` over `box`, then run the effects the browser runs after the paint.
 *
 * @param {unknown} value
 * @param {Box} box
 */
function paint(value, box) {
  host = host || { firstChild: null, childNodes: [] };
  /** @type {Array<() => void>} */
  const effects = [];
  const raf = options.requestAnimationFrame;
  options.requestAnimationFrame = (/** @type {() => void} */ run) => effects.push(run);
  try {
    render(h(Synced, { value, box }), host);
  } finally {
    options.requestAnimationFrame = raf;
  }
  for (const run of effects) run();
}

test("test_a_focused_box_keeps_its_typed_text_across_a_render_bringing_a_new_value", () => {
  /** @type {Box} */
  const box = { value: "" };
  env.document = { activeElement: null };
  paint(5, box);
  const shown = box.value;
  env.document = { activeElement: box };
  box.value = "-1";
  paint(7, box);
  assert.deepEqual([shown, box.value], ["5", "-1"]);
});

test("test_an_unfocused_box_shows_the_new_value_after_a_render", () => {
  /** @type {Box} */
  const box = { value: "" };
  env.document = { activeElement: null };
  paint(5, box);
  paint(7, box);
  assert.equal(box.value, "7");
});
