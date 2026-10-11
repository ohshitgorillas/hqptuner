// Behavioral suite for hqptuner/static/model/shell/timing.js: a held button repeats on a fake clock, a mock check prints its
// lines and then its verdict in order, and a revert fires once per arming with a re-arm cancelling the pending one.
//
// The clock is faked at the Clock seam each unit takes. Time moves only when a test says so, so nothing here waits on
// the wall.
//
// Run: node --test tests/js/model/shell/timing.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { holdRepeat, checkSequence, revertAfter } from "../../../../hqptuner/static/model/shell/timing.js";
import { fakeClock } from "../../support/clock.js";

//: Hold delay and repeat rate for the hold tests, in the fake clock's ms.
const DELAY = 100;
const RATE = 10;
//: Spacing between a check's printed lines.
const TICK = 50;
//: How long a revert waits.
const MS = 1000;

/**
 * Steps a hold fires, with `stopAt` (if given) the fake ms at which it is released, measured to `t`.
 *
 * @param {{ t: number, stopAt?: number }} c
 * @returns {{ steps: number, started: boolean | undefined }}
 */
function held({ t, stopAt }) {
  const { clock, advance } = fakeClock();
  const seen = { steps: 0, started: /** @type {boolean | undefined} */ (undefined) };
  const stop = holdRepeat(() => (seen.steps += 1), clock, DELAY, RATE);
  if (stopAt == null) {
    advance(t);
    return seen;
  }
  advance(stopAt);
  seen.started = stop();
  advance(t - stopAt);
  return seen;
}

test("test_a_hold_steps_nothing_before_its_delay_and_first_period_pass", () => {
  assert.equal(held({ t: DELAY + RATE - 1 }).steps, 0);
});

test("test_a_hold_steps_once_per_period_after_its_delay", () => {
  assert.equal(held({ t: DELAY + RATE * 5 }).steps, 5);
});

test("test_a_hold_released_before_its_delay_never_steps", () => {
  assert.equal(held({ t: DELAY * 10, stopAt: DELAY - 1 }).steps, 0);
});

test("test_a_hold_released_while_repeating_steps_no_further", () => {
  assert.equal(held({ t: DELAY * 10, stopAt: DELAY + RATE * 3 }).steps, 3);
});

test("test_releasing_before_the_delay_reports_the_repeat_never_began", () => {
  assert.equal(held({ t: DELAY * 10, stopAt: DELAY - 1 }).started, false);
});

test("test_releasing_after_the_delay_reports_the_repeat_began", () => {
  assert.equal(held({ t: DELAY * 10, stopAt: DELAY }).started, true);
});

/**
 * The calls a check makes on `lines`, in order, once the clock has moved `t` (none: not moved at all).
 *
 * @param {string[]} lines
 * @param {number} [t]
 * @returns {string[]}
 */
function checked(lines, t) {
  const { clock, advance } = fakeClock();
  /** @type {string[]} */
  const log = [];
  checkSequence(lines, { tick: TICK, onLine: (line) => log.push(line), onVerdict: () => log.push("verdict") }, clock);
  if (t != null) advance(t);
  return log;
}

test("test_a_check_prints_nothing_until_the_clock_moves", () => {
  assert.equal(checked(["a", "b"]).length, 0);
});

test("test_a_check_prints_its_lines_in_order_then_its_verdict", () => {
  assert.deepEqual(checked(["a", "b", "c"], TICK * 3), ["a", "b", "c", "verdict"]);
});

test("test_a_check_prints_one_line_per_tick", () => {
  assert.deepEqual(checked(["a", "b", "c"], TICK), ["a", "b"]);
});

test("test_a_check_holds_its_verdict_until_a_tick_after_the_last_line", () => {
  assert.equal(checked(["a", "b", "c"], TICK * 3 - 1).length, 3);
});

/**
 * Reverts seen by `t`, after arming at each of the fake ms in `arms`.
 *
 * @param {number[]} arms
 * @param {number} t
 * @returns {number}
 */
function reverts(arms, t) {
  const { clock, advance } = fakeClock();
  const seen = { n: 0 };
  const arm = revertAfter(MS, () => (seen.n += 1), clock);
  let at = 0;
  for (const when of arms) {
    advance(when - at);
    at = when;
    arm();
  }
  advance(t - at);
  return seen.n;
}

test("test_a_revert_waits_its_full_delay", () => {
  assert.equal(reverts([0], MS - 1), 0);
});

test("test_a_revert_fires_once_its_delay_passes", () => {
  assert.equal(reverts([0], MS), 1);
});

test("test_a_revert_fires_only_once", () => {
  assert.equal(reverts([0], MS * 10), 1);
});

test("test_a_second_arming_cancels_the_first_revert", () => {
  assert.equal(reverts([0, MS / 2], MS), 0);
});

test("test_a_second_arming_reverts_once_its_own_delay_passes", () => {
  assert.equal(reverts([0, MS / 2], MS * 10), 1);
});
