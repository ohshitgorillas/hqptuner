// Rendered suite for hqptuner/static/components/faceplate/settings/SettingsRail.js: one button per Settings category in
// the order given, the open class following the open drawer, a tap opening its drawer, each readout row's label and
// text, a swatch row's swatch and its colour, a wide row, and the blink a raised alert puts on its category.
//
// The seam is the categories and controls the test writes, the open drawer in `openStage`, and the wire for the alert:
// a Roon track playing at the default idle time, stated through `config` and a fresh `engineStatus` frame as
// tests/js/store/roonidle.test.js states it, raises the one alert homed on a Settings category. Every expected string
// is one this file put in.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/rail.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SettingsRail } from "../../../../hqptuner/static/components/faceplate/settings/SettingsRail.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { config, engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { elements, attr, classes, text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

//: A seg control the test writes: its option labels are the readout text.
const SEG = {
  type: "seg",
  options: [
    { v: "a", label: "Alpha" },
    { v: "b", label: "Beta" },
  ],
};

//: An accent control: a pick no accent names prints as itself, its swatch the pick.
const ACCENT = { type: "accent", options: [] };

//: Categories the test writes, in an order no sort produces: one with a live row and a wide readout, one with an accent
//: readout, and the Timing category the Roon alert homes on.
const CATEGORIES = [
  {
    id: "view",
    name: "Display",
    readouts: [{ id: "vacc", label: "Tint", control: ACCENT, value: () => "#123456" }],
  },
  {
    id: "dsp",
    name: "Processing",
    readouts: [
      { id: "mode", label: "Mode", control: SEG, value: () => "a" },
      { id: "rate", label: "Rate", wide: true, control: SEG, value: () => "b" },
    ],
    live: { label: "Path", value: () => "Upsampling" },
  },
  {
    id: "timing",
    name: "Timing",
    readouts: [{ id: "idle", label: "Idle", control: SEG, value: () => "a" }],
  },
];

let serial = 0;

/**
 * State the loaded idle time and one playing frame carrying `song`.
 *
 * @param {string} idleTime
 * @param {string} song
 */
function playing(idleTime, song) {
  serial += 1;
  config.value = { fields: [{ name: "idle_time", value: idleTime }], file: {}, active: "", profiles: null };
  engineStatus.value = {
    status: { state: "2", track_serial: String(serial), process_speed: "1.5", clips: "0" },
    metadata: { song },
  };
}

beforeEach(() => {
  openStage.value = null;
  playing("10000", "Track");
});

/** Every element of the rendered rail. */
const rendered = () => elements(render(html`<${SettingsRail} categories=${CATEGORIES} />`));

/** The rendered rail's category buttons. */
const buttons = () => rendered().filter((e) => e.name === "button");

/**
 * The rendered button of one category, or an empty element when there is none.
 *
 * @param {string} id
 * @returns {MarkupElement}
 */
const button = (id) =>
  buttons().find((b) => attr(b, "data-stage") === id) || { name: "", attrs: "", start: -1, html: "" };

/**
 * The elements named `name` inside one category's button.
 *
 * @param {string} id
 * @param {string} name
 * @returns {MarkupElement[]}
 */
function inside(id, name) {
  const b = button(id);
  return rendered().filter(
    (e) => e.name === name && e.start > b.start && e.start + e.html.length <= b.start + b.html.length,
  );
}

test("test_one_button_per_category_in_the_order_given", () => {
  assert.deepEqual(
    buttons().map((b) => attr(b, "data-stage")),
    ["view", "dsp", "timing"],
  );
});

test("test_only_the_category_whose_drawer_is_open_carries_open", () => {
  openStage.value = "dsp";
  assert.deepEqual(
    buttons().map((b) => classes(b).includes("open")),
    [false, true, false],
  );
});

test("test_tapping_a_category_opens_its_drawer", () => {
  const { seen } = renderTree(html`<${SettingsRail} categories=${CATEGORIES} />`);
  const hit = seen.find((v) => v.type === "button" && v.props["data-stage"] === "timing");
  const onClick = /** @type {(() => void) | undefined} */ (hit && hit.props.onClick);
  if (onClick) onClick();
  assert.equal(openStage.value, "timing");
});

test("test_a_category_shows_its_readout_labels_then_the_live_label", () => {
  assert.deepEqual(inside("dsp", "dt").map(text), ["Mode", "Rate", "Path"]);
});

test("test_a_category_shows_each_readout_as_its_control_prints_it_then_the_live_value", () => {
  assert.deepEqual(inside("dsp", "dd").map(text), ["Alpha", "Beta", "Upsampling"]);
});

test("test_a_swatch_row_carries_its_swatch_colour", () => {
  assert.deepEqual(
    inside("view", "i").map((i) => attr(i, "style")),
    ["--sw:#123456"],
  );
});

test("test_only_the_readout_set_wide_is_wide", () => {
  assert.deepEqual(
    inside("dsp", "div").map((d) => classes(d).includes("wide")),
    [false, true, false],
  );
});

test("test_a_raised_alert_blinks_its_category_and_no_other", () => {
  playing("0", "Roon");
  assert.deepEqual(
    buttons().map((b) => attr(b, "data-alert")),
    [undefined, undefined, "warn"],
  );
});
