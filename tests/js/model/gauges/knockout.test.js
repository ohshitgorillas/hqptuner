// Behavioral suite for the knockout under a letter-spaced label on a drawing (hqptuner/static/model/gauges/knockout.js):
// one region covering the label's measured box, reaching the same fixed margin past it on the left and the right, at the
// label's own top and height.
//
// The margin's size is a design choice and is not pinned; the suite pins that it covers the box, that it is the same on
// both sides, and that it does not change with where the label sits or how wide it is.
//
// Gap: the components that draw a knockout (KnockedText, the Signal path's edges) measure the label in a layout effect
// through getBBox and ResizeObserver, which server-side rendering never runs, so the measured branch is a browser check.
//
// Run: node --test tests/js/model/gauges/knockout.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { knockout } from "../../../../hqptuner/static/model/gauges/knockout.js";

//: A short label near the drawing's left.
const NARROW = { x: 30, y: 8, width: 40, height: 14 };
//: A wider label further right and lower.
const WIDE = { x: 150, y: 30, width: 120, height: 14 };

/**
 * How far a box's knockout reaches past its left side.
 *
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @returns {number}
 */
const leftMargin = (box) => box.x - knockout(box).x;

/**
 * How far a box's knockout reaches past its right side.
 *
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @returns {number}
 */
const rightMargin = (box) => {
  const k = knockout(box);
  return k.x + k.width - (box.x + box.width);
};

test("test_the_knockout_reaches_past_the_labels_left_side", () => {
  assert.ok(leftMargin(NARROW) > 0);
});

test("test_the_knockout_reaches_past_the_labels_right_side", () => {
  assert.ok(rightMargin(NARROW) > 0);
});

test("test_the_knockout_reaches_as_far_past_the_right_side_as_past_the_left", () => {
  assert.equal(rightMargin(NARROW), leftMargin(NARROW));
});

test("test_the_knockouts_margin_is_the_same_whatever_the_labels_place_and_width", () => {
  assert.equal(leftMargin(WIDE), leftMargin(NARROW));
});

test("test_the_knockout_starts_at_the_labels_own_top", () => {
  assert.equal(knockout(WIDE).y, 30);
});

test("test_the_knockout_is_the_labels_own_height", () => {
  assert.equal(knockout(WIDE).height, 14);
});
