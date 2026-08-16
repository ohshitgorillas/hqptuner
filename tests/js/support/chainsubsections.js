// Readers for the SOURCE-type subsections a chain card is split into, shared by
// the conversion-card suites.
//
// Which element carries a subhead is a disclosure decision, not a behaviour: the
// DSD half is a collapsible, so its subhead is a button, while the PCM half's is
// not. Everything here therefore finds a subhead by the words a reader sees and
// walks back to whatever tag opens it.

import { elements, text } from "./markup.js";
import { cardHeadAt, cardTitled } from "./tabform.js";

/** The two source-type subheads a chain card carries. */
export const SUBHEADS = ["PCM Sources", "DSD Sources"];

/**
 * Where a subhead's own element starts inside a card fragment, or -1.
 *
 * @param {string} chunk
 * @param {string} name
 */
const subheadAt = (chunk, name) => {
  const at = chunk.indexOf(name);
  return at < 0 ? -1 : chunk.lastIndexOf("<", at);
};

/**
 * One source-type subsection of a card: from its subhead to the next subhead, or
 * to the end of the card when it is the last. Empty when the card carries no
 * such subhead at all.
 *
 * @param {string} chunk
 * @param {string} name
 * @returns {string}
 */
export const subsection = (chunk, name) => {
  const at = subheadAt(chunk, name);
  if (at < 0) return "";
  const later = SUBHEADS.map((n) => subheadAt(chunk, n)).filter((i) => i > at);
  return later.length === 0 ? chunk.slice(at) : chunk.slice(at, Math.min(...later));
};

/**
 * The elements of one card that ARE a subhead reading `name`: their wording ends
 * in it — a collapsible's subhead carries a disclosure triangle ahead of the
 * words — and they carry no other subhead, which is what tells a subhead from
 * the region that merely ends with one.
 *
 * @param {string} out
 * @param {string} card
 * @param {string} name
 * @returns {import("./markup.js").MarkupElement[]}
 */
export function subheadsIn(out, card, name) {
  const start = cardHeadAt(out, card);
  if (start < 0) throw new Error(`no card titled "${card}" in the rendered tab`);
  const end = start + cardTitled(out, card).length;
  const others = SUBHEADS.filter((n) => n !== name);
  return elements(out).filter(
    (el) =>
      el.start >= start && el.start < end && text(el).endsWith(name) && others.every((n) => !text(el).includes(n)),
  );
}

/**
 * The subheads of one card a reader can press — how a case asks whether a
 * subhead is a disclosure rather than a plain heading.
 *
 * @param {string} out
 * @param {string} card
 * @param {string} name
 * @returns {import("./markup.js").MarkupElement[]}
 */
export const subheadButtons = (out, card, name) => subheadsIn(out, card, name).filter((el) => el.name === "button");

/**
 * What a reader sees inside a vnode: its children, flattened.
 *
 * @param {unknown} node
 * @returns {string}
 */
export function vnodeText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(vnodeText).join("");
  const props = /** @type {import("./wheel.js").VNode} */ (node).props;
  return vnodeText(props && props.children);
}
