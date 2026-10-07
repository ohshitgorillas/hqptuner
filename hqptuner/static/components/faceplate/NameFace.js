// An option's name face, as a nameplate prints it: the plain family › variant at reading size, since a name alone repeats
// across families, over the name as the option style prints it. The page's chain fields, the drawer's list rows and the
// Setting Switcher's list slots each draw it inside their own box. An option with no family draws its name alone.

import { html } from "../../lib/dom.js";

/**
 * The family line: the family, and its variant after a separator when it has one.
 *
 * @param {string} fam
 * @param {string | null} variant
 */
const familyLine = (fam, variant) => html`
  <span class="cpf">
    <b class="cpfam">${fam}</b>
    ${variant && html`<span class="cpsep">›</span><span class="cpvar">${variant}</span>`}
  </span>
`;

/**
 * The family line and the name line of one option; an empty family draws the name line only.
 *
 * @param {{ fam: string, variant: string | null, leaf: string }} props
 */
export function NameFace({ fam, variant, leaf }) {
  return html`
    ${fam ? familyLine(fam, variant) : null}
    <span class="cpl">${leaf}</span>
  `;
}
