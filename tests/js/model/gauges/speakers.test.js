// Behavioral suite: which speakers of a set are on the top-down room plan (only those with a distance or a level
// entered), where each sits (the listener at the origin facing up the page, each speaker at its layout angle, farther
// out the farther away it is, the sub pushed out) and the plan's box reaching far enough to hold them.
//
// The layout is one the test writes: channel 0 straight ahead, 1 at the right, 2 at the left, 3 the sub straight ahead.

import test from "node:test";
import assert from "node:assert/strict";

import { placeSpeakers, planExtent } from "../../../../hqptuner/static/model/gauges/speakers.js";

const LAYOUT = [0, 90, -90, 0];
const FRONT = 0;
const RIGHT = 1;
const LEFT = 2;
const SUB = 3;

//: HQPlayer's stock distance, meaning not set.
const UNSET_CM = 0;
//: Every channel's level at HQPlayer's stock 0, meaning not set.
const STOCK_LEVELS = LAYOUT.map(() => 0);
//: The two smallest set distances.
const NEAREST_CM = 1;
const NEXT_NEAREST_CM = 2;
//: Two ordinary room distances.
const NEAR_CM = 300;
const FAR_CM = 600;
//: The largest distance the daemon's form accepts.
const DISTANCE_MAX_CM = 5000;

/**
 * Where one channel is placed alone at one distance.
 *
 * @param {number} ch
 * @param {number} cm
 */
const place = (ch, cm) => {
  const cms = LAYOUT.map(() => cm);
  const [p] = placeSpeakers([ch], LAYOUT, cms, STOCK_LEVELS);
  return p;
};

/**
 * How far from the listener one channel is placed alone at one distance.
 *
 * @param {number} ch
 * @param {number} cm
 */
const radius = (ch, cm) => {
  const p = place(ch, cm);
  return Math.hypot(p.x, p.y);
};

/**
 * The plan's extent for the whole layout at one distance.
 *
 * @param {number} cm
 */
const extentAt = (cm) =>
  planExtent(
    placeSpeakers(
      LAYOUT.map((_, i) => i),
      LAYOUT,
      LAYOUT.map(() => cm),
      STOCK_LEVELS,
    ),
  );

//: The whole set at the ring, in a set order the test writes.
const SET = [2, 0, 1];
const RING = [600, 600, 600, 600];

// --- which speakers are drawn ------------------------------------------------------------------------------------

//: HQPlayer's stock level, meaning not set.
const UNSET_DB = 0;
//: A level someone entered.
const SET_DB = -3;

/**
 * Which channels are placed, given each channel's distance and level.
 *
 * @param {number[]} cms
 * @param {number[]} dbs
 */
const placed = (cms, dbs) =>
  placeSpeakers(
    LAYOUT.map((_, i) => i),
    LAYOUT,
    cms,
    dbs,
  ).map((p) => p.i);

test("test_a_speaker_with_neither_distance_nor_level_is_left_off_the_plan", () => {
  assert.deepEqual(
    placed(
      [UNSET_CM, NEAR_CM, NEAR_CM, NEAR_CM],
      LAYOUT.map(() => UNSET_DB),
    ),
    [RIGHT, LEFT, SUB],
  );
});

test("test_a_speaker_with_a_level_and_no_distance_is_on_the_plan", () => {
  assert.deepEqual(
    placed(
      LAYOUT.map(() => UNSET_CM),
      [UNSET_DB, SET_DB, UNSET_DB, UNSET_DB],
    ),
    [RIGHT],
  );
});

test("test_with_nothing_entered_for_any_speaker_the_plan_holds_none", () => {
  assert.deepEqual(
    placed(
      LAYOUT.map(() => UNSET_CM),
      LAYOUT.map(() => UNSET_DB),
    ),
    [],
  );
});

/**
 * How far from the listener the front speaker is placed at one distance with a level entered.
 *
 * @param {number} cm
 */
const leveledRadius = (cm) => {
  const [p] = placeSpeakers(
    [FRONT],
    LAYOUT,
    LAYOUT.map(() => cm),
    LAYOUT.map(() => SET_DB),
  );
  return Math.hypot(p.x, p.y);
};

test("test_a_speaker_with_a_level_and_no_distance_sits_nearer_than_one_at_the_nearest_set_distance", () => {
  assert.ok(leveledRadius(UNSET_CM) < leveledRadius(NEAREST_CM));
});

// --- distance ----------------------------------------------------------------------------------------------------

test("test_a_speaker_at_the_smallest_distances_sits_nearer_than_one_a_centimetre_farther", () => {
  assert.ok(radius(FRONT, NEAREST_CM) < radius(FRONT, NEXT_NEAREST_CM));
});

test("test_a_farther_speaker_sits_farther_from_the_listener", () => {
  assert.ok(radius(FRONT, NEAR_CM) < radius(FRONT, FAR_CM));
});

test("test_the_sub_sits_farther_out_than_a_main_speaker_at_the_same_distance", () => {
  assert.ok(radius(SUB, NEAR_CM) > radius(FRONT, NEAR_CM));
});

// --- the set and its angles --------------------------------------------------------------------------------------

test("test_place_speakers_keeps_the_set_order", () => {
  assert.deepEqual(
    placeSpeakers(SET, LAYOUT, RING, STOCK_LEVELS).map((p) => p.i),
    SET,
  );
});

test("test_place_speakers_turns_each_speaker_to_its_layout_angle", () => {
  assert.deepEqual(
    placeSpeakers(SET, LAYOUT, RING, STOCK_LEVELS).map((p) => p.deg),
    [-90, 0, 90],
  );
});

test("test_a_front_speaker_sits_up_the_page", () => {
  assert.ok(place(FRONT, FAR_CM).y < 0);
});

test("test_a_right_speaker_sits_right_of_the_listener", () => {
  assert.ok(place(RIGHT, FAR_CM).x > 0);
});

test("test_a_left_speaker_sits_left_of_the_listener", () => {
  assert.ok(place(LEFT, FAR_CM).x < 0);
});

test("test_channel_three_is_the_sub", () => {
  assert.deepEqual(
    placeSpeakers([0, 3], LAYOUT, RING, STOCK_LEVELS).map((p) => p.sub),
    [false, true],
  );
});

// --- the plan's extent -------------------------------------------------------------------------------------------

for (const ch of LAYOUT.keys()) {
  test(`test_the_plan_extent_holds_channel_${ch}_at_the_largest_distance`, () => {
    const p = place(ch, DISTANCE_MAX_CM);
    assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y)) < planExtent([p]));
  });
}

test("test_the_plan_extent_grows_as_the_speakers_move_out", () => {
  assert.ok(extentAt(NEAR_CM) < extentAt(FAR_CM));
});
