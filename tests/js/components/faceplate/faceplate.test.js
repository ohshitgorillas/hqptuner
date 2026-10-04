// Rendered suite for the frame the v2 entry composes (hqptuner/static/v2/app.js): the header and the engine row stay
// whatever body shows, the chain body holds the rail, the page and one drawer per rail stage, and a builder or the
// gear swaps the whole body away. One drawer is open at a time, the one whose stage was tapped.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/faceplate.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import "../../support/domseam.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/v2/app.js";
import {
  body,
  openStage,
  openPopover,
  toggleStage,
  showBody,
} from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, hasAttr, classes } from "../../support/markup.js";

beforeEach(() => {
  body.value = "chain";
  openStage.value = null;
  openPopover.value = null;
});

/** Every element of the rendered frame. */
const frame = () => elements(render(html`<${Faceplate} />`));

/** The rail's stage buttons. */
const stages = () => frame().filter((e) => e.name === "button" && classes(e).includes("st"));

/** The ids of the stages whose drawer is rendered open. */
const openDrawers = () =>
  frame()
    .filter((e) => e.name === "aside" && !hasAttr(e, "data-closed"))
    .map((e) => attr(e, "id"));

test("test_the_chain_body_holds_one_drawer_for_each_rail_stage", () => {
  const drawers = frame().filter((e) => e.name === "aside");
  assert.equal(drawers.length, stages().length);
});

test("test_no_drawer_is_open_until_a_stage_is_tapped", () => {
  assert.deepEqual(openDrawers(), []);
});

test("test_a_tapped_stage_opens_its_own_drawer_alone", () => {
  toggleStage("volume");
  assert.deepEqual(openDrawers(), ["drawer-volume"]);
});

test("test_a_second_tapped_stage_takes_the_open_drawer_over", () => {
  toggleStage("volume");
  toggleStage("output");
  assert.deepEqual(openDrawers(), ["drawer-output"]);
});

test("test_the_gear_swaps_the_rail_off_the_plate", () => {
  const before = stages().length;
  showBody("settings");
  assert.deepEqual([before > 0, stages().length], [true, 0]);
});

/** How many elements carry a class. */
const count = (/** @type {string} */ cls) => frame().filter((e) => classes(e).includes(cls)).length;

for (const cls of ["hdr", "engine"]) {
  test(`test_the_${cls}_row_stays_when_the_body_swaps`, () => {
    const before = count(cls);
    showBody("snapshots");
    assert.deepEqual([before, count(cls)], [1, 1]);
  });
}

test("test_the_body_shown_is_named_on_the_plate", () => {
  showBody("station");
  const shown = frame()
    .filter((e) => classes(e).includes("body"))
    .map((e) => attr(e, "data-body"));
  assert.deepEqual(shown, ["station"]);
});
