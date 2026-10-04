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
import { BOTTOM_BARS, setBottomBar } from "../../../../hqptuner/static/store/ui/faceplate.js";
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

/** The settings rail's entries inside the settings body. */
const settingsEntries = () => {
  const setbody = frame().find((e) => classes(e).includes("setbody"));
  return setbody ? elements(setbody.html).filter((e) => e.name === "button" && classes(e).includes("sst")) : [];
};

test("test_the_gear_draws_the_settings_rail_in_place_of_the_chain_rail", () => {
  body.value = "settings";
  assert.deepEqual([settingsEntries().length > 0, stages().length], [true, 0]);
});

test("test_the_snapshot_builder_draws_its_rail_and_page_in_the_builder_body", () => {
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
  assert.deepEqual(
    [
      shown ? isDiv(shown, "body") : false,
      inner.some((e) => e.name === "nav" && classes(e).includes("brail")),
      inner.some((e) => e.name === "main" && classes(e).includes("bpage")),
    ],
    [true, true, true],
  );
});

test("test_the_gear_reads_pressed_while_the_settings_body_shows", () => {
  body.value = "settings";
  const gear = frame().find((e) => e.name === "button" && attr(e, "data-testid") === "settings");
  assert.equal(gear ? attr(gear, "aria-pressed") : undefined, "true");
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

test("test_a_stage_with_a_registered_drawer_draws_that_drawers_body", () => {
  toggleStage("source");
  const open = frame().find((e) => e.name === "aside" && !hasAttr(e, "data-closed"));
  const blocks = open
    ? elements(open.html)
        .map((e) => attr(e, "data-block"))
        .filter((b) => b !== undefined)
    : [];
  assert.deepEqual(blocks, ["meter"]);
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

test("test_the_chain_body_holds_the_option_list_sheet", () => {
  assert.ok(frame().some((e) => e.name === "aside" && classes(e).includes("osheet")));
});

test("test_the_gear_takes_the_option_list_sheet_off_the_plate", () => {
  showBody("settings");
  assert.ok(!frame().some((e) => e.name === "aside" && classes(e).includes("osheet")));
});

/** The plate's own element. */
const plateEl = () => frame().find((e) => e.name === "div" && classes(e).includes("plate"));

/** The plate's own children, in order. */
const plateChildren = () => {
  const plate = plateEl();
  const inner = plate ? elements(plate.html).filter((e) => e.start > 0) : [];
  /** @type {MarkupElement[]} */
  const kids = [];
  for (const e of inner.sort((a, b) => a.start - b.start)) {
    const last = kids.at(-1);
    if (!last || e.start >= last.start + last.html.length) kids.push(e);
  }
  return kids;
};

/**
 * Whether an element is a div carrying every class named.
 *
 * @param {MarkupElement | undefined} e
 * @param {string[]} cls
 */
const isDiv = (e, ...cls) => e?.name === "div" && cls.every((c) => classes(e).includes(c));

for (const shown of /** @type {import("../../../../hqptuner/static/store/faceplate/view.js").Body[]} */ ([
  "chain",
  "settings",
  "snapshots",
])) {
  test(`test_the_plate_ends_with_the_bottom_rule_then_the_switcher_under_the_${shown}_body`, () => {
    body.value = shown;
    const [rule, sw] = plateChildren().slice(-2);
    assert.deepEqual([isDiv(rule, "rule", "botrule"), isDiv(sw, "switcher")], [true, true]);
  });
}

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
