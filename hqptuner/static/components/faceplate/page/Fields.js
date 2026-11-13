// A page section's fields: one open, every other folded to a line that names it, says why it reads as it does and
// prints its value, and opens it when tapped. The line is never accented: it is a fold, not a setting.

import { Fragment } from "preact";
import { html } from "../../../lib/dom.js";

/**
 * One field of a section.
 *
 * @typedef {object} Field
 * @property {string} id
 * @property {string} name   what the folded line names it
 * @property {string} why    why it reads as it does, beside the name
 * @property {string} value  its value, at the line's end
 * @property {unknown} body  what it shows open
 */

/**
 * A section's fields: the open one shows its body, every other folds to one line that opens it.
 *
 * @param {object} props
 * @param {Field[]} props.fields
 * @param {string} props.open  the open field's id
 * @param {(id: string) => void} props.onOpen
 */
export function Fields({ fields, open, onOpen }) {
  return fields.map((f) =>
    f.id === open
      ? html`<${Fragment} key=${f.id}>${f.body}<//>`
      : html`
          <button key=${f.id} type="button" class="fline" onClick=${() => onOpen(f.id)}>
            <b>${f.name}</b> ${f.why && html`<span>${f.why}</span>`} <span class="fn">${f.value}</span>
          </button>
        `,
  );
}
