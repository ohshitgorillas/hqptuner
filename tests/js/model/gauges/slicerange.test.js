// Timing suite for hqptuner/static/model/gauges/slicerange.js: which slices of the spectrogram's history fall inside
// the window of playback a paint draws, the span wide with its right edge at the playhead. A slice is inside when it
// ends by the edge and starts no earlier than the span before it. The range holds no slice that overhangs the window
// and drops none that touches its bounds exactly, across a history whose slices change length, reaches the newest
// slice when the edge has run past it, is empty for an empty history or a window too narrow to hold a slice, and is
// found without reading a long history any more than a short one.
//
// Every history is slices laid end to end, oldest first, each placed by its own stamp in playback ms. Lengths run
// 17.375 to 23.125 ms, the measured feed event range, and 34.75 ms for a slice of two events; the first half of a
// history is short slices and the second half long ones. Every length is a whole number of eighths of a ms, so every
// stamp, end and window bound is exact and a boundary case lands on the boundary itself.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/slicerange.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { sliceRange } from "../../../../hqptuner/static/model/gauges/slicerange.js";

/** @typedef {{ at: number, ms: number }} Slice */

//: Where the oldest slice of every history starts, playback ms.
const START = 1000;
//: Slice lengths in the older half of a history, playback ms.
const SHORT = [17.375, 19.25, 21.5];
//: Slice lengths in the newer half of a history, playback ms: one event, then two.
const LONG = [23.125, 34.75];
//: Slices in the history the window tests read: 500 short, then 500 long.
const COUNT = 1000;
//: Slices in a 300 s history, near enough.
const LONG_HISTORY = 12000;
//: The window's width in the cost test, playback ms.
const COST_SPAN = 2000;
//: How far the cost test's edge stands behind the newest slice's end, playback ms.
const COST_LAG = 100;
//: How far past the newest slice's end the playhead has run, playback ms.
const AHEAD = 50;
//: The oldest slice the window tests' window reaches, in the short half.
const OLDEST_IN = 450;
//: The newest slice the window tests' window reaches, in the long half.
const NEWEST_IN = 600;

/**
 * `count` slices laid end to end from START: the first half cycling through SHORT, the rest through LONG.
 *
 * @param {number} count
 * @returns {Slice[]}
 */
function history(count) {
  /** @type {Slice[]} */
  const out = [];
  let at = START;
  for (let i = 0; i < count; i++) {
    const ms = i < count / 2 ? SHORT[i % SHORT.length] : LONG[i % LONG.length];
    out.push({ at, ms });
    at += ms;
  }
  return out;
}

const SLICES = history(COUNT);

/**
 * Where slice `i` of SLICES starts, playback ms, NaN when there is no such slice.
 *
 * @param {number} i
 */
const startOf = (i) => SLICES[i]?.at ?? NaN;

/**
 * Where slice `i` of SLICES ends, playback ms, NaN when there is no such slice.
 *
 * @param {number} i
 */
const endOf = (i) => (SLICES[i]?.at ?? NaN) + (SLICES[i]?.ms ?? NaN);

/**
 * Halfway through slice `i` of SLICES, playback ms.
 *
 * @param {number} i
 */
const midOf = (i) => startOf(i) + SLICES[i].ms / 2;

/**
 * A view of `slices` that counts how many times a slice is read.
 *
 * @param {Slice[]} slices
 * @returns {{ view: Slice[], reads: () => number }}
 */
function counted(slices) {
  let n = 0;
  const view = new Proxy(slices, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) n++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { view, reads: () => n };
}

/**
 * The slices read deciding the range of a COST_SPAN window COST_LAG behind the newest slice of a `count` history.
 *
 * @param {number} count
 */
function readsOver(count) {
  const slices = history(count);
  const newest = slices[slices.length - 1];
  const { view, reads } = counted(slices);
  sliceRange(view, COST_SPAN, newest.at + newest.ms - COST_LAG);
  return reads();
}

// Two windows over SLICES, both reaching from the short half into the long one. The first window's bounds land
// halfway into OLDEST_IN and NEWEST_IN, so neither is inside: the range holds no slice that overhangs it. The second
// window's bounds land exactly on the start of OLDEST_IN and the end of NEWEST_IN, so both are inside: the range drops
// no slice that fits.
//: The edge of the window whose bounds cut slices, playback ms.
const CUT_EDGE = midOf(NEWEST_IN);
//: The span of the window whose bounds cut slices, playback ms.
const CUT_SPAN = midOf(NEWEST_IN) - midOf(OLDEST_IN);
//: The edge of the window whose bounds fall on slice boundaries, playback ms.
const FIT_EDGE = endOf(NEWEST_IN);
//: The span of the window whose bounds fall on slice boundaries, playback ms.
const FIT_SPAN = endOf(NEWEST_IN) - startOf(OLDEST_IN);

test("test_the_newest_slice_in_the_range_ends_by_the_edge", () => {
  const { hi } = sliceRange(SLICES, CUT_SPAN, CUT_EDGE);
  assert.ok(endOf(hi - 1) <= CUT_EDGE, `slice ${hi - 1} ends at ${endOf(hi - 1)}, past the edge ${CUT_EDGE}`);
});

test("test_the_oldest_slice_in_the_range_starts_no_earlier_than_the_span_before_the_edge", () => {
  const { lo } = sliceRange(SLICES, CUT_SPAN, CUT_EDGE);
  const from = CUT_EDGE - CUT_SPAN;
  assert.ok(startOf(lo) >= from, `slice ${lo} starts at ${startOf(lo)}, before ${from}`);
});

test("test_a_slice_ending_exactly_at_the_edge_is_in_the_range", () => {
  const { hi } = sliceRange(SLICES, FIT_SPAN, FIT_EDGE);
  assert.ok(endOf(hi) > FIT_EDGE, `slice ${hi} ends at ${endOf(hi)}, by the edge ${FIT_EDGE}, yet is left out`);
});

test("test_a_slice_starting_exactly_the_span_before_the_edge_is_in_the_range", () => {
  const { lo } = sliceRange(SLICES, FIT_SPAN, FIT_EDGE);
  const from = FIT_EDGE - FIT_SPAN;
  assert.ok(
    startOf(lo - 1) < from,
    `slice ${lo - 1} starts at ${startOf(lo - 1)}, not before ${from}, yet is left out`,
  );
});

test("test_an_edge_past_the_newest_slice_keeps_the_newest_slice_in_the_range", () => {
  const { hi } = sliceRange(SLICES, COST_SPAN, endOf(COUNT - 1) + AHEAD);
  assert.equal(hi, COUNT);
});

test("test_an_empty_history_gives_an_empty_range", () => {
  const { lo, hi } = sliceRange([], COST_SPAN, START);
  assert.equal(hi - lo, 0);
});

test("test_a_window_narrower_than_the_slice_under_the_edge_gives_an_empty_range", () => {
  const { lo, hi } = sliceRange(SLICES, SLICES[NEWEST_IN].ms / 4, CUT_EDGE);
  assert.equal(hi - lo, 0);
});

test("test_a_300_s_history_is_read_less_than_twice_as_much_as_a_short_one", () => {
  const short = readsOver(COUNT);
  const long = readsOver(LONG_HISTORY);
  assert.ok(long < 2 * short, `${long} reads over ${LONG_HISTORY} slices, ${short} over ${COUNT}`);
});
