// A cross-reference link, `Name ›`: the place's name, and a tap opens that place's drawer on its tab
// (store/faceplate/xref.js) without moving the page. Also a reason line's content: its text, then the link to the
// place it names.

import { html } from "../../lib/dom.js";
import { TARGETS, goTo, reasonXref } from "../../store/faceplate/xref.js";

/** @typedef {import("../../store/faceplate/xref.js").XrefHere} XrefHere */

/**
 * One link.
 *
 * @param {{ to: string, label?: string }} props  the TARGETS id, and a name in place of the place's own
 */
export const Xref = ({ to, label }) => html`
  <a
    class="xref"
    href="#"
    data-to=${to}
    onClick=${(/** @type {{ preventDefault: () => void }} */ e) => {
      e.preventDefault();
      goTo(to);
    }}
  >
    ${label ?? TARGETS[to]?.label}<span aria-hidden="true"> ›</span>
  </a>
`;

/**
 * A reason line's text, then the link to the place it names when that place is out of sight.
 *
 * @param {string} text
 * @param {XrefHere | null} here  where the line is drawn; null off any drawer
 */
export function withXref(text, here) {
  const to = reasonXref(text, here);
  return to ? html`${text} <${Xref} to=${to} />` : text;
}
