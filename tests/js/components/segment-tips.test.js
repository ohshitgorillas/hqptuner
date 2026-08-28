// Behavioral suite for a PER-POSITION tip on the Segment strip
// (components/controls/index.js): the sentence one option of a segmented control
// carries, and the description wiring that ties it to the button it belongs to.
//
// The companion file is tests/js/components/segment.test.js, which owns the
// strip's own contract — one button per option, the active marking, and what a
// click reports. This one owns only what a TIP adds, so a strip handed no tips
// is read here too: the eleven callers that pass none must go on rendering what
// they render today.
//
// HOW A TIP IS FOUND, and the reading this file takes. An option's button names
// its description in `aria-describedby`; the tip is the element inside the strip
// carrying that id. So "the option has a tip" and "the tip describes the button"
// are one wiring read two ways, the same reading
// tests/js/components/easytiles-tips.test.js takes for a knob's own tip: a
// sentence rendered beside a button that nothing points at is not a description
// of it, and a description naming an id that is not there describes nothing.
// An option with no tip is therefore read as a button naming no description.
//
// NAMES, NOT WORDS (docs/testing.md rule 9). Every option is selected by the
// `data-v` its button carries — the wire value — and never by the word printed
// on it. The tip text a case renders is this file's own stand-in, asserted only
// for being there and having something in it; not a word of it is compared,
// because in the shipped card that sentence is owner copy.
//
// Every case renders at value "a" and no case is about which button is active;
// what is marked is tests/js/components/segment.test.js's subject.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/segment-tips.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { Segment } from "../../../hqptuner/static/components/controls/index.js";
import { elements, attr, text, classes } from "../support/markup.js";

/** @typedef {Parameters<typeof Segment>[0]} SegmentProps */

/**
 * One option as a caller hands it over, with the tip words some options carry
 * and others do not.
 *
 * @typedef {{ value: string, label: string, tip?: string }} TipOption
 */

// Stand-in copy, never compared against anything that ships.
const STAND_IN = "A stand-in tip, seeded by the suite.";

// One strip with a tip on its first option and none on its second, and one with
// no tips anywhere. The mixed strip is what both halves of "some options carry a
// tip" are read on: a tipless option read on its own, in a strip where nothing
// is tipped, would pass whether the wiring exists or not.
/** @type {TipOption[]} */
const MIXED = [
  { value: "a", label: "Alpha", tip: STAND_IN },
  { value: "b", label: "Bravo" },
];

/** @type {TipOption[]} */
const BARE = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
];

// The id the description wiring is built from, which the CALLER supplies:
// Segment is a plain function of its props and generates nothing of its own, so
// a tipped strip handed no `idBase` has no id to point a button at. The base
// itself is a machine identifier, never read by a case — only that the wiring it
// makes resolves.
const ID_BASE = "seg-under-test";

/**
 * The strip one case renders, as SSR markup. `idBase` is passed only where a
 * case is about a tip; the tipless cases below hand over none, which is what the
 * callers that pass no tips do.
 *
 * @param {TipOption[]} options
 * @param {string} [idBase]
 * @returns {string}
 */
const out = (options, idBase) => render(Segment(/** @type {SegmentProps} */ ({ options, value: "a", idBase })));

/**
 * The button one option value renders as. Found by `data-v`, the wire value,
 * never by the label.
 *
 * @param {string} fragment
 * @param {string} value
 * @returns {import("../support/markup.js").MarkupElement}
 */
function button(fragment, value) {
  const hit = elements(fragment).find(
    (el) => el.name === "button" && classes(el).includes("seg") && attr(el, "data-v") === value,
  );
  if (hit === undefined) throw new Error(`the strip offers no option valued "${value}"`);
  return hit;
}

/**
 * The id one option's button names as its description, or undefined where it
 * names none.
 *
 * @param {string} fragment
 * @param {string} value
 * @returns {string | undefined}
 */
const describedBy = (fragment, value) => attr(button(fragment, value), "aria-describedby");

/**
 * The element one option is described by — its tip — or undefined where the
 * button names no description or names an id that is not inside the strip. Both
 * misses read the same way on purpose: a description pointing nowhere describes
 * nothing.
 *
 * @param {string} fragment
 * @param {string} value
 * @returns {import("../support/markup.js").MarkupElement | undefined}
 */
function tip(fragment, value) {
  const id = describedBy(fragment, value);
  return id === undefined ? undefined : elements(fragment).find((el) => attr(el, "id") === id);
}

/**
 * What one option's tip says, as a reader meets it, or the empty string where
 * the option has none. Read so that PRESENCE can be asserted; the words are
 * asserted nowhere (rule 9).
 *
 * @param {string} fragment
 * @param {string} value
 * @returns {string}
 */
const tipText = (fragment, value) => {
  const el = tip(fragment, value);
  return el === undefined ? "" : text(el);
};

// ============================================================================
// an option given a tip
// ============================================================================

test("test_an_option_given_a_tip_is_described_by_an_element_inside_the_strip", () => {
  assert.notEqual(tip(out(MIXED, ID_BASE), "a"), undefined);
});

test("test_an_option_given_a_tip_renders_it_with_something_in_it", () => {
  assert.notEqual(tipText(out(MIXED, ID_BASE), "a"), "");
});

// ============================================================================
// the option beside it that carries none
// ============================================================================
//
// Read BESIDE the tipped option, in the one assertion, because "this option has
// no tip" is only a behavior in a strip where a tip demonstrably does render.

test("test_an_option_with_no_tip_names_no_description_in_a_strip_where_another_option_has_one", () => {
  const strip = out(MIXED, ID_BASE);
  assert.deepEqual([tipText(strip, "a") !== "", describedBy(strip, "b")], [true, undefined]);
});

// ============================================================================
// a strip handed no tips at all
// ============================================================================
//
// The regression guard for every caller that passes none: such a strip describes
// nothing and renders nothing extra to describe with. What it DOES render — the
// span, one button per option in order, the classes and the active marking — is
// tests/js/components/segment.test.js's, and stays green there.

test("test_a_strip_given_no_tips_describes_none_of_its_buttons", () => {
  const strip = out(BARE);
  assert.deepEqual([describedBy(strip, "a"), describedBy(strip, "b")], [undefined, undefined]);
});

test("test_a_strip_given_no_tips_renders_nothing_besides_the_strip_and_its_buttons", () => {
  assert.equal(elements(out(BARE)).filter((el) => el.name !== "button").length, 1);
});
