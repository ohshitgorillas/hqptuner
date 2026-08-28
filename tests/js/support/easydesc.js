// The readers for the STRUCTURE of an Easy Mode tile's description: how many
// paragraph blocks it renders, and whether they hang off one container. The
// cases themselves are tests/js/components/easytiles-desc.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// Its own module rather than part of tests/js/support/easytiles.js, which is at
// the file-length gate's ceiling. It reaches a tile through that harness's
// `tileHtml`, so a description is always read inside the tile it belongs to and
// never across the card.
//
// NO COPY IS READ HERE (docs/testing.md rule 9). A block is found by the
// `data-para` it carries — a marking put there to be found by, the way
// `data-note="easy-notice"` and `data-testid="easy-switcher"` already are. The
// attribute's VALUE is not read either: presence is what marks a block, and what
// it is valued with is the writer's business. The classes around it (`.easy-desc`
// and whatever a paragraph carries) are styling the owner may change without
// changing a behavior, so nothing selects on one.

import { elements, attr, enclosing } from "./markup.js";
import { tileHtml } from "./easytiles.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

/**
 * The paragraph blocks one tile's description renders, in document order.
 *
 * @param {string} fragment
 * @returns {MarkupElement[]}
 */
const blocks = (fragment) =>
  elements(fragment)
    .filter((el) => attr(el, "data-para") !== undefined)
    .sort((a, b) => a.start - b.start);

/**
 * How many paragraph blocks a tile's description renders.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {number}
 */
export const descBlockCount = (out, presetId) => blocks(tileHtml(out, presetId)).length;

/**
 * How many distinct elements a tile's description blocks hang off: the container
 * whose child order IS the order the paragraphs read in. Two blocks in two
 * different wrappers carry no order between them, however they happen to land on
 * screen.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {number}
 */
export function descBlockContainers(out, presetId) {
  const fragment = tileHtml(out, presetId);
  return new Set(blocks(fragment).map((el) => enclosing(fragment, el).start)).size;
}
