// Behavioral suite for the apodizing strip's edge model (hqptuner/static/model/gauges/stripedge.js): where the strip's
// right edge stands in track position, carried forward on the frame time the spectrogram closes, and how a new bin
// moves it: to where the bin says on a track's first bin or a disagreement past a seek's size, and part of the way
// toward it on a near agreement, whichever side of the carried edge the bin lands.
//
// Every case starts from an anchor 2 s into the track at frame time 0 and a bin landing at 1000 ms of frame time, where
// the carried edge stands at 3 s. Time is the frame time each call is handed; nothing here reads a clock.
//
// Run: node --test tests/js/model/gauges/stripedge.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { alignStrip, stripEdge } from "../../../../hqptuner/static/model/gauges/stripedge.js";

const ANCHOR = { at: 2000, end: 0 };
const LATER = 1000;
const CARRIED = 3000;

/**
 * The edge a bin landing at track position `at` leaves, read at the frame time it landed.
 *
 * @param {number} at  ms
 * @returns {number}
 */
const edgeAfter = (at) => stripEdge(alignStrip(ANCHOR, { at, end: LATER }), LATER);

test("test_a_tracks_first_bin_puts_the_edge_where_the_bin_says", () => {
  assert.equal(stripEdge(alignStrip(null, { at: 2000, end: 400 }), 400), 2000);
});

test("test_the_edge_moves_on_by_the_frame_time_closed_since_its_anchor", () => {
  assert.equal(stripEdge(ANCHOR, LATER), CARRIED);
});

test("test_a_bin_just_ahead_of_the_carried_edge_moves_the_edge_forward", () => {
  assert.ok(edgeAfter(CARRIED + 80) > CARRIED);
});

test("test_a_bin_just_ahead_of_the_carried_edge_moves_the_edge_less_than_they_disagree", () => {
  assert.ok(edgeAfter(CARRIED + 80) < CARRIED + 80);
});

test("test_a_bin_just_behind_the_carried_edge_moves_the_edge_back", () => {
  assert.ok(edgeAfter(CARRIED - 80) < CARRIED);
});

test("test_a_bin_seconds_from_the_carried_edge_moves_the_edge_all_the_way", () => {
  assert.equal(edgeAfter(CARRIED + 4000), CARRIED + 4000);
});
