// Rendered suite for hqptuner/static/components/faceplate/controls/FieldRow.js, the row shell every drawer and builder
// draws: what the row is keyed by, what marks it staged or alerted, and where the head, the control, the gray line, the
// prose and what hangs under the row sit.
//
// Renders through preact-render-to-string. Every part is a node the test hands in, so a part is found by the text it
// carries; the row is found by being the outermost element of the render.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-controls/fieldrow.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { FieldRow } from "../../../../hqptuner/static/components/faceplate/controls/FieldRow.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/**
 * @typedef {{ k?: string, field?: string, choice?: string, dirty?: boolean, alert?: string, head: unknown,
 *   control?: unknown, gray?: unknown, man?: unknown, under?: unknown, cls?: string }} Props
 */

/**
 * The row's props, with the defaults every case below starts from: each part a node carrying its own name as text.
 *
 * @param {Partial<Props>} [over]
 * @returns {Props}
 */
const props = (over = {}) => ({
  head: html`<b>HEADPART</b>`,
  control: html`<i>CONTROLPART</i>`,
  gray: html`<u>GRAYPART</u>`,
  man: html`<p>MANPART</p>`,
  under: html`<ol>UNDERPART</ol>`,
  ...over,
});

/**
 * Every element of one render of the row.
 *
 * @param {Partial<Props>} [over]
 * @returns {MarkupElement[]}
 */
const markup = (over) => elements(render(html`<${FieldRow} ...${props(over)} />`));

/**
 * The row: the outermost element of the render.
 *
 * @param {Partial<Props>} [over]
 */
const row = (over) => markup(over).at(-1);

/**
 * The first element of the render carrying a class.
 *
 * @param {string} cls
 * @param {Partial<Props>} [over]
 */
const withClass = (cls, over) => markup(over).find((e) => classes(e).includes(cls));

// --- what the row is keyed by ------------------------------------------------------------------------------------

const KEYED = [
  { name: "a_row_carries_the_setting_key_it_is_given", prop: "k", key: "data-k", value: "xfeed" },
  { name: "a_row_carries_another_setting_key_when_given_another", prop: "k", key: "data-k", value: "other" },
  { name: "a_row_carries_the_field_it_is_given", prop: "field", key: "data-field", value: "fixture-field" },
  { name: "a_row_carries_the_choice_it_is_given", prop: "choice", key: "data-choice", value: "fixture-choice" },
];

for (const row_ of KEYED) {
  test(`test_${row_.name}`, () => {
    const r = row({ [row_.prop]: row_.value });
    assert.equal(r ? attr(r, row_.key) : undefined, row_.value);
  });
}

const UNKEYED = [
  { name: "a_row_given_no_setting_key_carries_none", key: "data-k" },
  { name: "a_row_given_no_field_carries_none", key: "data-field" },
  { name: "a_row_given_no_choice_carries_none", key: "data-choice" },
];

for (const row_ of UNKEYED) {
  test(`test_${row_.name}`, () => {
    const r = row();
    assert.equal(r ? hasAttr(r, row_.key) : undefined, false);
  });
}

test("test_a_row_is_a_drawer_row", () => {
  const r = row();
  assert.equal(r ? classes(r).includes("drow") : undefined, true);
});

test("test_a_row_carries_the_context_class_it_is_given", () => {
  const r = row({ cls: "drow-full" });
  assert.equal(r ? classes(r).includes("drow-full") : undefined, true);
});

// --- staged and alerted ------------------------------------------------------------------------------------------

const STAGED = [
  { name: "a_row_holding_a_staged_edit_is_marked_dirty", dirty: true, want: true },
  { name: "a_row_holding_no_staged_edit_is_not_marked_dirty", dirty: false, want: false },
];

for (const row_ of STAGED) {
  test(`test_${row_.name}`, () => {
    const r = row({ dirty: row_.dirty });
    assert.equal(r ? hasAttr(r, "data-dirty") : undefined, row_.want);
  });
}

const ALERTS = [
  { name: "a_row_carries_the_alert_it_is_given", alert: "crit" },
  { name: "a_row_carries_another_alert_when_given_another", alert: "warn" },
];

for (const row_ of ALERTS) {
  test(`test_${row_.name}`, () => {
    const r = row({ alert: row_.alert });
    assert.equal(r ? attr(r, "data-alert") : undefined, row_.alert);
  });
}

test("test_a_row_given_no_alert_carries_none", () => {
  const r = row();
  assert.equal(r ? hasAttr(r, "data-alert") : undefined, false);
});

// --- where the parts sit -----------------------------------------------------------------------------------------

/**
 * Whether the element holding a class contains the text.
 *
 * @param {string} cls
 * @param {string} part
 * @param {Partial<Props>} [over]
 */
const holds = (cls, part, over) => withClass(cls, over)?.html.includes(part);

const HELD_BY_CONTROLS = [
  { name: "the_head_sits_in_the_controls_column", part: "HEADPART" },
  { name: "the_control_sits_in_the_controls_column", part: "CONTROLPART" },
  { name: "the_gray_line_sits_in_the_controls_column", part: "GRAYPART" },
];

for (const row_ of HELD_BY_CONTROLS) {
  test(`test_${row_.name}`, () => {
    assert.equal(holds("ctl", row_.part), true);
  });
}

test("test_the_prose_sits_in_the_copy_column", () => {
  assert.equal(holds("man", "MANPART"), true);
});

const ORDER = [
  { name: "the_head_comes_before_the_control", first: "HEADPART", then: "CONTROLPART" },
  { name: "the_control_comes_before_the_gray_line", first: "CONTROLPART", then: "GRAYPART" },
];

for (const row_ of ORDER) {
  test(`test_${row_.name}`, () => {
    const ctl = withClass("ctl")?.html ?? "";
    assert.equal(ctl.indexOf(row_.first) < ctl.indexOf(row_.then), true);
  });
}

test("test_the_copy_column_comes_after_the_controls_column", () => {
  const ctl = withClass("ctl");
  const man = withClass("man");
  assert.equal(ctl && man ? ctl.start < man.start : undefined, true);
});

const UNDER = [
  { name: "what_hangs_under_the_row_is_not_in_the_controls_column", cls: "ctl" },
  { name: "what_hangs_under_the_row_is_not_in_the_copy_column", cls: "man" },
];

for (const row_ of UNDER) {
  test(`test_${row_.name}`, () => {
    assert.equal(holds(row_.cls, "UNDERPART"), false);
  });
}

test("test_what_hangs_under_the_row_is_in_the_row", () => {
  assert.equal(row()?.html.includes("UNDERPART"), true);
});

test("test_what_hangs_under_the_row_comes_after_the_copy_column", () => {
  const html_ = row()?.html ?? "";
  assert.equal(html_.indexOf("MANPART") < html_.indexOf("UNDERPART"), true);
});

// --- parts left out ----------------------------------------------------------------------------------------------

const OMITTED = [
  { name: "a_row_given_no_gray_line_draws_none", over: { gray: null }, part: "GRAYPART" },
  { name: "a_row_given_no_control_draws_none", over: { control: undefined }, part: "CONTROLPART" },
  { name: "a_row_given_no_prose_draws_none", over: { man: null }, part: "MANPART" },
  { name: "a_row_given_nothing_under_it_draws_none", over: { under: undefined }, part: "UNDERPART" },
];

for (const row_ of OMITTED) {
  test(`test_${row_.name}`, () => {
    assert.equal(row(row_.over)?.html.includes(row_.part), false);
  });
}
