// The Loudness drawer's bands: one side at a time behind v1's Bass | Treble switch (store/ui/ui.js), its four rows
// left (Type as the engine's own tokens, Frequency, Steepness / Q, Level) and their manual lines right, the gray
// reason heading that column. A side holding staged edits keeps a dot on its switch button while hidden (v1).

import { html } from "../../../../lib/dom.js";
import { schema as catalog } from "../../../../store/schema.js";
import { describe } from "../../../../store/prose.js";
import { edit } from "../../../../store/actions.js";
import { rowOptions, rowValue } from "../../../../store/faceplate/drawer.js";
import { loudnessSide } from "../../../../store/ui/ui.js";
import { PARAMS, bandKey, formBounds, showSide, sideDots } from "../../../../store/faceplate/drawers/loudness.js";
import { ManPara, NumBox, Seg } from "./parts.js";

/** @typedef {import("../../../../store/faceplate/drawers/loudness.js").Side} Side */

const SIDE_OPTIONS = [
  { value: "low", label: "Bass" },
  { value: "high", label: "Treble" },
];

/**
 * A row's label and paragraph: the catalog's short label, the settings metadata's paragraph (and its own label as
 * the control's accessible name).
 *
 * @param {string} key
 */
function prose(key) {
  const entry = catalog[key];
  const meta = entry ? describe(entry, key) : { label: key, tooltip: "" };
  return { label: entry ? entry.label : key, aria: meta.label, text: meta.tooltip, unit: entry?.unit };
}

/**
 * One band row: its label and control.
 *
 * @param {{ k: string, param: string, disabled: boolean }} props
 */
function Row({ k, param, disabled }) {
  const p = prose(k);
  const control =
    param === "type"
      ? html`<${Seg}
          aria=${p.aria}
          cls="enum mini2"
          options=${rowOptions(k)}
          value=${rowValue(k)}
          disabled=${disabled}
          onPick=${(/** @type {string} */ v) => edit(k, v)}
        />`
      : html`<${NumBox}
          k=${k}
          aria=${p.aria}
          value=${rowValue(k)}
          unit=${p.unit}
          ...${formBounds(k)}
          disabled=${disabled}
          onSet=${(/** @type {number} */ v) => edit(k, v)}
        />`;
  return html`<div class="lrow" data-k=${k}><span class="ll">${p.label}</span>${control}</div>`;
}

/**
 * The switch, the shown side's rows and their manual lines.
 *
 * @param {{ why: string }} props  why: the gray reason, '' while loudness can act
 */
export function Bands({ why }) {
  const side = /** @type {Side} */ (loudnessSide.value === "high" ? "high" : "low");
  const keys = PARAMS.map((p) => bandKey(side, p));
  return html`
    <div class="lbands">
      <div class=${why ? "lleft grayed" : "lleft"}>
        <${Seg}
          aria="Band"
          cls="lsw view"
          options=${SIDE_OPTIONS}
          value=${side}
          dots=${sideDots()}
          disabled=${!!why}
          onPick=${(/** @type {string} */ v) => showSide(v === "high" ? "high" : "low")}
        />
        ${keys.map((k, i) => html`<${Row} k=${k} param=${PARAMS[i]} disabled=${!!why} />`)}
      </div>
      <div class="lrc">
        <span class="gr" hidden=${!why}>${why}</span>
        <div class="man lcopy">
          ${keys.map((k) => {
            const p = prose(k);
            return html`<${ManPara} label=${p.label} text=${p.text} />`;
          })}
        </div>
      </div>
    </div>
  `;
}
