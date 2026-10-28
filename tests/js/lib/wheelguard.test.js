// Behavioral suite for lib/dom.js wheelGuard — the policy that the mouse wheel
// never changes a control's value. The wheel over a control scrolls the page and
// nothing else: the event's default action is canceled every time, whatever the
// control's state, and the control is never blurred (blurring a number box
// mid-type commits a half-typed figure through its change handler).
//
// The control lives on a fake page from tests/js/support/page.js, and the guard
// reaches that page through the control itself; the event is a plain object
// carrying exactly the surface a wheel event exposes to the handler, its target
// and current target the control, as when the wheel arrives over the control its
// guard is on. The window's `scrollBy` records each scroll it is asked for.
//
// The same file holds the other half of what a typed box promises the user,
// lib/dom.js useSyncWhenIdle: a box the user is typing in keeps what they typed
// when a render brings a new value, and a box they are not in shows the new
// value. The hook is mounted through preact's own client render, since server
// rendering runs no effects; its host binds the returned ref to a box on a fake
// page, as preact binds an element's `ref`. Effects after paint run through
// preact's `options.requestAnimationFrame` seam, flushed by hand once each render
// returns, so no frame timer runs. Focus is the box's own document's
// `activeElement`, moved by the box's `focus()`.
//
// preact's client render compares its host with the global `document` before it
// mounts, so for the length of each render call alone the global holds a
// stand-in that throws on any member read, and is taken away after.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/wheelguard.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { h, options, render } from "preact";

import { useSyncWhenIdle, wheelGuard } from "../../../hqptuner/static/lib/dom.js";
import { fakeClock } from "../support/clock.js";
import { fakePage } from "../support/page.js";

/**
 * The global preact's render compares its host with, viewed as an optional
 * member: under `node --test` there is none, and the DOM lib declares it as
 * always present and fully shaped.
 *
 * @type {{ document?: unknown }}
 */
const env = globalThis;

/** A global document no code may read: every member read throws, naming the member. */
const UNREADABLE = new Proxy(
  {},
  {
    get(_target, key) {
      throw new Error(`the global document was read: ${String(key)}`);
    },
  },
);

/**
 * Run preact's render with the unreadable stand-in on the global, then take it away again.
 *
 * @param {() => void} run
 */
function withRenderGlobal(run) {
  env.document = UNREADABLE;
  try {
    run();
  } finally {
    delete env.document;
  }
}

/** @returns {ReturnType<typeof fakePage>} */
const newPage = () => fakePage({ clock: fakeClock().clock });

/**
 * The control the wheel arrives over, recording whether anything blurred it.
 *
 * @typedef {{ blurred: boolean, blur(): void }} Control
 */

/**
 * A wheel event as the guard reads one: the members it touches, plus the
 * cancellation flag a case reads back.
 *
 * @typedef {{ target: Control, currentTarget: Control, deltaY: number, deltaMode: number,
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
  const page = newPage();
  const el = page.doc.createElement("input");
  page.doc.body.appendChild(el);
  const unfocus = el.blur.bind(el);
  /** @type {Control} */
  const target = Object.assign(el, {
    blurred: false,
    blur() {
      target.blurred = true;
      unfocus();
    },
  });
  if (focused) el.focus();
  /** @type {WheelSeam} */
  const event = {
    target,
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
  page.win.scrollBy = (/** @type {number} */ x, /** @type {number} */ y) => scrolls.push([x, y]);
  return { target, event: asWheelEvent(event), scrolls };
}

/** @type {{ firstChild: null, childNodes: never[] } | null} */
let host = null;

afterEach(() => {
  const mounted = host;
  if (mounted) withRenderGlobal(() => render(null, mounted));
  host = null;
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

// Blurring a number box commits what it holds, so a wheel that blurred a box
// mid-type would change its value.
test("test_a_wheel_over_a_focused_control_leaves_it_focused", () => {
  const { target, event } = setup({ focused: true });
  wheelGuard(event);
  assert.equal(target.blurred, false);
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

// --- a typed box syncs from the store only while the user is not in it ----------

/**
 * A typed box as the hook reads one: the member it writes.
 *
 * @typedef {{ value: string }} Box
 */

/**
 * An empty text box on a fresh page, nothing on that page focused.
 *
 * @returns {Box & { focus(): void }}
 */
function typedBox() {
  const page = newPage();
  const box = page.doc.createElement("input");
  Object.assign(box, { type: "text", value: "" });
  page.doc.body.appendChild(box);
  return box;
}

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
  const mounted = host || { firstChild: null, childNodes: [] };
  host = mounted;
  /** @type {Array<() => void>} */
  const effects = [];
  const raf = options.requestAnimationFrame;
  options.requestAnimationFrame = (/** @type {() => void} */ run) => effects.push(run);
  try {
    withRenderGlobal(() => render(h(Synced, { value, box }), mounted));
  } finally {
    options.requestAnimationFrame = raf;
  }
  for (const run of effects) run();
}

test("test_a_focused_box_keeps_its_typed_text_across_a_render_bringing_a_new_value", () => {
  const box = typedBox();
  paint(5, box);
  box.focus();
  box.value = "-1";
  paint(7, box);
  assert.equal(box.value, "-1");
});

test("test_an_unfocused_box_shows_the_value_of_its_first_render", () => {
  const box = typedBox();
  paint(5, box);
  assert.equal(box.value, "5");
});

test("test_an_unfocused_box_shows_the_new_value_after_a_render", () => {
  const box = typedBox();
  paint(5, box);
  paint(7, box);
  assert.equal(box.value, "7");
});
