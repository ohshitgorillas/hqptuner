// Steady motion, as a table on the paint decision (hqptuner/static/model/gauges/playhead.js, pacePaint): the approved
// rule's promises about where the playhead stands, each a yes or no.
//
// The playhead never moves backward outside a break or a raised delay, when the line falls after the opening span and
// on a late paint that stands far above its aim. It never passes the newest queued frame's end, even where its aim
// stands past it, the rise of the opening span included, and having reached that end it stands there until the next
// arrival. At a break it restarts one delay behind the newest frame's end, carried on at wall speed from the time that
// frame arrived, and nothing from before the break is followed: a restart handed a line far from the new one lands on
// the new one.
//
// The restart's own position after a wait, and a paint on a line that holds moving its wall time, are held by
// playhead-lag.test.js and not written twice. Never backward and the cap under today's rule are also held by the breach
// table of playhead.test.js; the cases here hold them under the approved rule's inputs.
//
// One case is one call, every input and answer written in the case, in whole ms. A never-backward case names the floor
// the playhead may not fall below; the rest name the one place it stands. A falling line is fed here as a state the
// last paints left: the promise holds whatever the line does.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-motion.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pacePaint } from "../../../../hqptuner/static/model/gauges/playhead.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").PaintInput} PaintInput */
/** @typedef {import("../../../../hqptuner/static/model/gauges/playhead.js").LeadState} LeadState */
/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/**
 * What the approved rule reads beyond today's PaintInput: the paint's wall time, ms on the clock `arrivedAt` is read
 * on; whether the paint took arrivals; and the line's carried state, null when no paint has run.
 *
 * @typedef {PaintInput & { now: number, arrived: boolean, line: LeadState | null }} Paint
 */

//: Each frame's length, playback ms.
const FRAME_MS = 20;

/**
 * Frames FRAME_MS long end to end from `at`, `count` of them, received together at wall time `arrivedAt`; the first
 * begins a break when `brk`.
 *
 * @param {number} at  playback, ms
 * @param {number} count
 * @param {number} arrivedAt  wall, ms
 * @param {boolean} [brk]
 * @returns {MeterFrame[]}
 */
function run(at, count, arrivedAt, brk = false) {
  /** @type {MeterFrame[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ at: at + i * FRAME_MS, ms: FRAME_MS, channels: [], arrivedAt, break: brk && i === 0 });
  }
  return out;
}

/** A line that held at a lead of 600, playback ms less wall ms, for 3 s: long past the opening span. */
const LONG_HELD = { peak: 600, prior: 600, age: 100, since: 3000, ceiling: 600 };

/** @type {Array<{ name: string, input: Paint, floor: number }>} */
const NEVER_BACKWARD = [
  // The line fell to 540 after the playhead stood on 600: the aim, 39956, is 60 under where wall speed carries it.
  {
    name: "the_playhead_does_not_move_backward_when_the_line_falls_after_the_opening_span",
    input: {
      end: 40000,
      playhead: 40000,
      delayed: 200,
      started: true,
      frames: run(39990, 8, 39610),
      delay: 200,
      dt: 16,
      now: 39616,
      arrived: true,
      line: { peak: 540, prior: 540, age: 100, since: 3000, ceiling: 540 },
    },
    floor: 40000,
  },
  // A paint 640 ms after the one before, the line fallen to 340: the aim is 260 under where wall speed carries it.
  {
    name: "the_playhead_does_not_move_backward_on_a_late_paint_far_above_its_aim",
    input: {
      end: 40000,
      playhead: 40000,
      delayed: 200,
      started: true,
      frames: run(39990, 40, 39610),
      delay: 200,
      dt: 640,
      now: 40240,
      arrived: false,
      line: { peak: 340, prior: 340, age: 100, since: 3000, ceiling: 340 },
    },
    floor: 40000,
  },
];

/** @type {Array<{ name: string, input: Paint, playhead: number }>} */
const STANDS_AT = [
  // The opening: the paint 100 ms after a start at delay 40, an arrival 60 ms before it with newest end 5260 raising
  // the line from 600 to 760. The aim, 5280, is past the newest end.
  {
    name: "the_playhead_stops_at_the_newest_end_when_a_rise_in_the_opening_span_aims_past_it",
    input: {
      end: 5020,
      playhead: 5020,
      delayed: 40,
      started: true,
      frames: [...run(5000, 3, 4460, true), ...run(5060, 10, 4500)],
      delay: 40,
      dt: 100,
      now: 4560,
      arrived: true,
      line: { peak: 600, prior: -Infinity, age: 0, since: 0, ceiling: 600 },
    },
    playhead: 5260,
  },
  // Later in the track: the newest frame ends at 40010 and arrived 206 ms before the paint, so the aim, 40016, is past it.
  {
    name: "the_playhead_stops_at_the_newest_end_when_its_aim_stands_past_it_later_in_the_track",
    input: {
      end: 40000,
      playhead: 40000,
      delayed: 200,
      started: true,
      frames: run(39990, 1, 39410),
      delay: 200,
      dt: 16,
      now: 39616,
      arrived: false,
      line: LONG_HELD,
    },
    playhead: 40010,
  },
  // Every queued frame is passed and the playhead stands at the end it reached; no arrival.
  {
    name: "the_playhead_stands_at_the_end_it_reached_until_the_next_arrival",
    input: {
      end: 40010,
      playhead: 40010,
      delayed: 200,
      started: true,
      frames: [],
      delay: 200,
      dt: 16,
      now: 39632,
      arrived: false,
      line: LONG_HELD,
    },
    playhead: 40010,
  },
  // A reconnect: the stamps count from 0 again, newest end 540, arrived at 11470, the paint at 11481, whatever line and
  // playhead stood before it.
  {
    name: "a_restart_lands_on_the_new_line_when_it_is_handed_a_line_far_from_it",
    input: {
      end: 12000,
      playhead: 11800,
      delayed: 200,
      started: true,
      frames: [...run(12000, 1, 11450), ...run(500, 2, 11470, true)],
      delay: 200,
      dt: 16,
      now: 11481,
      arrived: true,
      line: { peak: 900, prior: 900, age: 100, since: 3000, ceiling: 900 },
    },
    playhead: 351,
  },
  // The first paint since the queue began: five frames arrived at 4400 and 4460, newest end 5100, the paint at 4470.
  {
    name: "a_restart_carries_on_from_the_time_the_newest_frame_arrived",
    input: {
      end: null,
      playhead: null,
      delayed: null,
      started: false,
      frames: [...run(5000, 3, 4400, true), ...run(5060, 2, 4460)],
      delay: 200,
      dt: 0,
      now: 4470,
      arrived: true,
      line: null,
    },
    playhead: 4910,
  },
];

for (const { name, input, floor } of NEVER_BACKWARD) {
  test(`test_${name}`, () => {
    assert.ok(pacePaint(input).playhead >= floor);
  });
}

for (const { name, input, playhead } of STANDS_AT) {
  test(`test_${name}`, () => {
    assert.equal(pacePaint(input).playhead, playhead);
  });
}
