// Steady lag, as a table on the paint decision (hqptuner/static/model/gauges/playhead.js, pacePaint). After a start
// the playhead stands one delay behind the line on every paint, as it does later in the track. The line is the stamps'
// lead over wall time: a frame's end less its `arrivedAt`, held as settledLead holds it. One delay behind the line is
// the paint's wall time plus the line's lead less the delay.
//
// It holds on the paint that restarts, at a break frame or at the first paint since the queue began; on each paint of
// the opening span, while the line rises to where it settles; and later in the track, on a line that holds, on a paint
// that took no arrival, on an arrival stamped late, and on the rising drift the captures measured. It does not depend on
// the wait between the newest frame's arrival and the paint, the browser loop's connect and paint phase, nor on the
// stamp the server's reader counted from, its connect: both are inputs below.
//
// One case is one call. Every input, the frames, the paint's wall time and what earlier paints left (`end`, `playhead`,
// `delayed`, `started` and the line's carried state), is written in the case; the answer is written beside it, in whole
// ms. No case runs earlier paints, and none computes its answer. A paint's wall time and every `arrivedAt` are ms on the
// one clock; a frame is FRAME_MS long, and a burst is the frames one arrival brought. The cases keep to what the rule
// can reach exactly: no opening lead above the line the start settles to, no arrival ahead of its line, no loss of
// music without a break and no stamps falling against wall time.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-lag.test.js

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

//: How far the playhead stands behind the line, playback ms.
const DELAY = 200;
//: Each frame's length, playback ms.
const FRAME_MS = 20;

/**
 * `count` frames FRAME_MS long end to end from `at`, all received at wall time `arrivedAt`, the first beginning a break
 * when `brk`.
 *
 * @param {number} at  playback, ms
 * @param {number} count
 * @param {number} arrivedAt  wall, ms
 * @param {boolean} [brk]
 * @returns {MeterFrame[]}
 */
const burst = (at, count, arrivedAt, brk = false) =>
  Array.from({ length: count }, (_, i) => ({
    channels: [],
    at: at + i * FRAME_MS,
    ms: FRAME_MS,
    arrivedAt,
    break: brk && i === 0,
  }));

//: What no earlier paint has left: the first paint since the queue began.
const NOTHING_BEFORE = { end: null, playhead: null, delayed: null, started: false, line: null, dt: 0 };
//: The line a paint leaves that restarted on a lead of 600, playback ms less wall ms.
const JUST_RESTARTED = { peak: 600, prior: -Infinity, age: 0, since: 0, ceiling: 600 };
//: A line that has held at 600 for 3 s.
const HELD_600 = { peak: 600, prior: 600, age: 100, since: 3000, ceiling: 600 };
//: The same line on stamps counted from a connect 3000 s earlier.
const HELD_FAR_ORIGIN = { peak: 3000600, prior: 3000600, age: 100, since: 3000, ceiling: 3000600 };

/** @type {Array<{ name: string, input: Paint, playhead: number }>} */
const CASES = [
  // The first paint since the queue began: newest end 5060, arrived at 4460, so the line's lead is 600.
  {
    name: "a_start_stands_one_delay_behind_the_line_when_the_paint_ran_at_the_arrival",
    input: { ...NOTHING_BEFORE, frames: burst(5000, 3, 4460, true), delay: DELAY, now: 4460, arrived: true },
    playhead: 4860,
  },
  {
    name: "a_start_stands_one_delay_behind_the_line_when_the_paint_ran_9_ms_after_the_arrival",
    input: { ...NOTHING_BEFORE, frames: burst(5000, 3, 4460, true), delay: DELAY, now: 4469, arrived: true },
    playhead: 4869,
  },
  {
    name: "a_start_stands_one_delay_behind_the_line_when_the_paint_ran_17_ms_after_the_arrival",
    input: { ...NOTHING_BEFORE, frames: burst(5000, 3, 4460, true), delay: DELAY, now: 4477, arrived: true },
    playhead: 4877,
  },
  // The stamps' origin moves the line by exactly the origin: frames at 205000 and 3005000 from the same arrival.
  {
    name: "a_start_stands_one_delay_behind_the_line_whether_the_reader_counted_from_200_s_before",
    input: { ...NOTHING_BEFORE, frames: burst(205000, 3, 4460, true), delay: DELAY, now: 4477, arrived: true },
    playhead: 204877,
  },
  {
    name: "a_start_stands_one_delay_behind_the_line_whether_the_reader_counted_from_3000_s_before",
    input: { ...NOTHING_BEFORE, frames: burst(3005000, 3, 4460, true), delay: DELAY, now: 4477, arrived: true },
    playhead: 3004877,
  },
  // A break frame in a queue with an earlier frame before it: newest end 12060, arrived at 11470, paint at 11481.
  {
    name: "a_restart_at_a_break_frame_stands_one_delay_behind_the_line_when_the_paint_ran_11_ms_after_the_arrival",
    input: {
      end: 12000,
      playhead: 11800,
      delayed: DELAY,
      started: true,
      frames: [...burst(12000, 1, 11450), ...burst(12020, 2, 11470, true)],
      delay: DELAY,
      dt: 16,
      now: 11481,
      arrived: true,
      line: { peak: 570, prior: 570, age: 100, since: 3000, ceiling: 570 },
    },
    playhead: 11871,
  },
  // The opening: the paint after the first, its line 600 from the restart, taking an arrival that raises it to 612.
  {
    name: "the_playhead_takes_a_rise_of_the_line_at_once_on_the_first_paint_after_a_start",
    input: {
      end: 5000,
      playhead: 4860,
      delayed: DELAY,
      started: true,
      frames: [...burst(5000, 3, 4460, true), ...burst(5060, 1, 4468)],
      delay: DELAY,
      dt: 16,
      now: 4476,
      arrived: true,
      line: JUST_RESTARTED,
    },
    playhead: 4888,
  },
  // 480 ms into the opening, the line 612 and a new arrival that raises it to 622.
  {
    name: "the_playhead_takes_a_rise_of_the_line_at_once_480_ms_into_the_opening",
    input: {
      end: 5352,
      playhead: 5352,
      delayed: DELAY,
      started: true,
      frames: burst(5340, 11, 4938),
      delay: DELAY,
      dt: 16,
      now: 4956,
      arrived: true,
      line: { peak: 612, prior: 590, age: 100, since: 480, ceiling: 612 },
    },
    playhead: 5378,
  },
  // The paint after a start that ran 17 ms after its arrival, taking no arrival: the line is where it was.
  {
    name: "the_playhead_stays_on_the_line_on_a_paint_that_took_no_arrival_after_a_start_that_waited_17_ms",
    input: {
      end: 5000,
      playhead: 4877,
      delayed: DELAY,
      started: true,
      frames: burst(5000, 3, 4460, true),
      delay: DELAY,
      dt: 16,
      now: 4493,
      arrived: false,
      line: JUST_RESTARTED,
    },
    playhead: 4893,
  },
  // Later in the track, the line held at 600: the playhead stood at 40000 at wall 39600, the paint 16 ms later.
  {
    name: "the_playhead_moves_its_wall_time_on_a_line_that_holds",
    input: {
      end: 40000,
      playhead: 40000,
      delayed: DELAY,
      started: true,
      frames: burst(39990, 11, 39610),
      delay: DELAY,
      dt: 16,
      now: 39616,
      arrived: true,
      line: HELD_600,
    },
    playhead: 40016,
  },
  {
    name: "the_playhead_moves_its_wall_time_on_a_paint_that_took_no_arrival",
    input: {
      end: 40000,
      playhead: 40000,
      delayed: DELAY,
      started: true,
      frames: burst(39990, 11, 39610),
      delay: DELAY,
      dt: 16,
      now: 39616,
      arrived: false,
      line: HELD_600,
    },
    playhead: 40016,
  },
  {
    name: "the_playhead_moves_its_wall_time_when_an_arrival_was_stamped_4_ms_late",
    input: {
      end: 40000,
      playhead: 40000,
      delayed: DELAY,
      started: true,
      frames: burst(39990, 11, 39614),
      delay: DELAY,
      dt: 16,
      now: 39616,
      arrived: true,
      line: HELD_600,
    },
    playhead: 40016,
  },
  {
    name: "the_playhead_moves_its_wall_time_on_a_line_whose_stamps_count_from_3000_s_before",
    input: {
      end: 3040000,
      playhead: 3040000,
      delayed: DELAY,
      started: true,
      frames: burst(3039990, 11, 39610),
      delay: DELAY,
      dt: 16,
      now: 39616,
      arrived: true,
      line: HELD_FAR_ORIGIN,
    },
    playhead: 3040016,
  },
  // The rising drift: the arrival's stamps stand 1 ms further ahead of wall time than the line held.
  {
    name: "the_playhead_follows_a_rise_of_the_line_of_1_ms_later_in_the_track",
    input: {
      end: 40000,
      playhead: 40000,
      delayed: DELAY,
      started: true,
      frames: burst(39990, 11, 39609),
      delay: DELAY,
      dt: 16,
      now: 39616,
      arrived: true,
      line: HELD_600,
    },
    playhead: 40017,
  },
];

for (const { name, input, playhead } of CASES) {
  test(`test_${name}`, () => {
    assert.equal(pacePaint(input).playhead, playhead);
  });
}
