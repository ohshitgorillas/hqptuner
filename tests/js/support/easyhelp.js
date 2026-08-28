// The readers for the Easy Mode card's HELP PANEL and the link that opens it,
// and the seam that link is pressed by. The cases themselves are
// tests/js/components/easytiles-help.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// Its own module rather than part of tests/js/support/easytiles.js, which is at
// the file-length gate's ceiling.
//
// NO COPY IS READ HERE (docs/testing.md rule 9). The link and the panel are
// found by the `data-testid` each carries, the way the card's exit link and
// grid switcher already are (tests/js/components/easymode.test.js); the card's
// subtitle is found by the `data-note="easy-notice"` marking that file pins.
// Nothing selects on a sentence and no wording is asserted — what the intro
// paragraph and the link caption SAY is the owner's.
//
// CLICKS. preact-render-to-string never fires a handler and there is no DOM
// here, so the link is pressed by invoking the onClick its vnode carries,
// collected through preact's own `options.vnode` creation hook — the renderer's
// public seam, third-party surface, the same one
// tests/js/support/easytiles.js's `pressTile` uses. Nothing of HQPTuner's is
// stubbed.

import { elements, attr } from "./markup.js";

/** @typedef {import("./wheel.js").VNode} VNode */
/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

const TESTID = "data-testid";

/** The link in the card's subtitle that opens and closes the panel. */
export const HELP_LINK = "easy-help";

/** The panel that link puts in the document. */
const HELP_PANEL = "easy-help-panel";

/**
 * @param {string} out
 * @param {string} id
 * @returns {MarkupElement[]}
 */
const marked = (out, id) => elements(out).filter((el) => attr(el, TESTID) === id);

/**
 * How many help panels a rendering carries: none until the link is pressed, one
 * afterwards. A count rather than a boolean, so a card that grew two fails here
 * rather than reading as open.
 *
 * @param {string} out
 * @returns {number}
 */
export const helpPanels = (out) => marked(out, HELP_PANEL).length;

/**
 * How many help links a rendering offers.
 *
 * @param {string} out
 * @returns {number}
 */
export const helpLinks = (out) => marked(out, HELP_LINK).length;

/**
 * The one element of a rendering carrying a marking; anything but exactly one
 * throws.
 *
 * @param {string} out
 * @param {string} id
 * @returns {MarkupElement}
 */
function only(out, id) {
  const found = marked(out, id);
  if (found.length !== 1) throw new Error(`expected one ${TESTID}="${id}", found ${found.length}`);
  return found[0];
}

/**
 * The card's subtitle: the one element carrying the notice marking
 * tests/js/components/easymode.test.js pins.
 *
 * @param {string} out
 * @returns {MarkupElement}
 */
function notice(out) {
  const found = elements(out).filter((el) => attr(el, "data-note") === "easy-notice");
  if (found.length !== 1) throw new Error(`expected one notice element, found ${found.length}`);
  return found[0];
}

/**
 * Whether the card's subtitle encloses the help link.
 *
 * @param {string} out
 * @returns {boolean}
 */
export function subtitleCarriesHelpLink(out) {
  const box = notice(out);
  const link = only(out, HELP_LINK);
  return link.start >= box.start && link.start + link.html.length <= box.start + box.html.length;
}

/**
 * Whether the subtitle shows any text of its own ABOVE the link — the intro
 * paragraph, read as "something a reader sees comes before the link" rather than
 * as any particular sentence. Vertical position is CSS and is not read here;
 * document order is the half a rendering can answer.
 *
 * @param {string} out
 * @returns {boolean}
 */
export function introPrecedesHelpLink(out) {
  const box = notice(out);
  const link = only(out, HELP_LINK);
  const before = box.html.slice(0, link.start - box.start);
  return before.replace(/<[^<>]*>/g, "").trim() !== "";
}

/**
 * One press on the affordance a `data-testid` names, as a pointer would land on
 * it. Anything but a single clickable match throws rather than pressing
 * something else.
 *
 * @param {VNode[]} seen
 * @param {string} id
 * @returns {void}
 */
export function pressTestId(seen, id) {
  const hits = seen.filter((v) => v && v.props && v.props[TESTID] === id && typeof v.props.onClick === "function");
  if (hits.length !== 1) throw new Error(`expected one clickable ${TESTID}="${id}", found ${hits.length}`);
  /** @type {(event: object) => void} */ (hits[0].props.onClick)({ preventDefault() {}, stopPropagation() {} });
}
