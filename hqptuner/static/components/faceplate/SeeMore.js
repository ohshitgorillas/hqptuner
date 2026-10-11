// The `… see more` link that ends prose shown short, and the note popover it opens with the prose held back, parked
// under the link.

import { html } from "../../lib/dom.js";
import { Popover, parkAt, triggerProps } from "./Popover.js";

/** @typedef {import("../../store/prose.js").Fold} Fold */

export const SEE_MORE = "… see more";

/** Under its link, flipped above it where below would cross the plate's foot. */
const HOW = /** @type {const} */ ({ side: 22, foot: 14, at: { x: "start", y: "flip", gap: 6 } });

/**
 * Park a note popover under its link.
 *
 * @param {HTMLElement} panel
 */
function park(panel) {
  const at = parkAt(panel, HOW);
  if (!at) return;
  panel.style.left = `${Math.round(at.left)}px`;
  panel.style.top = `${Math.round(at.top)}px`;
}

/**
 * The link that opens a note.
 *
 * @param {string} id  the note's popover id
 */
export const seeMore = (id) => html`
  <button type="button" class="seemore" data-testid="see-more" ...${triggerProps(id, "dialog")}>${SEE_MORE}</button>
`;

/**
 * The note a `see more` link opens: the prose held back, one paragraph each.
 *
 * @param {object} props
 * @param {string} props.id  the popover id its link names
 * @param {string} props.label  the note's accessible name
 * @param {string[]} props.paras
 */
export const MoreNote = ({ id, label, paras }) => html`
  <${Popover} id=${id} cls="notepop" role="dialog" label=${label} park=${park}>
    ${paras.map((p) => html`<p>${p}</p>`)}
  <//>
`;

/**
 * Prose as its fold reads: the head and the first paragraph, then `see more` where any paragraphs are held back, which
 * opens them, then the paragraphs in place after it.
 *
 * @param {object} props
 * @param {unknown} props.head  what leads the first paragraph, null for nothing
 * @param {Fold} props.fold
 * @param {string} props.id  the note's popover id
 * @param {string} props.label  the note's accessible name
 * @param {string} [props.cls]  each paragraph's class
 */
export function folded({ head, fold, id, label, cls }) {
  const { text, rest, more } = fold;
  const first = head ? html`${head} ${text}` : text;
  const after = rest.map((p) => html`<p class=${cls}>${p}</p>`);
  if (more.length === 0) return html`<p class=${cls}>${first}</p>${after}`;
  return html`<p class=${cls}>${first} ${seeMore(id)}</p>${after}<${MoreNote} id=${id} label=${label} paras=${more} />`;
}
