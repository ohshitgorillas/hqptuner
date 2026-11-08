// Contract suite for what the meter loop hands the meters and the spectrum, and for the playhead that paces it: they keep
// their promises on every paint schedule and feed the owner's page can meet, not only the steady 60 Hz ones. It asks what
// each paint handed the painters and where the playhead stood, and pins no cause.
//
// The real stack is replayed on a virtual clock (tests/js/contracts/world.js): the feed store fed wire `frame` events, the
// meter loop, the history, and a painter subscribed through `onMeterPaint`. Each schedule (tests/js/contracts/schedules.js)
// is seeded or is the owner's Safari capture, and each is replayed once; every test reads one finding of that replay.
// Every frame carries an identity and levels of its own, so a paint says which frame it showed and which it read.
//
// The playhead keeps wall time (contract 1): a paint moves it its wall time unless it stands at the newest frame's end,
// never past that end and never backward. A paint's interval runs from where the paint before it left the playhead to
// where it leaves it (contract 4): the trace is the one frame covering most of the interval, the earlier of two covering
// it equally; the meters' peak and RMS read every frame the interval covers; a paint with an empty interval hands what the
// paint before it handed. Across the run (contract 6) the frames shown, repeats collapsed, are in playback order; a frame
// the playhead passed goes unshown only if a paint over it was longer than it; and the frames shown plus the frames no
// paint could reach are the frames passed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/trace-and-meters.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { SCHEDULES } from "./schedules.js";
import { traceProbe, wallProbe } from "./trace-probes.js";
import { replay } from "./world.js";

/** @type {Map<string, ReturnType<typeof look>>} */
const looked = new Map();

/**
 * Replay `schedule` once and read everything the tests below ask of it.
 *
 * @param {import("./schedules.js").Schedule} schedule
 */
function look(schedule) {
  const wall = wallProbe();
  const trace = traceProbe();
  /** @type {import("./world.js").Frame[]} */
  let frames = [];
  replay(schedule, (paint, world) => {
    frames = world.frames;
    wall.see(paint, world);
    trace.see(paint, world);
  });
  return { wall: wall.done(), trace: trace.done(frames) };
}

/**
 * What replaying `schedule` showed, replayed on the first ask.
 *
 * @param {import("./schedules.js").Schedule} schedule
 */
function seen(schedule) {
  if (!looked.has(schedule.name)) looked.set(schedule.name, look(schedule));
  return /** @type {ReturnType<typeof look>} */ (looked.get(schedule.name));
}

const NONE = { count: 0, first: "" };

for (const schedule of SCHEDULES) {
  test(`test_the_playhead_moves_its_wall_time_unless_it_stands_at_the_newest_end_in_${schedule.name}`, () => {
    const { read, speed } = seen(schedule).wall;
    assert.deepEqual({ read: read > 100, speed }, { read: true, speed: NONE });
  });

  test(`test_the_playhead_never_passes_the_newest_frames_end_in_${schedule.name}`, () => {
    const { read, past } = seen(schedule).wall;
    assert.deepEqual({ read: read > 100, past }, { read: true, past: NONE });
  });

  test(`test_the_playhead_never_moves_backward_in_${schedule.name}`, () => {
    const { read, backward } = seen(schedule).wall;
    assert.deepEqual({ read: read > 100, backward }, { read: true, backward: NONE });
  });

  test(`test_the_trace_is_the_one_frame_covering_most_of_each_paints_interval_in_${schedule.name}`, () => {
    const { read, lead } = seen(schedule).trace;
    assert.deepEqual({ read: read > 100, lead }, { read: true, lead: NONE });
  });

  test(`test_the_meters_peak_is_the_loudest_of_every_frame_the_interval_covers_in_${schedule.name}`, () => {
    const { read, peak } = seen(schedule).trace;
    assert.deepEqual({ read: read > 100, peak }, { read: true, peak: NONE });
  });

  test(`test_the_meters_rms_is_the_power_mean_of_every_frame_the_interval_covers_in_${schedule.name}`, () => {
    const { read, rms } = seen(schedule).trace;
    assert.deepEqual({ read: read > 100, rms }, { read: true, rms: NONE });
  });

  test(`test_a_paint_with_an_empty_interval_hands_what_the_paint_before_it_handed_in_${schedule.name}`, () => {
    const { read, held } = seen(schedule).trace;
    assert.deepEqual({ read: read > 100, held }, { read: true, held: NONE });
  });

  test(`test_the_frames_shown_are_in_playback_order_in_${schedule.name}`, () => {
    const { read, order } = seen(schedule).trace;
    assert.deepEqual({ read: read > 100, order }, { read: true, order: NONE });
  });

  test(`test_a_frame_passed_goes_unshown_only_if_a_paint_over_it_was_longer_than_it_in_${schedule.name}`, () => {
    const { read, skipped } = seen(schedule).trace;
    assert.deepEqual({ read: read > 100, skipped }, { read: true, skipped: NONE });
  });

  test(`test_the_frames_shown_plus_the_frames_no_paint_could_reach_are_the_frames_passed_in_${schedule.name}`, () => {
    const { shown, unreached, passed } = seen(schedule).trace.counted;
    assert.deepEqual({ some: passed > 100, count: shown + unreached }, { some: true, count: passed });
  });
}

//: Frames of whole ms at a metering rate of 1000 Hz, 20 ms each, so every stamp and overlap is exact. The playhead stands
//: 10 ms into a frame at the first paint and the paints are 20 ms apart, so each paint's interval covers the end of one
//: frame and the start of the next in equal parts.
const FRAME_MS = 20;
const TIE = {
  name: "integer_ms_ties",
  rate: 1000,
  delay: 0.01,
  paints: Array.from({ length: 40 }, (_, k) => 5 + FRAME_MS * k),
  feed: Array.from({ length: 44 }, (_, k) => ({ t: k < 2 ? 0 : FRAME_MS * k - 30, n: FRAME_MS })),
};

test("test_a_paint_whose_interval_covers_two_frames_equally_shows_the_earlier", () => {
  /** @type {number[]} */
  const off = [];
  replay(TIE, ({ i, head, heard }) => {
    if (i > 0 && head !== null && heard && heard.id !== Math.floor((head - FRAME_MS) / FRAME_MS)) off.push(i);
  });
  assert.deepEqual(off, []);
});
