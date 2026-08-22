// Readers for the SOURCE-type subsections a chain card is split into, shared by
// the conversion-card suites.
//
// Both subheads carry `data-sources` — "pcm" or "dsd" (components/tabs/
// ConversionCards.js) — and that attribute is what identifies a subsection here.
// The heading's own wording is copy the owner may reword at will, so nothing
// below selects on it (docs/testing.md rule 9).
//
// Which ELEMENT carries a subhead stays unnamed: the DSD half is a collapsible,
// so its subhead is a button, while the PCM half's is a plain heading.
// Everything here therefore matches the attribute and takes whatever tag carries
// it.

import { elements } from "./markup.js";
import { cardHeadAt, cardTitled } from "./tabform.js";

/** The two source-type subheads a chain card carries, by `data-sources`. */
export const SUBHEADS = ["pcm", "dsd"];

/** @param {string} sources */
const marker = (sources) => `data-sources="${sources}"`;

/**
 * Where a subhead's own element starts inside a card fragment, or -1.
 *
 * @param {string} chunk
 * @param {string} sources
 */
const subheadAt = (chunk, sources) => {
  const at = chunk.indexOf(marker(sources));
  return at < 0 ? -1 : chunk.lastIndexOf("<", at);
};

/**
 * One source-type subsection of a card: from its subhead to the next subhead, or
 * to the end of the card when it is the last. Empty when the card carries no
 * such subhead at all.
 *
 * @param {string} chunk
 * @param {string} sources
 * @returns {string}
 */
export const subsection = (chunk, sources) => {
  const at = subheadAt(chunk, sources);
  if (at < 0) return "";
  const later = SUBHEADS.map((n) => subheadAt(chunk, n)).filter((i) => i > at);
  return later.length === 0 ? chunk.slice(at) : chunk.slice(at, Math.min(...later));
};

/**
 * The elements of one card that ARE the subhead for `sources`: the ones carrying
 * that `data-sources` value, whatever tag they turned out to be.
 *
 * @param {string} out
 * @param {string} card
 * @param {string} sources
 * @returns {import("./markup.js").MarkupElement[]}
 */
export function subheadsIn(out, card, sources) {
  const start = cardHeadAt(out, card);
  if (start < 0) throw new Error(`no card titled "${card}" in the rendered tab`);
  const end = start + cardTitled(out, card).length;
  const want = new RegExp(`(^|\\s)${marker(sources)}`);
  return elements(out).filter((el) => el.start >= start && el.start < end && want.test(el.attrs));
}

/**
 * The subheads of one card a reader can press — how a case asks whether a
 * subhead is a disclosure rather than a plain heading.
 *
 * @param {string} out
 * @param {string} card
 * @param {string} sources
 * @returns {import("./markup.js").MarkupElement[]}
 */
export const subheadButtons = (out, card, sources) =>
  subheadsIn(out, card, sources).filter((el) => el.name === "button");
