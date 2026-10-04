// A chain field's nameplate on the page (Resampling 1x and Nx, Shaping): the running option's plain family › variant at
// reading size, since a name alone repeats across families, over its name as the option style prints it. A tap opens
// the field's whole option list over the body, and a pick from it is written live. A field this track's path does not
// run dims its glass.

import { html } from "../../../lib/dom.js";
import { openOptionList } from "../../../store/faceplate/view.js";
import { pickOption } from "../../../store/faceplate/page/conversion.js";

/** @typedef {import("../../../store/faceplate/page/conversion.js").ConvField} ConvField */

/**
 * The nameplate for one chain field.
 *
 * @param {object} props
 * @param {ConvField} props.field
 * @param {string} props.label  the field's name, which leads the nameplate's accessible name
 */
export function ChainPick({ field, label }) {
  const { key, stage, value, idle, fam, variant, leaf } = field;
  const open = () => openOptionList({ key, stage, value, pick: (v) => pickOption(key, v) });
  return html`
    <div class="cpk">
      <button
        type="button"
        class=${idle ? "vfd cplate dim" : "vfd cplate"}
        data-key=${key}
        data-list=${key}
        aria-label=${`${label}: ${leaf}`}
        aria-haspopup="dialog"
        onClick=${open}
      >
        <span class="cpf">
          <b class="cpfam">${fam}</b>
          ${variant && html`<span class="cpsep">›</span><span class="cpvar">${variant}</span>`}
        </span>
        <span class="cpl">${leaf}</span>
      </button>
    </div>
  `;
}
