// Behavioral suite for hqptuner/static/store/faceplate/view.js: which body the plate shows, which stage's drawer is
// open and which popover is open. One drawer and one popover at a time; a body swap closes both; Escape closes the
// popover first and the drawer only when no popover is open.
//
// Run: node --test tests/js/store/faceplate/view.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  body,
  openStage,
  openPopover,
  showBody,
  toggleStage,
  togglePopover,
  closeTop,
  closeOutside,
  viewport,
  plate,
} from "../../../../hqptuner/static/store/faceplate/view.js";

beforeEach(() => {
  body.value = "chain";
  openStage.value = null;
  openPopover.value = null;
  viewport.value = { w: 1080, h: 810 };
});

test("test_tapping_a_second_stage_replaces_the_open_drawer", () => {
  toggleStage("volume");
  toggleStage("output");
  assert.equal(openStage.value, "output");
});

test("test_tapping_the_open_stage_again_closes_its_drawer", () => {
  toggleStage("volume");
  toggleStage("volume");
  assert.equal(openStage.value, null);
});

test("test_opening_a_second_popover_replaces_the_open_one", () => {
  togglePopover("stations");
  togglePopover("volume");
  assert.equal(openPopover.value, "volume");
});

test("test_escape_with_a_popover_over_a_drawer_leaves_the_drawer_open", () => {
  toggleStage("volume");
  togglePopover("stations");
  closeTop();
  assert.equal(openStage.value, "volume");
});

test("test_escape_with_a_popover_over_a_drawer_closes_the_popover", () => {
  toggleStage("volume");
  togglePopover("stations");
  closeTop();
  assert.equal(openPopover.value, null);
});

test("test_escape_with_only_a_drawer_open_closes_the_drawer", () => {
  toggleStage("volume");
  closeTop();
  assert.equal(openStage.value, null);
});

test("test_a_body_swap_closes_the_open_drawer", () => {
  toggleStage("volume");
  showBody("settings");
  assert.equal(openStage.value, null);
});

test("test_picking_the_body_already_shown_returns_to_the_chain", () => {
  showBody("settings");
  showBody("settings");
  assert.equal(body.value, "chain");
});

test("test_picking_another_body_swaps_to_it", () => {
  showBody("settings");
  showBody("snapshots");
  assert.equal(body.value, "snapshots");
});

/** A click target inside (or outside) a popover's own zone, as the document's click listener reads it. */
const target = (/** @type {boolean} */ inside) => ({ closest: () => (inside ? {} : null), isConnected: true });

test("test_a_click_outside_the_open_popover_closes_it", () => {
  togglePopover("stations");
  closeOutside(target(false));
  assert.equal(openPopover.value, null);
});

test("test_a_click_inside_the_open_popover_keeps_it_open", () => {
  togglePopover("stations");
  closeOutside(target(true));
  assert.equal(openPopover.value, "stations");
});

test("test_the_plate_follows_the_window_to_a_larger_size", () => {
  viewport.value = { w: 1366, h: 1024 };
  assert.equal(plate.value.id, "13");
});
