// An option's name face, as a nameplate prints it: the plain family › variant at reading size, since a name alone repeats
// across families, over the name as the option style prints it. The page's chain fields, the drawer's list rows and the
// Setting Switcher's list slots each draw it inside their own box.

import { html } from "../../lib/dom.js";

/**
 * The family line and the name line of one option.
 *
 * @param {{ fam: string, variant: string | null, leaf: string }} props
 */
export function NameFace({ fam, variant, leaf }) {
  return html`
    <span class="cpf">
      <b class="cpfam">${fam}</b>
      ${variant && html`<span class="cpsep">›</span><span class="cpvar">${variant}</span>`}
    </span>
    <span class="cpl">${leaf}</span>
  `;
}
