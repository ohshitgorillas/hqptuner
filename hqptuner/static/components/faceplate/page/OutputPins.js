// The page Output section's rate pins: `Auto`, or one exact rate of the running band pinned. Drawn only while Allow
// pinned rates is on; with it off the Output drawer is where the rate is set.
//   Glass  a head column (`Auto` over `44.1k · 48k`) and one column per tier of the running band: the tier's name, then
//          its two exact rates side by side, 44.1k family first as the head says, with the tier's unit once after the
//          pair, each rate a pin. A tier the device cannot carry is hatched, and a rate the engine's list lacks is
//          printed with no pin to press.
//   Marks  the rate playing is ringed (a measurement); the pin, or `Auto` with no pin, reads in accent (a setting).
// Every decision is the store's (store/faceplate/page/pins.js).

import { html } from "../../../lib/dom.js";
import { classNames } from "../../../model/shell/format.js";
import { allowPinnedRates } from "../../../store/ui/faceplate.js";
import { pinnedRate } from "../../../store/live/pin.js";
import { pinAuto, pinColumns, pinTier } from "../../../store/faceplate/page/pins.js";

/** @typedef {import("../../../store/faceplate/page/pins.js").PinColumn} PinColumn */
/** @typedef {import("../../../store/faceplate/page/pins.js").PinCell} PinCell */

const FAMILIES = "44.1k · 48k";

/**
 * One exact rate: a pin while the engine's list carries it, else its frequency printed out of reach.
 *
 * @param {{ col: PinColumn, cell: PinCell }} props
 */
function Rate({ col, cell }) {
  if (!cell.offered) {
    return html`<span class=${classNames("otp", "otno", cell.playing && "otplay")}>${cell.label}</span>`;
  }
  return html`
    <button
      type="button"
      class=${classNames("otp", cell.pinned && "otpinned", cell.playing && "otplay")}
      aria-pressed=${String(cell.pinned)}
      aria-label=${`Pin ${cell.label} ${col.unit}${cell.playing ? ", playing" : ""}`}
      data-i=${col.i}
      data-fam=${cell.fam}
      onClick=${() => pinTier(col.i, cell.fam)}
    >
      ${cell.label}
    </button>
  `;
}

/**
 * One tier's column: its name, its two rates and its unit once for the pair.
 *
 * @param {{ col: PinColumn }} props
 */
function Column({ col }) {
  const reachable = col.cells.some((c) => c.offered);
  return html`
    <div class=${classNames("otcol", col.unavailable && "otunav")}>
      <span class="ottn">${col.name}</span>
      <div class="otpair">
        ${col.cells.map((cell) => html`<${Rate} key=${cell.fam} col=${col} cell=${cell} />`)}
        <span class=${classNames("otu", !reachable && "otno")}>${col.unit}</span>
      </div>
    </div>
  `;
}

/** The section's glass: Auto and the families' head, then the running band's columns. */
export function OutputPins() {
  if (!allowPinnedRates.value) return null;
  const cols = pinColumns();
  const auto = pinnedRate.value === 0;
  return html`
    <div class="vfd otglass" role="group" aria-label="Output rate">
      <div class="otheads">
        <button
          type="button"
          class=${classNames("otautop", auto && "otpinned")}
          aria-pressed=${String(auto)}
          data-testid="pin-auto"
          onClick=${() => pinAuto()}
        >
          Auto
        </button>
        <span class="otfh">${FAMILIES}</span>
      </div>
      <div class="otgrid" style=${`grid-template-columns:repeat(${cols.length},1fr)`}>
        ${cols.map((col) => html`<${Column} key=${col.i} col=${col} />`)}
      </div>
    </div>
  `;
}
