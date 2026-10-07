// An option's name face, as a nameplate prints it: the plain family › variant at reading size, since a name alone repeats
// across families, over the name as the option style prints it. The page's chain fields, the drawer's list rows and the
// Setting Switcher's list slots each draw it inside their own box. An option with no family draws its name alone. A
// modulator's DSD rate floor ends its family line as the option list's rate badge.

import { html } from "../../lib/dom.js";

/**
 * The rate badge of a modulator's DSD rate floor; nothing where there is none.
 *
 * @param {{ tier: string | undefined }} props
 */
export function TierMark({ tier }) {
  if (!tier) return null;
  return html`<span class="otier" role="img" aria-label=${`Needs DSD${tier.slice(0, -1)} or higher`}>${tier}</span>`;
}

/**
 * The family line: the family, its variant after a separator when it has one, and the rate badge of its tier.
 *
 * @param {string} fam
 * @param {string | null} variant
 * @param {string | undefined} tier
 */
const familyLine = (fam, variant, tier) => html`
  <span class="cpf">
    <b class="cpfam">${fam}</b>
    ${variant && html`<span class="cpsep">›</span><span class="cpvar">${variant}</span>`}
    <${TierMark} tier=${tier} />
  </span>
`;

/**
 * The family line and the name line of one option; an empty family draws the name line only.
 *
 * @param {{ fam: string, variant: string | null, leaf: string, tier?: string }} props
 */
export function NameFace({ fam, variant, leaf, tier }) {
  return html`
    ${fam ? familyLine(fam, variant, tier) : null}
    <span class="cpl">${leaf}</span>
  `;
}
