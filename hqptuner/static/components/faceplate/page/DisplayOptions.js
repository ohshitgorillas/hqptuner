// The Display popover on the Source header, and the button that opens it: how the page's meter draws, the spectrum's
// style and the level bars' floor, each a row of options writing its preference at once. Parked under its button.

import { html } from "../../../lib/dom.js";
import { METER_FLOORS, meterFloor, setMeterFloor, setSpectrumStyle, spectrumStyle } from "../../../store/ui/prefs.js";
import { Seg } from "../drawers/pipelines/parts.js";
import { Popover, parkAt, triggerProps } from "../Popover.js";

/** @typedef {import("../drawers/pipelines/parts.js").SegOption} Opt */

/** The popover's id, as its button names it. */
const DISPLAY = "display";

const LABEL = "Display";

/** @type {Opt[]} */
const SPECTRA = [
  { v: "trace", label: "Trace" },
  { v: "bars", label: "Bars" },
  { v: "soft", label: "Soft bars" },
  { v: "ridges", label: "Ridges" },
  { v: "aurora", label: "Aurora" },
];

/** @type {Opt[]} */
const FLOORS = METER_FLOORS.map((v) => ({ v, label: v }));

/** @typedef {import("../../../model/shell/place.js").Side} Side */
/** @typedef {import("../../../model/shell/place.js").Place} Place */

// Under the button, its left edge level with the button's, kept 22 px off both plate edges and 14 px off its foot.
/** @type {{ side: Side, foot: number, at: Place }} */
const HOW = { side: 22, foot: 14, at: { x: "start", y: "below", gap: 8 } };

/** @param {HTMLElement} panel */
function parkUnder(panel) {
  const at = parkAt(panel, HOW);
  if (!at) return;
  panel.style.left = `${Math.round(at.left)}px`;
  panel.style.top = `${Math.round(at.top)}px`;
}

/**
 * One field: its label (and unit) over its options, the one in force lit; another writes it.
 *
 * @param {{ label: string, unit?: string, opts: Opt[], value: string, set: (v: string) => void }} props
 */
function Field({ label, unit, opts, value, set }) {
  return html`
    <div class="dfield">
      <span class="cl">${label}${unit && html` <span class="u">${unit}</span>`}</span>
      <${Seg} aria=${unit ? `${label}, ${unit}` : label} cls="view" value=${value} options=${opts} onChange=${set} />
    </div>
  `;
}

/** The Display popover. */
export function DisplayOptions() {
  return html`
    <${Popover} id=${DISPLAY} cls="dpop" role="dialog" label=${LABEL} park=${parkUnder}>
      <${Field} label="Spectrum style" opts=${SPECTRA} value=${spectrumStyle.value} set=${setSpectrumStyle} />
      <${Field} label="Levels floor" unit="dBFS" opts=${FLOORS} value=${meterFloor.value} set=${setMeterFloor} />
    <//>
  `;
}

/** The Source header's button that opens the popover. */
export function DisplayButton() {
  return html`<button type="button" class="btn" ...${triggerProps(DISPLAY, "dialog")}>${LABEL}</button>`;
}
