// Behavioral suite for hqptuner/static/model/gauges/wire.js: where the chain rail's lamp dots land from measured boxes, the
// path data of the wire joining them in both styles, the frame a signal-path group draws around its nodes, and which
// signal-path nodes and edges read lit or bypassed.
//
// Every box is one the test writes, in screen px from the viewport corner; every dot, path and frame is worked out by
// hand from those boxes. The wire's corners are 5 px chamfers.
//
// Run: node --test tests/js/model/gauges/wire.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { groupFrame, lampDots, pathLamps, wirePath } from "../../../../hqptuner/static/model/gauges/wire.js";

/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").Box} Box */
/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").Dot} Dot */
/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").Lamp} Lamp */
/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").MapEdge} MapEdge */
/** @typedef {import("../../../../hqptuner/static/model/gauges/wire.js").MapNode} MapNode */

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
 * One lamp, the scale it was measured at, and where its dot lands.
 *
 * @typedef {object} DotRow
 * @property {string} name
 * @property {Lamp} lamp
 * @property {number} scale
 * @property {'x' | 'y'} axis
 * @property {number} want
 */

/** @type {DotRow[]} */
const DOTS = [
  {
    name: "a_dot_sits_at_the_lamp_centre_across_the_rail_plus_half_a_pixel",
    lamp: lamp(110, 60),
    scale: 1,
    axis: "x",
    want: 14.5,
  },
  {
    name: "a_dot_sits_at_the_lamp_centre_down_the_rail_plus_half_a_pixel",
    lamp: lamp(110, 60),
    scale: 1,
    axis: "y",
    want: 14.5,
  },
  { name: "a_dot_across_the_rail_is_divided_by_the_scale", lamp: lamp(110, 80), scale: 0.5, axis: "x", want: 28.5 },
  { name: "a_dot_down_the_rail_is_divided_by_the_scale", lamp: lamp(110, 80), scale: 0.5, axis: "y", want: 68.5 },
  { name: "a_lamp_centre_short_of_the_half_pixel_rounds_down", lamp: lamp(110.3, 60), scale: 1, axis: "x", want: 14.5 },
  { name: "a_lamp_centre_past_the_half_pixel_rounds_up", lamp: lamp(110.6, 60), scale: 1, axis: "x", want: 15.5 },
];

for (const row of DOTS) {
  test(`test_${row.name}`, () => {
    assert.equal(lampDots({ rail: RAIL, lamps: [row.lamp], scale: row.scale })[0][row.axis], row.want);
  });
}

test("test_a_dot_keeps_its_lamp_level", () => {
  const lamps = [{ box: { left: 110, top: 60, width: 8, height: 8 }, level: 2, on: true }];
  assert.equal(lampDots({ rail: RAIL, lamps, scale: 1 })[0].level, 2);
});

test("test_a_dot_keeps_its_lamp_unlit", () => {
  const lamps = [{ box: { left: 110, top: 60, width: 8, height: 8 }, level: 0, on: false }];
  assert.equal(lampDots({ rail: RAIL, lamps, scale: 1 })[0].on, false);
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
    name: "a_routed_wire_stepping_right_turns_eleven_pixels_above_the_next_dot",
    dots: [dot(10.5, 10.5, 0), dot(30.5, 40.5, 1)],
    style: "routed",
    want: "M10.5,10.5 L10.5,24.5 L15.5,29.5 L25.5,29.5 L30.5,34.5 L30.5,40.5",
  },
  {
    name: "a_routed_wire_stepping_left_turns_halfway_between_the_dots",
    dots: [dot(30.5, 10.5, 1), dot(10.5, 40.5, 0)],
    style: "routed",
    want: "M30.5,10.5 L30.5,21.5 L25.5,26.5 L15.5,26.5 L10.5,31.5 L10.5,40.5",
  },
  {
    name: "a_trunk_runs_from_the_first_top_level_dot_to_the_last",
    dots: [dot(10.5, 10.5, 0), dot(10.5, 60.5, 0)],
    style: "trunk",
    want: "M10.5,10.5 L10.5,60.5",
  },
  {
    name: "a_trunk_continuing_past_the_children_taps_each_one_square",
    dots: [dot(10.5, 10.5, 0), dot(30.5, 20.5, 1), dot(30.5, 30.5, 1), dot(10.5, 60.5, 0)],
    style: "trunk",
    want: "M10.5,10.5 L10.5,60.5 M10.5,20.5 L30.5,20.5 M10.5,30.5 L30.5,30.5",
  },
  {
    name: "a_trunk_ending_at_the_parent_joins_its_last_child_on_a_chamfer",
    dots: [dot(10.5, 10.5, 0), dot(30.5, 20.5, 1), dot(30.5, 30.5, 1)],
    style: "trunk",
    want: "M10.5,10.5 L10.5,10.5 M10.5,20.5 L30.5,20.5 M10.5,10.5 L10.5,25.5 L15.5,30.5 L30.5,30.5",
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
  {
    name: "a_nested_parent_joins_its_last_child_on_a_chamfer_from_its_own_column",
    dots: [dot(10.5, 10.5, 0), dot(30.5, 20.5, 1), dot(50.5, 30.5, 2), dot(10.5, 60.5, 0)],
    style: "trunk",
    want: "M10.5,10.5 L10.5,60.5 M10.5,20.5 L30.5,20.5 M30.5,20.5 L30.5,25.5 L35.5,30.5 L50.5,30.5",
  },
];

for (const row of WIRES) {
  test(`test_${row.name}`, () => {
    assert.equal(wirePath(row.dots, row.style), row.want);
  });
}

// --- group frame -------------------------------------------------------------------------------------------------

/** @type {Box[]} */
const COLUMN = [
  { left: 100, top: 200, width: 118, height: 50 },
  { left: 80, top: 300, width: 100, height: 50 },
];

/**
 * One frame coordinate around COLUMN, with or without a subtitle.
 *
 * @typedef {object} FrameRow
 * @property {string} name
 * @property {boolean} sub
 * @property {(f: ReturnType<typeof groupFrame>) => number} pick
 * @property {number} want
 */

/** @type {FrameRow[]} */
const FRAMES = [
  { name: "a_frame_starts_nine_pixels_left_of_its_leftmost_node", sub: false, pick: (f) => f.frame.x, want: 71 },
  { name: "a_frame_spans_nine_pixels_past_its_nodes_either_side", sub: false, pick: (f) => f.frame.width, want: 156 },
  { name: "a_frame_opens_thirty_pixels_above_its_top_node", sub: false, pick: (f) => f.frame.y, want: 170 },
  { name: "a_frame_closes_twelve_pixels_under_its_bottom_node", sub: false, pick: (f) => f.frame.height, want: 192 },
  { name: "a_subtitled_frame_opens_forty_six_pixels_above_its_top_node", sub: true, pick: (f) => f.frame.y, want: 154 },
  { name: "a_frame_title_sits_nine_pixels_inside_its_left_edge", sub: false, pick: (f) => f.title.x, want: 80 },
  { name: "a_frame_title_sits_eighteen_pixels_under_its_top_edge", sub: false, pick: (f) => f.title.y, want: 188 },
  { name: "a_frame_subtitle_sits_thirty_four_pixels_under_its_top_edge", sub: true, pick: (f) => f.sub.y, want: 188 },
];

for (const row of FRAMES) {
  test(`test_${row.name}`, () => {
    assert.equal(row.pick(groupFrame({ boxes: COLUMN, sub: row.sub })), row.want);
  });
}

// --- lit and bypassed --------------------------------------------------------------------------------------------

/** @type {MapNode[]} */
const NODES = [{ id: "src" }, { id: "mx" }, { id: "fx", rail: "fx" }, { id: "out" }];

/** @type {MapEdge[]} */
const EDGES = [
  { a: "src", b: "mx" },
  { a: "src", b: "out", direct: true },
];

/**
 * One reading of the map: what the path runs, which stages are engaged, and the flag one node or edge owes.
 *
 * @typedef {object} LampRow
 * @property {string} name
 * @property {string[]} lit
 * @property {string[]} engaged
 * @property {boolean} [direct]
 * @property {(m: ReturnType<typeof pathLamps>) => boolean} pick
 * @property {boolean} want
 */

/** @type {LampRow[]} */
const LAMPS = [
  { name: "a_node_on_the_path_reads_lit", lit: ["src"], engaged: [], pick: (m) => m.nodes.src.lit, want: true },
  { name: "a_node_off_the_path_reads_unlit", lit: ["src"], engaged: [], pick: (m) => m.nodes.out.lit, want: false },
  {
    name: "a_matrix_part_on_the_path_is_bypassed_with_the_matrix_disengaged",
    lit: ["mx"],
    engaged: [],
    pick: (m) => m.nodes.mx.off,
    want: true,
  },
  {
    name: "a_matrix_part_on_the_path_runs_with_the_matrix_engaged",
    lit: ["mx"],
    engaged: ["matrix"],
    pick: (m) => m.nodes.mx.off,
    want: false,
  },
  {
    name: "a_node_on_the_path_is_bypassed_with_its_own_stage_disengaged",
    lit: ["fx"],
    engaged: ["matrix"],
    pick: (m) => m.nodes.fx.off,
    want: true,
  },
  {
    name: "a_node_on_the_path_runs_with_its_own_stage_engaged",
    lit: ["fx"],
    engaged: ["fx"],
    pick: (m) => m.nodes.fx.off,
    want: false,
  },
  { name: "a_node_off_the_path_is_never_bypassed", lit: [], engaged: [], pick: (m) => m.nodes.mx.off, want: false },
  {
    name: "an_edge_with_both_ends_on_the_path_reads_lit",
    lit: ["src", "mx"],
    engaged: [],
    pick: (m) => m.edges[0],
    want: true,
  },
  {
    name: "an_edge_with_one_end_off_the_path_reads_unlit",
    lit: ["src"],
    engaged: [],
    pick: (m) => m.edges[0],
    want: false,
  },
  {
    name: "the_direct_edge_reads_lit_on_the_direct_path",
    lit: [],
    engaged: [],
    direct: true,
    pick: (m) => m.edges[1],
    want: true,
  },
  {
    name: "the_direct_edge_ignores_its_lit_ends_off_the_direct_path",
    lit: ["src", "out"],
    engaged: [],
    pick: (m) => m.edges[1],
    want: false,
  },
];

for (const row of LAMPS) {
  test(`test_${row.name}`, () => {
    const m = pathLamps({
      lit: new Set(row.lit),
      engaged: new Set(row.engaged),
      nodes: NODES,
      edges: EDGES,
      matrix: ["mx"],
      direct: row.direct ?? false,
    });
    assert.equal(row.pick(m), row.want);
  });
}
