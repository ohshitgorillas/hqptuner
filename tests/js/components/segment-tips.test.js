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
// A TIP IS READ TWO WAYS HERE, because it is two things. Through the wiring: an
// option's button names its description in `aria-describedby`, and the words a
// case reads back are the ones at that id, so a description naming an id that is
// not there answers the empty string. And as an ELEMENT: whatever carries the
// `seg-tip` class is a tip, pointed at or not. Only the second reading can see a
// tip nothing describes, and that is not a harmless extra — the hover styling
// paints it, so a stray one is an empty box over an option with nothing to say.
//
// NAMES, NOT WORDS (docs/testing.md rule 9). Every option is selected by the
// `data-v` its button carries — the wire value — and the tip element by its
// class; never by the word printed on the button. What IS compared word for word
// is the stand-in sentence a case seeded, which is this file's own input and not
// copy anyone owns. Being non-empty would not do: a strip rendering an option's
// LABEL into its description says something at every tipped position, and saying
// something is not the behavior.
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

/**
 * Every tip element in a strip, whether or not anything points at one: the
 * elements carrying the `seg-tip` class, which is what MAKES an element a tip.
 * A class is a wire identifier and pinning it is contract (docs/testing.md rule
 * 9) — and it is the only reading that can see a tip nothing describes, which is
 * a box the hover styling paints over an option that has nothing to say.
 *
 * @param {string} fragment
 * @returns {import("../support/markup.js").MarkupElement[]}
 */
const tipElements = (fragment) => elements(fragment).filter((el) => classes(el).includes("seg-tip"));

// ============================================================================
// an option given a tip
// ============================================================================
//
// The words are compared against the seeded stand-in rather than read for being
// non-empty, and the comparison covers the wiring with them: the text is reached
// THROUGH the button's `aria-describedby`, so a description that resolves to
// nothing answers the empty string, and a strip rendering the option's LABEL
// into its description answers "Alpha".

test("test_an_option_given_a_tip_is_described_by_the_words_it_was_given", () => {
  assert.equal(tipText(out(MIXED, ID_BASE), "a"), STAND_IN);
});

// ============================================================================
// the option beside it that carries none
// ============================================================================
//
// Two readings, because "no tip" is two things. The button names no description
// — and no tip ELEMENT is rendered for it either, which the description reading
// cannot see: a tip nothing points at is still a box the hover styling paints,
// empty, over an option with nothing to say. The strip holds exactly one, the
// one the case above reads.

test("test_an_option_with_no_tip_names_no_description", () => {
  assert.equal(describedBy(out(MIXED, ID_BASE), "b"), undefined);
});

test("test_a_strip_renders_one_tip_element_per_option_that_carries_a_tip", () => {
  assert.equal(tipElements(out(MIXED, ID_BASE)).length, 1);
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

test("test_a_strip_given_no_tips_renders_no_tip_element_at_all", () => {
  assert.deepEqual(tipElements(out(BARE)), []);
});
