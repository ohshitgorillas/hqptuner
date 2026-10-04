// Behavioral suite for hqptuner/static/model/shell/place.js: where a plate-level popover lands against its anchor, and how the
// plate's side and foot margins pull it back inside.
//
// The plate is one the test writes: 1000 × 800 layout px, 20 px side margins, a 14 px foot. Anchors are screen px from
// the plate's corner, so at scale 0.5 every anchor number doubles on the plate.
//
// Run: node --test tests/js/model/shell/place.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { clampToPlate } from "../../../../hqptuner/static/model/shell/place.js";

/** @typedef {import("../../../../hqptuner/static/model/shell/place.js").Rect} Rect */
/** @typedef {import("../../../../hqptuner/static/model/shell/place.js").Size} Size */
/** @typedef {import("../../../../hqptuner/static/model/shell/place.js").Place} Place */
/** @typedef {import("../../../../hqptuner/static/model/shell/place.js").Margin} Margin */
/** @typedef {import("../../../../hqptuner/static/model/shell/place.js").Side} Side */

const PLATE = { w: 1000, h: 800 };
const SIDE = 20;
const FOOT = 14;

/**
 * One placement and the coordinate it owes.
 *
 * @typedef {object} Row
 * @property {string} name
 * @property {Rect} anchor
 * @property {Size} panel
 * @property {Place} at
 * @property {number} want
 * @property {number} [scale]
 * @property {Side} [side]
 * @property {Margin} [foot]
 */

/** @param {Row} row */
const placed = (row) =>
  clampToPlate({
    anchor: row.anchor,
    panel: row.panel,
    plate: PLATE,
    scale: row.scale ?? 1,
    side: row.side === undefined ? SIDE : row.side,
    foot: row.foot === undefined ? FOOT : row.foot,
    at: row.at,
  });

/** @type {Place} */
const START = { x: "start", y: "top", gap: 0 };
/** @type {Place} */
const BEFORE = { x: "before", y: "top", gap: 12 };

/** @type {Row[]} */
const LEFTS = [
  {
    name: "a_start_panel_shares_the_anchor_left_edge",
    anchor: { left: 100, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: START,
    want: 100,
  },
  {
    name: "a_start_panel_past_the_right_margin_comes_back_inside",
    anchor: { left: 800, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: START,
    want: 680,
  },
  {
    name: "a_start_panel_left_of_the_left_margin_comes_back_inside",
    anchor: { left: 5, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: START,
    want: 20,
  },
  {
    name: "a_panel_wider_than_the_room_keeps_its_left_edge_at_the_margin",
    anchor: { left: 400, top: 0, width: 40, height: 20 },
    panel: { w: 980, h: 100 },
    at: START,
    want: 20,
  },
  {
    name: "a_before_panel_ends_the_gap_short_of_the_anchor",
    anchor: { left: 500, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: BEFORE,
    want: 188,
  },
  {
    name: "a_before_panel_past_the_left_margin_comes_back_inside",
    anchor: { left: 200, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: BEFORE,
    want: 20,
  },
  {
    name: "an_open_right_edge_lets_the_panel_past_it",
    anchor: { left: 995, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: BEFORE,
    side: [20, null],
    want: 683,
  },
  {
    name: "an_open_left_edge_lets_the_panel_past_it",
    anchor: { left: -50, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: START,
    side: [null, 20],
    want: -50,
  },
  {
    name: "open_sides_leave_the_anchor_left_edge_as_it_is",
    anchor: { left: 900, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: START,
    side: null,
    want: 900,
  },
  {
    name: "the_anchor_left_edge_is_divided_by_the_scale",
    anchor: { left: 100, top: 0, width: 40, height: 20 },
    panel: { w: 300, h: 100 },
    at: START,
    scale: 0.5,
    want: 200,
  },
];

for (const row of LEFTS) {
  test(`test_${row.name}`, () => {
    assert.equal(placed(row).left, row.want);
  });
}

/** @type {Place} */
const TOP = { x: "start", y: "top", gap: 0 };
/** @type {Place} */
const BELOW = { x: "start", y: "below", gap: 8 };
/** @type {Place} */
const FLIP = { x: "start", y: "flip", gap: 6 };

/** @type {Row[]} */
const TOPS = [
  {
    name: "a_top_panel_shares_the_anchor_top_edge",
    anchor: { left: 0, top: 100, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: TOP,
    want: 100,
  },
  {
    name: "a_top_panel_past_the_foot_comes_back_inside",
    anchor: { left: 0, top: 600, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: TOP,
    want: 486,
  },
  {
    name: "a_below_panel_drops_the_gap_under_the_anchor",
    anchor: { left: 0, top: 100, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: BELOW,
    want: 138,
  },
  {
    name: "a_below_panel_past_the_foot_comes_back_inside",
    anchor: { left: 0, top: 500, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: BELOW,
    want: 486,
  },
  {
    name: "a_flip_panel_with_room_drops_under_the_anchor",
    anchor: { left: 0, top: 100, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: FLIP,
    want: 136,
  },
  {
    name: "a_flip_panel_without_room_below_opens_above_the_anchor",
    anchor: { left: 0, top: 500, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: FLIP,
    want: 194,
  },
  {
    name: "a_flip_panel_that_just_meets_the_foot_stays_below",
    anchor: { left: 0, top: 450, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: FLIP,
    want: 486,
  },
  {
    name: "an_open_foot_lets_the_panel_past_it",
    anchor: { left: 0, top: 700, width: 40, height: 30 },
    panel: { w: 300, h: 300 },
    at: BELOW,
    foot: null,
    want: 738,
  },
  {
    name: "the_anchor_top_and_height_are_divided_by_the_scale",
    anchor: { left: 0, top: 100, width: 40, height: 20 },
    panel: { w: 300, h: 300 },
    at: BELOW,
    scale: 0.5,
    want: 248,
  },
];

for (const row of TOPS) {
  test(`test_${row.name}`, () => {
    assert.equal(placed(row).top, row.want);
  });
}
