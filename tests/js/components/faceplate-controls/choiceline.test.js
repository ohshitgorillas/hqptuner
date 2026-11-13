// Rendered suite for hqptuner/static/components/faceplate/controls/ChoiceLine.js, the choice line every list of
// choices draws: a radio and a name over a paragraph, which line is picked, what a tap reaches, what Off takes away,
// and how an unpicked line folds to its name and summary.
//
// Renders through preact-render-to-string; a tap is fired through the vnode seam (tests/js/support/vnodeseam.js), since
// server rendering fires no events. The radio is found by its role and the name by being the element that holds the
// label. Every string asserted is a value or a name the test handed in.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-controls/choiceline.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { ChoiceLine } from "../../../../hqptuner/static/components/faceplate/controls/ChoiceLine.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/**
 * @typedef {{ v: string, label: string, sub?: string, picked: boolean, off?: boolean, man?: unknown, detail?: unknown,
 *   summary?: unknown, onPick: () => void }} Props
 */

/**
 * The line's props, with the defaults every case below starts from.
 *
 * @param {Partial<Props>} [over]
 * @returns {Props}
 */
const props = (over = {}) => ({
  v: "alpha",
  label: "Alpha",
  picked: false,
  off: false,
  man: html`<p>MANPART</p>`,
  onPick: () => {},
  ...over,
});

/**
 * Every element of one render of the line.
 *
 * @param {Partial<Props>} [over]
 * @returns {MarkupElement[]}
 */
const markup = (over) => elements(render(html`<${ChoiceLine} ...${props(over)} />`));

/**
 * The line: the outermost element of the render.
 *
 * @param {Partial<Props>} [over]
 */
const line = (over) => markup(over).at(-1);

/**
 * The radio of one render.
 *
 * @param {Partial<Props>} [over]
 */
const radio = (over) => markup(over).find((e) => e.name === "button" && attr(e, "role") === "radio");

/**
 * Taps the radio or the name once and returns how often the owner heard; undefined when the render draws no such part.
 *
 * @param {"radio" | "name"} target
 * @param {Partial<Props>} [over]
 */
function tapped(target, over = {}) {
  let heard = 0;
  const { seen } = renderTree(html`<${ChoiceLine} ...${props({ ...over, onPick: () => (heard += 1) })} />`);
  const node = seen.find((v) =>
    target === "radio" ? v.type === "button" : v.type === "span" && propsOf(v).class === "chn",
  );
  if (!node) return undefined;
  const onClick = propsOf(node).onClick;
  if (typeof onClick === "function") onClick({});
  return heard;
}

// --- what the line is ---------------------------------------------------------------------------------------------

const KEYED = [
  { name: "a_line_carries_the_value_it_is_given", v: "alpha" },
  { name: "a_line_carries_another_value_when_given_another", v: "beta" },
];

for (const row of KEYED) {
  test(`test_${row.name}`, () => {
    const l = line({ v: row.v });
    assert.equal(l ? attr(l, "data-v") : undefined, row.v);
  });
}

const CUR = [
  { name: "the_picked_line_is_marked_current", picked: true, want: true },
  { name: "an_unpicked_line_is_not_marked_current", picked: false, want: false },
];

for (const row of CUR) {
  test(`test_${row.name}`, () => {
    const l = line({ picked: row.picked });
    assert.equal(l ? classes(l).includes("cur") : undefined, row.want);
  });
}

const CHECKED = [
  { name: "the_picked_lines_radio_is_checked", picked: true, want: "true" },
  { name: "an_unpicked_lines_radio_is_not_checked", picked: false, want: "false" },
];

for (const row of CHECKED) {
  test(`test_${row.name}`, () => {
    const r = radio({ picked: row.picked });
    assert.equal(r ? attr(r, "aria-checked") : undefined, row.want);
  });
}

// --- what it shows -----------------------------------------------------------------------------------------------

const SHOWN = [
  { name: "the_line_shows_its_name", over: { label: "LABELPART" }, part: "LABELPART" },
  { name: "the_line_shows_its_sub", over: { sub: "SUBPART" }, part: "SUBPART" },
  { name: "the_line_shows_its_detail", over: { detail: html`<i>DETAILPART</i>` }, part: "DETAILPART" },
  { name: "the_picked_line_shows_its_paragraph", over: { picked: true }, part: "MANPART" },
  { name: "an_unpicked_line_shows_its_paragraph", over: { picked: false }, part: "MANPART" },
];

for (const row of SHOWN) {
  test(`test_${row.name}`, () => {
    assert.equal(line(row.over)?.html.includes(row.part), true);
  });
}

// --- a tap -------------------------------------------------------------------------------------------------------

const TAPS = [
  { name: "a_tap_on_the_radio_of_an_unpicked_line_reaches_the_owner", target: "radio", picked: false },
  { name: "a_tap_on_the_name_of_an_unpicked_line_reaches_the_owner", target: "name", picked: false },
  { name: "a_tap_on_the_radio_of_the_picked_line_reaches_the_owner", target: "radio", picked: true },
  { name: "a_tap_on_the_name_of_the_picked_line_reaches_the_owner", target: "name", picked: true },
];

for (const row of TAPS) {
  test(`test_${row.name}`, () => {
    assert.equal(tapped(row.target === "radio" ? "radio" : "name", { picked: row.picked }), 1);
  });
}

// --- Off ---------------------------------------------------------------------------------------------------------

const OFF_RADIO = [
  { name: "an_off_lines_radio_takes_no_tap", off: true, want: true },
  { name: "an_on_lines_radio_takes_a_tap", off: false, want: false },
];

for (const row of OFF_RADIO) {
  test(`test_${row.name}`, () => {
    const r = radio({ off: row.off });
    assert.equal(r ? hasAttr(r, "disabled") : undefined, row.want);
  });
}

test("test_a_tap_on_an_off_lines_name_reaches_nobody", () => {
  assert.equal(tapped("name", { off: true }), 0);
});

// --- a folded line -----------------------------------------------------------------------------------------------

const SUMMARY = html`<span>SUMMARYPART</span>`;

const FOLDS = [
  {
    name: "an_unpicked_line_given_a_summary_shows_it",
    over: { summary: SUMMARY, picked: false },
    part: "SUMMARYPART",
    want: true,
  },
  {
    name: "an_unpicked_line_given_a_summary_hides_its_paragraph",
    over: { summary: SUMMARY, picked: false },
    part: "MANPART",
    want: false,
  },
  {
    name: "an_unpicked_line_given_a_summary_still_shows_its_name",
    over: { summary: SUMMARY, picked: false, label: "LABELPART" },
    part: "LABELPART",
    want: true,
  },
  {
    name: "the_picked_line_given_a_summary_does_not_show_it",
    over: { summary: SUMMARY, picked: true },
    part: "SUMMARYPART",
    want: false,
  },
  {
    name: "the_picked_line_given_a_summary_shows_its_paragraph",
    over: { summary: SUMMARY, picked: true },
    part: "MANPART",
    want: true,
  },
  {
    name: "an_unpicked_line_given_no_summary_shows_no_summary",
    over: { picked: false },
    part: "SUMMARYPART",
    want: false,
  },
];

for (const row of FOLDS) {
  test(`test_${row.name}`, () => {
    assert.equal(line(row.over)?.html.includes(row.part), row.want);
  });
}
