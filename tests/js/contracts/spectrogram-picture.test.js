// Contract suite for the spectrogram the Source drawer paints: the picture keeps its promises on every paint schedule and
// feed the owner's page can meet, not only the steady 60 Hz ones. It asks what the picture shows, from its pixels, and
// pins no cause.
//
// The real stack is replayed on a virtual clock (tests/js/contracts/world.js): the feed store fed wire `frame` events, the
// meter loop, the history, and the real painter on a pixel canvas. Each schedule (tests/js/contracts/schedules.js) is
// seeded or is the owner's Safari capture, and each is replayed once; every test reads one finding of that replay. Every
// slice of the feeds carries levels of its own, so a column's pixels say which slice it shows.
//
// The picture scrolls with the playhead (contract 2): over the run, the columns it moved left equal the playhead's advance
// in columns, within one column, and it never moves right. The picture is consistent (contract 3): it equals what one
// fresh whole paint of the same state draws, pixel for pixel, checked every fifth paint and at the last, each row shows
// the nearest row of its slice and each column the one slice covering most of it, the earlier of two covering it equally.
// The picture shows the music against the feed (contract 7): from the paint a slice has been passed, it stands in the
// columns its time covers, a slice's boundary within the scroll's own quantum of one column of where its time puts it, no
// column over passed music is glass, the number of slices shown is the number passed, and the glass at the right edge is
// no more than a slice and a frame of playback.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/spectrogram-picture.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { freshProbe, scrollProbe, sliceProbe } from "./picture-probes.js";
import { SCHEDULES } from "./schedules.js";
import { replay } from "./world.js";

/** @type {Map<string, ReturnType<typeof look>>} */
const looked = new Map();

/**
 * Replay `schedule` once and read everything the tests below ask of it.
 *
 * @param {import("./schedules.js").Schedule} schedule
 */
function look(schedule) {
  const scroll = scrollProbe();
  const fresh = freshProbe(schedule.paints.length - 1);
  const slices = sliceProbe();
  let span = 0;
  replay(schedule, (paint, world) => {
    span = world.span;
    for (const probe of [scroll, fresh, slices]) probe.see(paint, world);
  });
  return { scroll: scroll.done(span), fresh: fresh.done(), slices: slices.done() };
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
  test(`test_the_spectrogram_scrolls_the_playheads_advance_in_columns_within_one_column_in_${schedule.name}`, () => {
    const { measured, moved, owed } = seen(schedule).scroll;
    assert.deepEqual({ read: measured > 100, within: Math.abs(moved - owed) <= 1 }, { read: true, within: true });
  });

  test(`test_the_spectrogram_never_scrolls_right_in_${schedule.name}`, () => {
    const { measured, right } = seen(schedule).scroll;
    assert.deepEqual({ read: measured > 100, right }, { read: true, right: NONE });
  });

  test(`test_the_spectrogram_equals_one_fresh_whole_paint_of_the_same_state_in_${schedule.name}`, () => {
    const { checked, differs } = seen(schedule).fresh;
    assert.deepEqual({ checked: checked > 100, differs }, { checked: true, differs: NONE });
  });

  test(`test_no_column_over_passed_music_is_glass_in_${schedule.name}`, () => {
    const { judged, glassInside } = seen(schedule).slices;
    assert.deepEqual({ judged: judged > 100, glassInside }, { judged: true, glassInside: NONE });
  });

  test(`test_every_slice_boundary_of_the_history_stands_within_a_column_in_the_picture_in_${schedule.name}`, () => {
    const { judged, missing } = seen(schedule).slices;
    assert.deepEqual({ judged: judged > 100, missing }, { judged: true, missing: NONE });
  });

  test(`test_the_picture_holds_no_slice_boundary_the_history_lacks_in_${schedule.name}`, () => {
    const { judged, extra } = seen(schedule).slices;
    assert.deepEqual({ judged: judged > 100, extra }, { judged: true, extra: NONE });
  });

  test(`test_no_column_left_of_the_first_slice_shows_music_in_${schedule.name}`, () => {
    const { judged, leftNotGlass } = seen(schedule).slices;
    assert.deepEqual({ judged: judged > 100, leftNotGlass }, { judged: true, leftNotGlass: NONE });
  });

  test(`test_the_glass_at_the_right_edge_is_no_more_than_a_slice_and_a_frame_in_${schedule.name}`, () => {
    const { judged, edgeGlass } = seen(schedule).slices;
    assert.deepEqual({ judged: judged > 100, edgeGlass }, { judged: true, edgeGlass: NONE });
  });
}
