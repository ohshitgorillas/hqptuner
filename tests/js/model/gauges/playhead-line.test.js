// Timing suite for the two pure decisions the paint decision (hqptuner/static/model/gauges/playhead.js) is made of.
//
// settledLead: the line's lead, the ceiling, is the greatest lead the paints have seen over a short fixed span of
// recent wall time, so a lead seen late does not lower it and one seen early raises it by no more than it was early. A
// paint that saw no lead leaves it where it was. A rush's overshoot leaves it one span after it was seen. A paint that
// restarts discards what came before, and the lead it saw is the line's lead. Leads here are playback ms less wall ms,
// hundreds of ms as a start's are.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-line.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { settledLead } from "../../../../hqptuner/static/model/gauges/playhead.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").LeadState} LeadState */
/**
 * One paint as settledLead sees it: the wall ms since the paint before, the lead it saw (null when it took no
 * arrival) and whether it restarts.
 *
 * @typedef {{ dt: number, seen: number | null, restart?: boolean }} LeadPaint
 */

//: A paint interval, wall ms: 60 Hz.
const PAINT_MS = 16;
//: Wall ms far past any one span of recent time.
const LONG_WHILE_MS = 3000;
//: Leads of a start: its rush's overshoot and the settled lead after it, playback ms less wall ms.
const OVERSHOOT = 606;
const SETTLED = 577;

/**
 * The line's lead after `paints`, the first of which restarts.
 *
 * @param {LeadPaint[]} paints
 * @returns {number}
 */
function ceilingAfter(paints) {
  /** @type {LeadState | null} */
  let line = null;
  for (const { dt, seen, restart } of paints) line = settledLead({ line, seen, dt, restart: restart ?? line === null });
  return line?.ceiling ?? NaN;
}

/**
 * `count` paints PAINT_MS apart that each see `seen`.
 *
 * @param {number} count
 * @param {number} seen
 * @returns {LeadPaint[]}
 */
const steady = (count, seen) => Array.from({ length: count }, () => ({ dt: PAINT_MS, seen }));

test("test_a_paint_that_restarts_sets_the_line_to_the_lead_it_saw", () => {
  assert.equal(ceilingAfter([{ dt: 0, seen: 520 }]), 520);
});

test("test_a_restart_discards_the_leads_seen_before_it", () => {
  assert.equal(
    ceilingAfter([{ dt: 0, seen: 900 }, ...steady(4, 900), { dt: PAINT_MS, seen: 520, restart: true }]),
    520,
  );
});

test("test_a_lead_seen_early_raises_the_line_to_it", () => {
  assert.equal(ceilingAfter([{ dt: 0, seen: 520 }, ...steady(2, 520), { dt: PAINT_MS, seen: 580 }]), 580);
});

test("test_a_lead_seen_late_leaves_the_line_where_it_was", () => {
  assert.equal(
    ceilingAfter([
      { dt: 0, seen: 520 },
      { dt: PAINT_MS, seen: 480 },
    ]),
    520,
  );
});

test("test_a_paint_that_saw_no_lead_leaves_the_line_where_it_was", () => {
  assert.equal(
    ceilingAfter([
      { dt: 0, seen: 520 },
      { dt: PAINT_MS, seen: null },
    ]),
    520,
  );
});

test("test_a_line_no_paint_has_seen_a_lead_for_stays_where_it_was_however_long_it_waits", () => {
  assert.equal(
    ceilingAfter([
      { dt: 0, seen: 520 },
      { dt: LONG_WHILE_MS, seen: null },
    ]),
    520,
  );
});

test("test_an_overshoot_still_holds_the_line_soon_after_it_was_seen", () => {
  assert.equal(ceilingAfter([{ dt: 0, seen: OVERSHOOT }, ...steady(3, SETTLED)]), OVERSHOOT);
});

test("test_an_overshoot_has_left_the_line_a_long_while_after_it_was_seen", () => {
  assert.equal(
    ceilingAfter([{ dt: 0, seen: OVERSHOOT }, ...steady(Math.ceil(LONG_WHILE_MS / PAINT_MS), SETTLED)]),
    SETTLED,
  );
});
