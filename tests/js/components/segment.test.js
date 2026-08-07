// Behavioral suite for the Segment control (components/controls/index.js) — the
// presentational button strip: one button per option, the one matching the
// current value marked active, and a click that reports a CHANGE and only a
// change (re-picking what is already selected reports nothing).
//
// Policy (docs/testing.md): public API only, one assertion per test. Segment is
// a pure function of its props, so every case builds its own props; nothing is
// stubbed and no module private is touched.
//
// Two routes into the same component, deliberately. There is no DOM here and
// preact-render-to-string never fires an event handler, so a click cannot be
// produced by rendering: the RENDER cases assert on the SSR string (classes,
// labels, disabled), and the CLICK cases call the component as the plain
// function it is and invoke the onClick the returned vnode tree carries. The
// handler is public surface — it is what the browser calls — and `buttons()`
// below only walks children, exactly as the renderer would.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/segment.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { Segment } from "../../../hqptuner/static/components/controls/index.js";

/** @typedef {Parameters<typeof Segment>[0]} SegmentProps */

/**
 * The props a case hands the strip, which are Segment's own with two widenings.
 * `onChange` is optional because the render cases never click, and `disabled` is
 * whatever a caller passes rather than a boolean, because the strip tests it for
 * truth (`disabled || !!o.disabled`) and a case below hands it a 1.
 *
 * @typedef {Omit<SegmentProps, "disabled" | "onChange"> & {
 *   disabled?: unknown,
 *   onChange?: SegmentProps["onChange"],
 * }} CaseProps
 */

/**
 * One strip, built from a case's props. The assertion is the seam between the
 * two shapes above and Segment's own signature.
 *
 * @param {CaseProps} props
 */
const segmentOf = (props) => Segment(/** @type {SegmentProps} */ (props));

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

// A boolean-ish strip whose option values are STRINGS, as the config layer
// hands them over, so a numeric caller value has to be compared by string form.
const FLAGS = [
  { value: "0", label: "Off" },
  { value: "1", label: "On" },
];

// --- the rendered string ------------------------------------------------------

/** @param {Omit<CaseProps, "options">} props */
const out = (props) => render(segmentOf({ options: OPTIONS, ...props }));

/** @param {string} s */
const buttonClasses = (s) => [...s.matchAll(/<button[^>]*\bclass="([^"]*)"/g)].map((m) => m[1]);
/** @param {string} s */
const buttonTypes = (s) => [...s.matchAll(/<button[^>]*\btype="([^"]*)"/g)].map((m) => m[1]);
/** @param {string} s */
const buttonLabels = (s) => [...s.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].trim());
/** @param {string} s */
const disabledCount = (s) => (s.match(/<button[^>]*\bdisabled/g) || []).length;
/** @param {string} s */
const activeSegment = (s) => {
  const m = /<button[^>]*class="seg active"[^>]*>([\s\S]*?)<\/button>/.exec(s);
  return m ? m[1].trim() : null;
};

// --- the vnode tree, for clicking ---------------------------------------------
// Walk the tree the component returns and collect the button vnodes in document
// order. Each carries the onClick a browser would fire.

/**
 * A button vnode of the strip: the click a browser fires, and the children the
 * walk descends into. Every button the strip emits carries an onClick, so a
 * render that produced one without it throws here exactly as it would in a
 * browser.
 *
 * @typedef {{
 *   type?: unknown,
 *   props: { children?: unknown, onClick: (ev: unknown) => void },
 * }} ButtonNode
 */

/**
 * @param {unknown} node
 * @param {ButtonNode[]} [found]
 * @returns {ButtonNode[]}
 */
function buttons(node, found = []) {
  if (Array.isArray(node)) {
    for (const kid of node) buttons(kid, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const v = /** @type {{ type?: unknown, props?: { children?: unknown } }} */ (node);
  if (v.type === "button") found.push(/** @type {ButtonNode} */ (node));
  return buttons(v.props && v.props.children, found);
}

// One click on the nth button, with the event surface a real click carries.
/**
 * @param {Omit<CaseProps, "options" | "onChange">} props
 * @param {number} index
 * @returns {(string | number)[][]}
 */
function click(props, index) {
  /** @type {(string | number)[][]} */
  const calls = [];
  const strip = segmentOf({ options: OPTIONS, onChange: (...args) => calls.push(args), ...props });
  buttons(strip)[index].props.onClick({ preventDefault() {}, stopPropagation() {} });
  return calls;
}

// --- rendering ----------------------------------------------------------------

test("test_the_strip_renders_inside_a_segment_span", () => {
  assert.ok(out({ value: "a" }).includes('<span class="segment">'));
});

test("test_the_strip_offers_one_button_per_option_in_order", () => {
  assert.deepEqual(buttonLabels(out({ value: "a" })), ["Alpha", "Bravo", "Charlie"]);
});

test("test_every_option_is_a_plain_button_and_never_a_submit", () => {
  assert.deepEqual(buttonTypes(out({ value: "a" })), ["button", "button", "button"]);
});

test("test_the_option_matching_the_value_is_the_active_button", () => {
  assert.equal(activeSegment(out({ value: "b" })), "Bravo");
});

// The selected button (index 1 here) is the subject of the test above; this one
// owns the other side of behaviour 5 — everything else stays plain.
test("test_the_unselected_options_render_as_plain_buttons", () => {
  assert.deepEqual(
    buttonClasses(out({ value: "b" })).filter((_, i) => i !== 1),
    ["seg", "seg"],
  );
});

test("test_a_value_matching_no_option_activates_nothing", () => {
  assert.equal(activeSegment(out({ value: "" })), null);
});

test("test_a_numeric_value_activates_its_string_valued_option", () => {
  assert.equal(activeSegment(render(segmentOf({ value: 0, options: FLAGS }))), "Off");
});

test("test_a_disabled_strip_disables_every_button", () => {
  assert.equal(disabledCount(out({ value: "a", disabled: true })), 3);
});

// The contract is TRUTHY, not the boolean `true`: a caller handing over a count,
// a non-empty string or any other truthy flag gets a dead strip too.
test("test_a_truthy_non_boolean_disabled_disables_every_button", () => {
  assert.equal(disabledCount(out({ value: "a", disabled: 1 })), 3);
});

test("test_an_enabled_strip_disables_no_button", () => {
  assert.equal(disabledCount(out({ value: "a" })), 0);
});

// --- clicking -----------------------------------------------------------------

test("test_picking_another_option_reports_that_option_value_once", () => {
  assert.deepEqual(click({ value: "a" }, 1), [["b"]]);
});

test("test_re_picking_the_current_selection_reports_nothing", () => {
  assert.deepEqual(click({ value: "b" }, 1), []);
});

test("test_re_picking_a_selection_that_matches_only_as_a_string_reports_nothing", () => {
  /** @type {(string | number)[][]} */
  const calls = [];
  const strip = segmentOf({ value: 0, options: FLAGS, onChange: (...args) => calls.push(args) });
  buttons(strip)[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls, []);
});

test("test_a_numeric_value_still_reports_a_genuinely_different_option", () => {
  /** @type {(string | number)[][]} */
  const calls = [];
  const strip = segmentOf({ value: 0, options: FLAGS, onChange: (...args) => calls.push(args) });
  buttons(strip)[1].props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls, [["1"]]);
});

test("test_a_value_absent_from_the_list_makes_every_option_a_change", () => {
  assert.deepEqual(click({ value: "z" }, 1), [["b"]]);
});

// An empty value selects nothing, so each option in turn is a change — one case
// per option, one assertion apiece.
for (const [index, option] of OPTIONS.entries()) {
  test(`test_with_no_selection_picking_${option.value}_reports_its_value`, () => {
    assert.deepEqual(click({ value: "" }, index), [[option.value]]);
  });
}
