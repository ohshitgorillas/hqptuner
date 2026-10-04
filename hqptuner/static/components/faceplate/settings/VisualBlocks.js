// The Visual settings drawer's two blocks. Accent color: the swatches pick a preset and the hex box beside them holds
// that preset's value or any custom #rrggbb, which overrides the preset until a swatch is picked again. Hide from signal
// chain: one toggle per hideable stage, lit while hidden; hiding the stage whose drawer is open closes that drawer.
// Both write the browser-held preferences at once and stage nothing.

import { html } from "../../../lib/dom.js";
import { accent, accentHex, applyAccent, applyAccentHex } from "../../../store/ui/theme.js";
import { ACCENTS } from "../../../store/faceplate/settings/visual.js";
import { hiddenStages, setStageHidden } from "../../../store/ui/faceplate.js";
import { openStage } from "../../../store/faceplate/view.js";
import { labelHead } from "../drawer/controls.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */
/** @typedef {{ schema: DrawerSchema, here: XrefHere }} BlockProps */
/** @typedef {{ target: { value: string } }} ChangeEv */

const MAN = {
  accent: "Set the accent color of HQPTuner.",
  hideSpk: "Hide the stages you don't use from the signal chain. Speakers is primarily for surround sound setups.",
};

const HIDEABLE = [
  { v: "dsd", label: "DSD Processing" },
  { v: "speakers", label: "Speakers" },
  { v: "crossfeed", label: "Crossfeed" },
  { v: "loudness", label: "Loudness" },
  { v: "correction", label: "DAC correction" },
];

/**
 * The accent row: a swatch per preset, the picked one pressed while no custom hex is set, and the custom hex box.
 *
 * @param {BlockProps} _props
 */
export function AccentBlock(_props) {
  const custom = accentHex.value;
  const picked = ACCENTS.find((a) => a.v === accent.value);
  return html`
    <div class="drow" data-field="vacc">
      <div class="ctl">
        ${labelHead("Accent color")}
        <div class="accpick">
          ${ACCENTS.map(
            (a) => html`
              <button
                type="button"
                class="swatch"
                style=${`--sw:${a.hex}`}
                title=${a.label}
                aria-label=${a.label}
                aria-pressed=${a.v === accent.value && !custom}
                data-v=${a.v}
                onClick=${() => applyAccent(a.v)}
              ></button>
            `,
          )}
          <input
            type="text"
            class="vfd hex"
            maxlength="7"
            spellcheck="false"
            aria-label="Custom accent hex"
            value=${custom || picked?.hex || ""}
            onChange=${(/** @type {ChangeEv} */ e) => applyAccentHex(e.target.value)}
          />
        </div>
      </div>
      <div class="man"><p>${MAN.accent}</p></div>
    </div>
  `;
}

/**
 * Hide one stage, or show it again; hiding the stage whose drawer is open closes that drawer.
 *
 * @param {string} stage
 * @param {boolean} hide
 */
function hideStage(stage, hide) {
  setStageHidden(stage, hide);
  if (hide && openStage.value === stage) openStage.value = null;
}

/**
 * The Hide from signal chain row: one toggle per hideable stage, lit while hidden, the copy under them.
 *
 * @param {BlockProps} _props
 */
export function HideBlock(_props) {
  const hidden = hiddenStages.value;
  return html`
    <div class="drow drow-full" data-field="vhide">
      <div class="ctl">
        ${labelHead("Hide from signal chain")}
        <div class="seg tgl" role="group" aria-label="Hide from signal chain">
          ${HIDEABLE.map((o) => {
            const on = hidden.includes(o.v);
            return html`
              <button
                type="button"
                class=${on ? "on" : undefined}
                data-v=${o.v}
                aria-pressed=${on}
                onClick=${() => hideStage(o.v, !on)}
              >
                ${o.label}
              </button>
            `;
          })}
        </div>
      </div>
      <div class="man"><p>${MAN.hideSpk}</p></div>
    </div>
  `;
}

/** The components the Visual drawer's block items mount, by name. */
export const VISUAL_BLOCKS = { accent: AccentBlock, hide: HideBlock };
