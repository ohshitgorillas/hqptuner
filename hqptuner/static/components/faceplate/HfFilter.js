// The engine row's HF filter, between the counters and the volume: a readout naming the playback filter that runs, and
// the menu of the engine's playback filters it opens, the running one ticked. The lane is live: a pick writes at once,
// nothing stages, and the menu closes. What runs and what is offered are store/faceplate/hf.js's.

import { html } from "../../lib/dom.js";
import { openPopover } from "../../store/faceplate/view.js";
import { hfNow, pickHf } from "../../store/faceplate/hf.js";
import { Popover, UNDER_ENGINE_READOUT, parkAt, triggerProps } from "./Popover.js";

/** @typedef {import("../../store/faceplate/hf.js").HfOption} HfOption */

const ID = "hf";
const LABEL = "HF filter";

/**
 * Park the menu under the readout and hand the running row focus.
 *
 * @param {HTMLElement} panel
 */
function park(panel) {
  const at = parkAt(panel, UNDER_ENGINE_READOUT);
  if (at) {
    panel.style.left = `${Math.round(at.left)}px`;
    panel.style.top = `${Math.round(at.top)}px`;
  }
  /** @type {HTMLElement | null} */ (panel.querySelector('[aria-checked="true"]'))?.focus();
}

/**
 * A row's tap: the menu closes and the option is written live.
 *
 * @param {HfOption} o
 */
function pick(o) {
  openPopover.value = null;
  return pickHf(o.value);
}

/** The engine-row HF filter readout. It opens the menu. */
export function HfFilter() {
  const v = hfNow();
  return html`
    <div class="hfc">
      <button class="vfd hfrd" type="button" title=${v.txt} ...${triggerProps(ID, "menu")}>
        <span class="l">${LABEL}</span><span class="v">${v.txt}</span>
      </button>
    </div>
  `;
}

/** The menu of the engine's playback filters in its order, the running one ticked. A child of the plate. */
export function HfFilterPopover() {
  return html`
    <${Popover} id=${ID} cls="pmenu amenu hfpop" role="menu" label=${LABEL} park=${park}>
      ${hfNow().options.map(
        (o) => html`
          <button type="button" class="pmrow" role="menuitemradio" aria-checked=${String(o.cur)} onClick=${() => pick(o)}>
            ${o.label}
          </button>
        `,
      )}
    <//>
  `;
}
