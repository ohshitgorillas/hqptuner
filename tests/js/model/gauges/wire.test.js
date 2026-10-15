// Behavioral suite for hqptuner/static/model/gauges/wire.js: where the chain rail's lamp dots land from measured boxes
// and the path data of the wire joining them in both styles.
//
// Every box is one the test writes, in screen px from the viewport corner; every dot and path is worked out by hand
// from those boxes. The wire's corners are 5 px chamfers.
//
// Run: node --test tests/js/model/gauges/wire.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { lampDots, wirePath } from "../../../../hqptuner/static/model/gauges/wire.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").Box} Box */
/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").Dot} Dot */
/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").Lamp} Lamp */

// --- lamp dots ---------------------------------------------------------------------------------------------------

/** @type {Box} */
const RAIL = { left: 100, top: 50, width: 200, height: 400 };

/**
 * @param {number} left
 * @param {number} top
 * @returns {Lamp}
 */
const lamp = (left, top) => ({ box: { left, top, width: 8, height: 8 }, level: 0, on: true });

/**
 * One lamp and where its dot lands.
 *
 * @typedef {object} DotRow
 * @property {string} name
 * @property {Lamp} lamp
 * @property {'x' | 'y'} axis
 * @property {number} want
 */

/** @type {DotRow[]} */
const DOTS = [
  {
    name: "a_dot_sits_at_the_lamp_center_across_the_rail_plus_half_a_pixel",
    lamp: lamp(110, 60),
    axis: "x",
    want: 14.5,
  },
  {
    name: "a_dot_sits_at_the_lamp_center_down_the_rail_plus_half_a_pixel",
    lamp: lamp(110, 60),
    axis: "y",
    want: 14.5,
  },
  { name: "a_lamp_center_short_of_the_half_pixel_rounds_down", lamp: lamp(110.3, 60), axis: "x", want: 14.5 },
  { name: "a_lamp_center_past_the_half_pixel_rounds_up", lamp: lamp(110.6, 60), axis: "x", want: 15.5 },
];

for (const row of DOTS) {
  test(`test_${row.name}`, () => {
    assert.equal(lampDots({ rail: RAIL, lamps: [row.lamp] })[0][row.axis], row.want);
  });
}

test("test_a_dot_keeps_its_lamp_level", () => {
  const lamps = [{ box: { left: 110, top: 60, width: 8, height: 8 }, level: 2, on: true }];
  assert.equal(lampDots({ rail: RAIL, lamps })[0].level, 2);
});

test("test_a_dot_keeps_its_lamp_unlit", () => {
  const lamps = [{ box: { left: 110, top: 60, width: 8, height: 8 }, level: 0, on: false }];
  assert.equal(lampDots({ rail: RAIL, lamps })[0].on, false);
});

// --- wire path ---------------------------------------------------------------------------------------------------

/**
 * @param {number} x
 * @param {number} y
 * @param {number} level
 * @param {boolean} [on]
 * @returns {Dot}
 */
const dot = (x, y, level, on = true) => ({ x, y, level, on });

/**
 * A set of dots, the wire style, and the path data joining them.
 *
 * @typedef {object} WireRow
 * @property {string} name
 * @property {Dot[]} dots
 * @property {'trunk' | 'routed'} style
 * @property {string} want
 */

/** @type {WireRow[]} */
const WIRES = [
  {
    name: "a_routed_wire_drops_straight_between_dots_in_one_column",
    dots: [dot(10.5, 10.5, 0), dot(10.5, 40.5, 0)],
    style: "routed",
    want: "M10.5,10.5 L10.5,40.5",
  },
  {
    name: "a_routed_wire_treats_dots_under_a_pixel_apart_as_one_column",
    dots: [dot(10.5, 10.5, 0), dot(11, 40.5, 0)],
    style: "routed",
    want: "M10.5,10.5 L11,40.5",
  },
  {
    name: "a_trunk_runs_from_the_first_top_level_dot_to_the_last",
    dots: [dot(10.5, 10.5, 0), dot(10.5, 60.5, 0)],
    style: "trunk",
    want: "M10.5,10.5 L10.5,60.5",
  },
  {
    name: "an_unlit_child_gets_no_tap",
    dots: [dot(10.5, 10.5, 0), dot(30.5, 20.5, 1), dot(30.5, 30.5, 1, false), dot(10.5, 60.5, 0)],
    style: "trunk",
    want: "M10.5,10.5 L10.5,60.5 M10.5,20.5 L30.5,20.5",
  },
  {
    name: "an_unlit_parent_drops_no_bus",
    dots: [dot(10.5, 10.5, 0, false), dot(30.5, 20.5, 1), dot(10.5, 60.5, 0)],
    style: "trunk",
    want: "M10.5,10.5 L10.5,60.5",
  },
];

for (const row of WIRES) {
  test(`test_${row.name}`, () => {
    assert.equal(wirePath(row.dots, row.style), row.want);
  });
}
