// Timing suite for the two pure decisions the paint decision (hqptuner/static/model/gauges/playhead.js) is made of.
//
// settledLead: the line's lead, the ceiling, is the greatest lead the paints have seen over a short fixed span of
// recent wall time, so a lead seen late does not lower it and one seen early raises it by no more than it was early. A
// paint that saw no lead leaves it where it was. A rush's overshoot leaves it one span after it was seen. A paint that
// restarts discards what came before, and the lead it saw is the line's lead. Leads here are playback ms less wall ms,
// hundreds of ms as a start's are.
//
// followLine: the playhead moves at wall speed and toward its aim by no more than a bounded share of that speed, up or
// down, so it never moves backward. Through the opening span after a restart a rise of the aim above where wall speed
// carries the playhead is taken at once; after it every gap to the aim is closed at the share. Positions here are
// playback ms away from 0.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-line.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { followLine, settledLead } from "../../../../hqptuner/static/model/gauges/playhead.js";

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

//: Where the playhead stands before a paint, playback ms.
const HEAD = 5000;
//: Wall ms since a restart: inside the opening span, and far past it.
const OPENING_MS = 200;
const AFTER_OPENING_MS = 3000;
//: A late paint's wall time, ms.
const LATE_PAINT_MS = 640;

/**
 * The playhead after a paint that moved `dt` ms of wall time, `since` ms after a restart, toward `aim`.
 *
 * @param {number} aim  playback, ms
 * @param {number} dt  wall, ms
 * @param {number} since  wall, ms
 * @returns {number}
 */
const followed = (aim, dt, since) => followLine({ head: HEAD, aim, dt, since });

test("test_with_the_aim_where_wall_speed_carries_it_the_playhead_moves_its_wall_time", () => {
  assert.equal(followed(HEAD + PAINT_MS, PAINT_MS, AFTER_OPENING_MS), HEAD + PAINT_MS);
});

test("test_a_rise_of_the_aim_after_the_opening_span_moves_the_playhead_further_than_its_wall_time", () => {
  assert.ok(followed(HEAD + 400, PAINT_MS, AFTER_OPENING_MS) > HEAD + PAINT_MS);
});

test("test_a_rise_of_the_aim_after_the_opening_span_moves_the_playhead_no_further_than_twice_its_wall_time", () => {
  assert.ok(followed(HEAD + 400, PAINT_MS, AFTER_OPENING_MS) <= HEAD + 2 * PAINT_MS);
});

test("test_a_fall_of_the_aim_after_the_opening_span_moves_the_playhead_less_than_its_wall_time", () => {
  assert.ok(followed(HEAD - 400, PAINT_MS, AFTER_OPENING_MS) < HEAD + PAINT_MS);
});

test("test_a_fall_of_the_aim_after_the_opening_span_never_moves_the_playhead_backward", () => {
  assert.ok(followed(HEAD - 400, PAINT_MS, AFTER_OPENING_MS) >= HEAD);
});

test("test_a_late_paint_far_above_the_aim_never_moves_the_playhead_backward", () => {
  assert.ok(followed(HEAD - 4000, LATE_PAINT_MS, AFTER_OPENING_MS) >= HEAD);
});

test("test_a_rise_of_the_aim_inside_the_opening_span_is_taken_at_once", () => {
  assert.equal(followed(HEAD + 400, PAINT_MS, OPENING_MS), HEAD + 400);
});

test("test_a_fall_of_the_aim_inside_the_opening_span_is_not_taken_at_once", () => {
  assert.ok(followed(HEAD - 400, PAINT_MS, OPENING_MS) >= HEAD);
});
