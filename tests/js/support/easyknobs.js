// The reader for the POSITIONS one Easy Mode knob offers: every option its
// segment lays out, in the order it lays them out, named by the `data-v` each
// option button carries.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// Its own module rather than part of tests/js/support/easytiles.js, which is at
// the file-length gate's ceiling — the same reason tests/js/support/easydesc.js
// is its own module, and it reaches a tile the same way, through that harness's
// `tileHtml`, so a knob is always read inside the tile it belongs to and never
// across the card.
//
// That harness's own `knobPositions` answers a different question: which
// position is MARKED. This one answers which positions EXIST, which is what a
// knob that gained a third position, or lost one, is observable as.
//
// NO COPY IS READ HERE (docs/testing.md rule 9). An option is named by its
// `data-v`, a wire identifier `writeSet` speaks — never by the word printed on
// the button, which is the owner's to reword.

import { elements, attr, classes, text } from "./markup.js";
import { tileHtml } from "./easytiles.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

/**
 * One tile's knob, as its own fragment: the outermost element carrying that
 * knob's `data-knob` marking.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {string}
 */
function knobHtml(out, presetId, knobId) {
  const fragment = tileHtml(out, presetId);
  const wrappers = elements(fragment).filter((el) => attr(el, "data-knob") === knobId);
  if (wrappers.length === 0) throw new Error(`the "${presetId}" tile carries no "${knobId}" knob`);
  return wrappers.reduce((a, b) => (a.start <= b.start ? a : b)).html;
}

/**
 * Every position one tile's knob offers, in document order.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {(string | undefined)[]}
 */
export function knobOptions(out, presetId, knobId) {
  return elements(knobHtml(out, presetId, knobId))
    .filter((el) => el.name === "button" && classes(el).includes("seg"))
    .sort((a, b) => a.start - b.start)
    .map((el) => attr(el, "data-v"));
}

/**
 * The group one knob renders as: the outermost `role="group"` inside it, the
 * knob's own wrapper included. A knob that renders no group reads as undefined
 * rather than throwing, so "there is no group" is an answer a case can assert.
 *
 * @param {string} fragment
 * @returns {MarkupElement | undefined}
 */
const group = (fragment) => {
  const hits = elements(fragment).filter((el) => attr(el, "role") === "group");
  return hits.length === 0 ? undefined : hits.reduce((a, b) => (a.start <= b.start ? a : b));
};

/**
 * Whether one knob renders a `role="group"` at all. Read beside
 * `knobDescribedBy`, which answers `undefined` both for a group naming no
 * description and for a knob that rendered no group: on its own that reading
 * cannot tell "this knob describes itself with nothing" from "there is no
 * wiring here at all", and only the first of the two is a behavior.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {boolean}
 */
export const knobHasGroup = (out, presetId, knobId) => group(knobHtml(out, presetId, knobId)) !== undefined;

/**
 * The id one knob's group names as its description, or undefined where it names
 * none. A knob with no tip carries no description, which is what makes this the
 * reading a tipless knob is asserted through.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {string | undefined}
 */
export const knobDescribedBy = (out, presetId, knobId) => {
  const g = group(knobHtml(out, presetId, knobId));
  return g === undefined ? undefined : attr(g, "aria-describedby");
};

/**
 * The element one knob's group points at as its description — the tip — or
 * undefined where the knob names no description or names an id that is not
 * inside it. Both misses read the same way on purpose: a description pointing
 * nowhere describes nothing.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {MarkupElement | undefined}
 */
export function knobTip(out, presetId, knobId) {
  const fragment = knobHtml(out, presetId, knobId);
  const id = knobDescribedBy(out, presetId, knobId);
  return id === undefined ? undefined : elements(fragment).find((el) => attr(el, "id") === id);
}

/**
 * What one knob's tip says, as a reader meets it, or the empty string where the
 * knob has no tip. Read so that PRESENCE can be asserted — the words themselves
 * are owner copy and are asserted nowhere (docs/testing.md rule 9).
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {string}
 */
export function knobTipText(out, presetId, knobId) {
  const tip = knobTip(out, presetId, knobId);
  return tip === undefined ? "" : text(tip);
}

/**
 * Whether one knob's group carries a name: an `aria-label` with something in it,
 * or an `aria-labelledby` pointing at an element inside the knob. Either wiring
 * names the group, and which one a writer reaches for is not a behavior — so the
 * two are one answer here, and no case reads the name itself.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {boolean}
 */
export function knobIsNamed(out, presetId, knobId) {
  const fragment = knobHtml(out, presetId, knobId);
  const g = group(fragment);
  if (g === undefined) return false;
  const label = attr(g, "aria-label");
  if (label !== undefined && label.trim() !== "") return true;
  const by = attr(g, "aria-labelledby");
  return by !== undefined && elements(fragment).some((el) => attr(el, "id") === by && text(el) !== "");
}
