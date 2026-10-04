// Behavioral suite for mockup/scripts/model/speakers.js: where each speaker of a set sits on the top-down room plan
// (the listener at the origin facing up the page, each speaker at its layout angle, at a radius set by its distance,
// the sub pushed out) and how far the plan's box reaches to fit them.
//
// The layout is one the test writes: channel 0 straight ahead, 1 at the right, 2 at the left, 3 the sub straight ahead.
//
// Run: node --test tests/js/mockup/speakers.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { HEAD, placeSpeakers, planExtent } from "../../../../mockup/scripts/model/speakers.js";

const LAYOUT = [0, 90, -90, 0];
const EPS = 1e-9;

/**
 * One speaker placed at one distance and the radius it owes, in plan units.
 *
 * @typedef {object} Row
 * @property {string} name
 * @property {number} ch
 * @property {number} cm
 * @property {number} want
 */

/** @type {Row[]} */
const RADII = [
  { name: "a_speaker_at_no_distance_sits_on_the_head", ch: 0, cm: 0, want: 13 },
  { name: "a_speaker_at_six_metres_sits_on_the_ring", ch: 0, cm: 600, want: 122 },
  { name: "a_speaker_at_three_metres_sits_halfway_out", ch: 0, cm: 300, want: 67.5 },
  { name: "a_speaker_past_six_metres_stays_on_the_ring", ch: 0, cm: 900, want: 122 },
  { name: "a_negative_distance_sits_on_the_head", ch: 0, cm: -40, want: 13 },
  { name: "the_sub_sits_out_past_its_distance", ch: 3, cm: 300, want: 91.125 },
  { name: "the_sub_stops_at_its_cap", ch: 3, cm: 600, want: 140 },
];

/**
 * The radius of one channel placed alone at one distance.
 *
 * @param {number} ch
 * @param {number} cm
 */
const radius = (ch, cm) => {
  const cms = LAYOUT.map(() => 0);
  cms[ch] = cm;
  const [p] = placeSpeakers([ch], LAYOUT, cms);
  return Math.hypot(p.x, p.y);
};

for (const row of RADII) {
  test(`test_${row.name}`, () => {
    assert.ok(Math.abs(radius(row.ch, row.cm) - row.want) < EPS);
  });
}

//: The whole set at the ring, in a set order the test writes.
const SET = [2, 0, 1];
const RING = [600, 600, 600, 600];

test("test_head_is_the_radius_at_no_distance", () => {
  assert.ok(Math.abs(radius(0, 0) - HEAD) < EPS);
});

test("test_place_speakers_keeps_the_set_order", () => {
  assert.deepEqual(
    placeSpeakers(SET, LAYOUT, RING).map((p) => p.i),
    SET,
  );
});

test("test_place_speakers_turns_each_speaker_to_its_layout_angle", () => {
  assert.deepEqual(
    placeSpeakers(SET, LAYOUT, RING).map((p) => p.deg),
    [-90, 0, 90],
  );
});

test("test_a_front_speaker_sits_up_the_page", () => {
  assert.ok(Math.abs(placeSpeakers([0], LAYOUT, RING)[0].y + 122) < EPS);
});

test("test_a_right_speaker_sits_right_of_the_listener", () => {
  assert.ok(Math.abs(placeSpeakers([1], LAYOUT, RING)[0].x - 122) < EPS);
});

test("test_a_left_speaker_sits_left_of_the_listener", () => {
  assert.ok(Math.abs(placeSpeakers([2], LAYOUT, RING)[0].x + 122) < EPS);
});

test("test_channel_three_is_the_sub", () => {
  assert.deepEqual(
    placeSpeakers([0, 3], LAYOUT, RING).map((p) => p.sub),
    [false, true],
  );
});

test("test_plan_extent_fits_the_head_alone", () => {
  assert.equal(planExtent([]), 33);
});

test("test_plan_extent_leaves_label_room_under_a_front_speaker", () => {
  assert.ok(Math.abs(planExtent(placeSpeakers([0], LAYOUT, RING)) - 162) < EPS);
});

test("test_plan_extent_leaves_room_beside_a_side_speaker", () => {
  assert.ok(Math.abs(planExtent(placeSpeakers([1, 2], LAYOUT, RING)) - 148) < EPS);
});
