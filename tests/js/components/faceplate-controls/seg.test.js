// Rendered suite for hqptuner/static/components/faceplate/controls/Seg.js, the switch (segmented control) every surface
// draws: one button per option, the lit one, what a click reaches, what Off and an unavailable option take away, the
// staged dot, and what a screen reader hears.
//
// Renders through preact-render-to-string; a click is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. An option is found by its value (`data-v`); state is read from roles,
// `aria-*`, `disabled`, `tabindex` and the state-bearing `grayed` and `dirty` classes. Every string asserted is a value or
// a name the test handed in.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-controls/seg.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Seg } from "../../../../hqptuner/static/components/faceplate/controls/Seg.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/components/faceplate/controls/types.js").Opt} Opt */

/** The switch's name, as the owner hands it in. */
const NAME = "fixture switch";

/** @type {Opt[]} */
const TWO = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
];

/** @type {Opt[]} */
const THREE = [
  { value: "red", label: "Red" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
];

/**
 * The switch's props, with the defaults every case below starts from.
 *
 * @param {Partial<{ options: Opt[], value: string, off: boolean, dots: Record<string, boolean>,
 *   onPick: (v: string) => void }>} [over]
 */
const props = (over = {}) => ({
  options: THREE,
  value: "green",
  aria: NAME,
  off: false,
  dots: {},
  onPick: () => {},
  ...over,
});

/**
 * Every element of one render of the switch.
 *
 * @param {Parameters<typeof props>[0]} [over]
 * @returns {MarkupElement[]}
 */
const markup = (over) => elements(render(html`<${Seg} ...${props(over)} />`));

/**
 * The switch's option buttons, in document order.
 *
 * @param {Parameters<typeof props>[0]} [over]
 */
const buttons = (over) => markup(over).filter((e) => e.name === "button" && attr(e, "data-v") !== undefined);

/**
 * The values `onPick` received when the button for option `v` is clicked.
 *
 * @param {string} v
 * @param {Parameters<typeof props>[0]} [over]
 * @returns {string[]}
 */
function clickOn(v, over = {}) {
  /** @type {string[]} */
  const picks = [];
  const { seen } = renderTree(html`<${Seg} ...${props({ ...over, onPick: (p) => picks.push(p) })} />`);
  const hit = seen.find((n) => n.type === "button" && n.props?.["data-v"] === v);
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) fn({ preventDefault: () => {}, stopPropagation: () => {} });
  return picks;
}

// --- one button per option ---------------------------------------------------------------------------------------

const PER_OPTION = [
  { name: "two_options_draw_two_buttons_in_list_order", options: TWO, want: ["alpha", "beta"] },
  { name: "three_options_draw_three_buttons_in_list_order", options: THREE, want: ["red", "green", "blue"] },
];

for (const row of PER_OPTION) {
  test(`test_${row.name}`, () => {
    const over = { options: row.options, value: row.options[0].value };
    assert.deepEqual(
      buttons(over).map((e) => attr(e, "data-v")),
      row.want,
    );
  });
}

// --- lit on the owner's value ------------------------------------------------------------------------------------

const LIT = [
  { name: "the_switch_lights_the_option_equal_to_the_owners_value", value: "green" },
  { name: "the_switch_lights_another_option_when_the_owner_holds_another_value", value: "blue" },
];

for (const row of LIT) {
  test(`test_${row.name}`, () => {
    const lit = buttons({ value: row.value }).filter((e) => attr(e, "aria-checked") === "true");
    assert.deepEqual(
      lit.map((e) => attr(e, "data-v")),
      [row.value],
    );
  });
}

// --- a click reaches the owner -----------------------------------------------------------------------------------

test("test_a_click_on_an_unlit_option_reaches_the_owner_with_that_option", () => {
  assert.deepEqual(clickOn("red", { value: "green" }), ["red"]);
});

test("test_a_click_on_the_lit_option_still_reaches_the_owner", () => {
  assert.deepEqual(clickOn("green", { value: "green" }), ["green"]);
});

// --- Off ---------------------------------------------------------------------------------------------------------

const OFF_GRAYS = [
  { name: "an_off_switch_is_grayed_whole", off: true, want: true },
  { name: "an_on_switch_is_not_grayed", off: false, want: false },
];

for (const row of OFF_GRAYS) {
  test(`test_${row.name}`, () => {
    const all = markup({ off: row.off });
    const outer = all.at(-1);
    assert.equal(outer ? classes(outer).includes("grayed") : undefined, row.want);
  });
}

const OFF_TAPS = [
  { name: "an_off_switch_takes_no_tap_on_any_button", off: true, want: [true, true, true] },
  { name: "an_on_switch_takes_a_tap_on_every_available_button", off: false, want: [false, false, false] },
];

for (const row of OFF_TAPS) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(
      buttons({ off: row.off }).map((e) => hasAttr(e, "disabled")),
      row.want,
    );
  });
}

// --- an unavailable option ---------------------------------------------------------------------------------------

/** @type {Opt[]} */
const ONE_UNAVAILABLE = [
  { value: "red", label: "Red" },
  { value: "green", label: "Green", disabled: true },
  { value: "blue", label: "Blue" },
];

test("test_only_the_option_its_list_marks_unavailable_takes_no_tap", () => {
  assert.deepEqual(
    buttons({ options: ONE_UNAVAILABLE, value: "red" }).map((e) => hasAttr(e, "disabled")),
    [false, true, false],
  );
});

// --- the staged dot ----------------------------------------------------------------------------------------------

/**
 * The values of the options carrying the accent dot, on the button or inside it.
 *
 * @param {Record<string, boolean>} dots
 */
const dotted = (dots) =>
  buttons({ dots })
    .filter((b) => elements(b.html).some((e) => classes(e).includes("dirty")))
    .map((b) => attr(b, "data-v"));

/** @type {{ name: string, dots: Record<string, boolean>, want: string[] }[]} */
const DOTS = [
  { name: "an_option_holding_a_staged_edit_carries_the_dot", dots: { blue: true }, want: ["blue"] },
  { name: "the_dot_follows_the_option_that_holds_the_staged_edit", dots: { red: true }, want: ["red"] },
];

for (const row of DOTS) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(dotted(row.dots), row.want);
  });
}

// --- what a screen reader hears ----------------------------------------------------------------------------------

test("test_the_switch_is_a_radio_group_under_its_name", () => {
  const group = markup().find((e) => attr(e, "role") === "radiogroup");
  assert.equal(group ? attr(group, "aria-label") : undefined, NAME);
});

test("test_each_option_is_a_radio", () => {
  assert.deepEqual(
    buttons().map((e) => attr(e, "role")),
    ["radio", "radio", "radio"],
  );
});

test("test_each_option_is_its_own_tab_stop", () => {
  const stops = buttons().filter((e) => attr(e, "tabindex") !== "-1");
  assert.equal(stops.length, THREE.length);
});
