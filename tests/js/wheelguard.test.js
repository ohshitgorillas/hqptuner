// Behavioral suite for lib/dom.js wheelGuard — the focus-gated wheel policy on
// native range/number inputs: an engaged control takes the wheel, an unengaged
// one hands it back to the page.
//
// document and window are environment seams; the event is a plain object
// carrying exactly the surface a wheel event exposes to the handler. Both
// globals are restored after every test.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/wheelguard.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { wheelGuard } from "../../hqptuner/static/lib/dom.js";

function setup({ focused }) {
  const target = {
    blurred: false,
    blur() {
      this.blurred = true;
    },
  };
  const event = {
    currentTarget: target,
    deltaY: 120,
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

// --- an engaged control owns the wheel ----------------------------------------

test("test_a_focused_control_keeps_the_wheel", () => {
  const { event } = setup({ focused: true });
  wheelGuard(event);
  assert.equal(event.defaultPrevented, false);
});

test("test_a_focused_control_is_not_blurred", () => {
  const { target, event } = setup({ focused: true });
  wheelGuard(event);
  assert.equal(target.blurred, false);
});

test("test_a_focused_control_does_not_scroll_the_page", () => {
  const { event, scrolls } = setup({ focused: true });
  wheelGuard(event);
  assert.deepEqual(scrolls, []);
});

// --- an unengaged control hands the wheel to the page ---------------------------

test("test_an_unengaged_control_blocks_the_value_change", () => {
  const { event } = setup({ focused: false });
  wheelGuard(event);
  assert.equal(event.defaultPrevented, true);
});

test("test_an_unengaged_control_is_blurred", () => {
  const { target, event } = setup({ focused: false });
  wheelGuard(event);
  assert.equal(target.blurred, true);
});

test("test_the_page_scrolls_by_the_wheel_delta_instead", () => {
  const { event, scrolls } = setup({ focused: false });
  wheelGuard(event);
  assert.deepEqual(scrolls, [[0, 120]]);
});
