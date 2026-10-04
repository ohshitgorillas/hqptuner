// Behavioral suite for lib/expiry.js: a message that expires is cleared once its
// time has passed, and only when it is due and its expiry was not cancelled.
//
// The clock is faked at the `timers` seam the helper takes (docs/testing.md rule
// 7). Time moves only when a test says so, so nothing here waits on the wall.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/expiry.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { expireIf } from "../../../hqptuner/static/lib/expiry.js";

//: How long the message under test is set to last, in the fake clock's ms.
const MS = 1000;

/**
 * A clock that moves only when told to. Each scheduled callback is a row holding
 * its deadline; cancelling marks the row dead; `advance` runs the live rows that
 * have fallen due.
 */
function fakeClock() {
  /** @type {{ fn: () => void, at: number, live: boolean }[]} */
  const rows = [];
  const timers = {
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => rows.push({ fn, at: ms, live: true }) - 1,
    clearTimeout: (/** @type {unknown} */ handle) => {
      const row = rows[Number(handle)];
      if (row) row.live = false;
    },
  };
  const advance = (/** @type {number} */ t) =>
    rows
      .filter((row) => row.live && row.at <= t)
      .forEach((row) => {
        row.live = false;
        row.fn();
      });
  return { timers, advance };
}

/**
 * Whether the message has been cleared once the clock reaches `t`.
 *
 * @param {{ due: boolean, t: number, cancel?: boolean }} c
 * @returns {boolean}
 */
function cleared({ due, t, cancel = false }) {
  const { timers, advance } = fakeClock();
  const seen = { ran: false };
  const stop = expireIf(due, MS, () => (seen.ran = true), timers);
  if (cancel) stop();
  advance(t);
  return seen.ran;
}

test("test_a_due_message_is_cleared_once_its_time_has_passed", () => {
  assert.equal(cleared({ due: true, t: MS }), true);
});

test("test_a_due_message_is_still_up_before_its_time_has_passed", () => {
  assert.notEqual(cleared({ due: true, t: MS - 1 }), cleared({ due: true, t: MS }));
});

test("test_a_message_that_is_not_due_is_never_cleared", () => {
  assert.notEqual(cleared({ due: false, t: MS }), cleared({ due: true, t: MS }));
});

test("test_a_cancelled_expiry_never_clears_the_message", () => {
  assert.notEqual(cleared({ due: true, t: MS, cancel: true }), cleared({ due: true, t: MS }));
});
