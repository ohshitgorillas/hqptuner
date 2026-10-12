// An option's name face, as a nameplate prints it: the plain family › variant at reading size, since a name alone repeats
// across families, over the name as the option style prints it. The page's chain fields, the drawer's list rows and the
// Setting Switcher's list slots each draw it inside their own box. An option with no family draws its name alone. A
// modulator's DSD rate floor ends its family line as the option list's rate badge. The apodizing mark lives here too,
// beside the rate badge, for every surface that marks a filter's apodizing.

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

/** @typedef {"full" | "half" | "none"} AKind */

// The glyphs as outlines, Inter 400's "A" and "onehalf", each centered on the circle; "none" strikes the circle with
// one filled bar along its diagonal.
/** @type {Record<AKind, string>} */
const APOD_PATH = {
  full:
    "M5.61 15.00 9.24 5.00H10.71L14.39 15.00H13.05L10.93 9.07Q10.73 8.52 10.48 7.69Q10.22 6.87 9.85 5.60H10.09Q9.73 " +
    "6.89 9.46 7.72Q9.20 8.56 9.02 9.07L6.96 15.00ZM7.43 12.21V11.09H12.57V12.21Z",
  half:
    "M6.98 4.62V10.48H5.82V5.61H5.75L4.36 6.68V5.53L5.54 4.62ZM5.18 15.38 12.57 4.62H13.79L6.40 15.38ZM11.67 " +
    "15.38V14.60L13.63 12.47Q14.02 12.06 14.23 11.75Q14.44 11.44 14.44 11.11Q14.44 10.77 14.17 10.58Q13.90 10.40 " +
    "13.56 10.40Q13.20 10.40 12.97 10.59Q12.74 10.79 12.74 11.14H11.62Q11.62 10.35 12.19 9.90Q12.77 9.45 13.60 " +
    "9.45Q14.48 9.45 15.02 9.93Q15.56 10.40 15.56 11.07Q15.56 11.34 15.44 11.63Q15.33 11.93 15.00 12.36Q14.68 12.79 " +
    "14.05 13.48L13.29 14.33V14.40H15.64V15.38Z",
  none: "M5.20 16.00L16.00 5.20L14.80 4.00L4.00 14.80Z",
};
/** @type {Partial<Record<AKind, string>>} */
const APOD_LABEL = { full: "Apodizing", half: "Half apodizing" };

/**
 * The apodizing mark of a kind, its state in `data-kind`; nothing without a kind. A caller's `label` names the mark
 * and is its hover text; without one the mark is named for apodizing and has none.
 *
 * @param {{ kind: "full" | "half" | "" | null | undefined, label?: string } | { kind: "none", label: string }} props
 */
export function AMark({ kind, label }) {
  if (!kind) return null;
  return html`
    <span class="amark" data-kind=${kind} role="img" aria-label=${label ?? APOD_LABEL[kind]} title=${label}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9.3" />
        <path d=${APOD_PATH[kind]} />
      </svg>
    </span>
  `;
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
