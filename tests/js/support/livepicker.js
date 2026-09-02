// Readers for the LIVE snapshot picker, shared by the suites that ask what it
// offers (livepresetscard.test.js) and which of its rows the announced device
// capability grays (livepreset-narrow.test.js).
//
// Both halves are wire-side markings, never copy: the control's own
// `data-testid`, and the two marks a combobox row states its unpickability
// with. They live here so the day the picker changes how it marks an unpickable
// row, one place needs fixing rather than two.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { elements, classes, attr } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

// The picker's machine identity, carried by its control wrapper.
const PICKER = "live-preset";

/**
 * The picker's own subtree of a rendered card, so a control added to the card
 * later cannot be mistaken for one of this one's options. A miss throws rather
 * than quietly measuring nothing.
 *
 * @param {string} frag
 * @returns {string}
 */
export const picker = (frag) => {
  const el = elements(frag).find((e) => attr(e, "data-testid") === PICKER);
  if (el === undefined) throw new Error("the card renders no live snapshot picker");
  return el.html;
};

/**
 * Whether a row came back grayed. A combobox row states its unpickability with
 * `aria-disabled` rather than the native attribute, and dresses it with a
 * class; either one grays the row.
 *
 * @param {MarkupElement} el
 * @returns {boolean}
 */
export const grayed = (el) => attr(el, "aria-disabled") === "true" || classes(el).includes("disabled");
