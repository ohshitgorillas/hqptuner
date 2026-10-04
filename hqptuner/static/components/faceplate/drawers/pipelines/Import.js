// The Overview's Import EQ: v1's AutoEq library picker (components/matrix/Library.js) in a popover under its key, a
// `.txt` file read through the same seam, and the box that says whether the EQ lands on both sides of the stereo pair.
// A load replaces the pair's EQ and takes its preamp as their gain, into a crossfeed block when one holds the pair
// (store/faceplate/drawers/pipelines.js `importEq`).

import { html } from "../../../../lib/dom.js";
import { importEq } from "../../../../store/faceplate/drawers/pipelines.js";
import { openPopover } from "../../../../store/faceplate/view.js";
import { LibraryPicker } from "../../../matrix/Library.js";
import { Popover, triggerProps } from "../../Popover.js";
import { mirror, note } from "./state.js";
import { FileKey, park } from "./parts.js";

const ID = "pl-import";

/**
 * Land an EQ text on the stereo pair and say what landed.
 *
 * @param {string} text
 */
async function land(text) {
  note.value = await importEq(text, mirror.value);
  openPopover.value = null;
}

/** @typedef {{ currentTarget: HTMLInputElement }} CheckEv */

/**
 * Import EQ's key and its popover.
 *
 * @param {{ off: boolean }} props
 */
export function ImportEq({ off }) {
  return html`
    <button type="button" class="btn xs" disabled=${off} ...${triggerProps(ID, "dialog")}>Import EQ…</button>
    <${Popover} id=${ID} cls="pimp" role="dialog" label="Import EQ" park=${park}>
      ${openPopover.value === ID ? html`<${LibraryPicker} applyText=${land} />` : null}
      <div class="pimpf">
        <label class="chk">
          <input
            type="checkbox"
            checked=${mirror.value}
            onChange=${(/** @type {CheckEv} */ e) => (mirror.value = e.currentTarget.checked)}
          />
          mirror to stereo pair
        </label>
        <span class="grow"></span>
        <${FileKey} label=".txt file…" accept=".txt" onFiles=${(/** @type {File[]} */ fs) => fs[0].text().then(land)} />
      </div>
    <//>
  `;
}
