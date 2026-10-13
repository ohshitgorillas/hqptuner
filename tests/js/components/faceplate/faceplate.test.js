// Rendered suite for the frame the entry composes (hqptuner/static/app.js): the header and the engine row stay
// whatever body shows, the chain body holds the rail, the page and one drawer per rail stage, and a builder or the
// gear swaps the whole body away. One drawer is open at a time, the one whose stage was tapped.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/faceplate.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import "../../support/domseam.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import { body, openStage, openPopover, showBody } from "../../../../hqptuner/static/store/faceplate/view.js";
import { BOTTOM_BARS, setBottomBar } from "../../../../hqptuner/static/store/ui/prefs.js";
import { TARGETS, setSwitcherTarget } from "../../../../hqptuner/static/store/faceplate/bottom/switcher.js";
import { config } from "../../../../hqptuner/static/store/signals.js";
import { liveBook } from "../../../../hqptuner/static/store/live/presets.js";
import { elements, attr, hasAttr, classes } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

beforeEach(() => {
  body.value = "chain";
  openStage.value = null;
  openPopover.value = null;
  setBottomBar(BOTTOM_BARS[0]);
  setSwitcherTarget(TARGETS[0]);
  config.value = null;
  liveBook.value = null;
});

/** Every element of the rendered frame. */
const frame = () => elements(render(html`<${Faceplate} />`));

/** The chain rail's stage buttons. */
const stages = () =>
  frame().filter((e) => e.name === "button" && classes(e).includes("st") && !classes(e).includes("sst"));

/** The ids of the stages whose drawer is rendered open. */
const openDrawers = () =>
  frame()
    .filter((e) => e.name === "aside" && classes(e).includes("drawer") && !hasAttr(e, "data-closed"))
    .map((e) => attr(e, "id"));

test("test_the_chain_body_holds_one_drawer_for_each_rail_stage", () => {
  const drawers = frame().filter((e) => e.name === "aside" && classes(e).includes("drawer"));
  assert.equal(drawers.length, stages().length);
});

test("test_no_drawer_is_open_until_a_stage_is_tapped", () => {
  assert.deepEqual(openDrawers(), []);
});

test("test_the_snapshot_builder_body_holds_the_option_list", () => {
  config.value = {
    fields: [],
    file: {},
    profiles: { options: [{ value: "" }, { value: "Desk" }] },
    active: "Desk",
  };
  liveBook.value = { Desk: { Near: { chain: "pcm", fields: { mode: "pcm" }, names: {} } } };
  showBody("snapshots");
  const shown = frame().find((e) => e.name === "div" && attr(e, "data-body") === "snapshots");
  const inner = shown ? elements(shown.html) : [];
  assert.ok(inner.some((e) => attr(e, "data-testid") === "option-list"));
});

test("test_the_body_shown_is_named_on_the_plate", () => {
  showBody("station");
  const shown = frame()
    .filter((e) => classes(e).includes("body"))
    .map((e) => attr(e, "data-body"));
  assert.deepEqual(shown, ["station"]);
});

/** The ids of the plate-level popover panels the chain body holds. */
const panels = () =>
  frame()
    .filter((e) => e.name === "div" && classes(e).includes("pop"))
    .map((e) => attr(e, "data-pop"));

test("test_the_chain_body_holds_the_filter_presets_popover", () => {
  assert.ok(panels().includes("presets"));
});

test("test_the_gear_takes_the_filter_presets_popover_off_the_plate", () => {
  showBody("settings");
  assert.ok(!panels().includes("presets"));
});

test("test_the_frame_holds_the_connection_panel", () => {
  assert.ok(frame().some((e) => e.name === "aside" && attr(e, "data-testid") === "conn-panel"));
});

/** The plate's own element. */
const plateEl = () => frame().find((e) => e.name === "div" && classes(e).includes("plate"));

for (const bar of BOTTOM_BARS) {
  test(`test_the_plate_carries_the_${bar}_bottom_bar_preference`, () => {
    setBottomBar(bar);
    const plate = plateEl();
    assert.equal(plate ? attr(plate, "data-bottom") : undefined, bar);
  });
}

/**
 * An attribute's value, a bare attribute read as "", undefined where the element does not carry it.
 *
 * @param {MarkupElement} e
 * @param {string} name
 */
const attrValue = (e, name) => (hasAttr(e, name) ? (attr(e, name) ?? "") : undefined);

for (const target of TARGETS) {
  const want = target === "Volume" ? "volume" : "";
  const slug = target.toLowerCase().replace(/\W+/g, "_");
  test(`test_the_plate_marks_the_volume_switcher_only_while_volume_is_the_target_${slug}`, () => {
    setSwitcherTarget(target);
    const plate = plateEl();
    assert.equal(plate ? attrValue(plate, "data-sw") : undefined, want);
  });
}
