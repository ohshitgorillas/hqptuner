// The Display popover on the Source header, and the button that opens it: how the page's meter draws, the spectrum's
// style and colors, the level bars' floor, whether the spectrum shows its Range buttons, the page's Range and the
// spectrum's frequency span, each a row of options writing its preference at once, and the spectrum delay, a box
// taking the delay in seconds, written as the user leaves it. Parked to the left of its button.

import { html, TypedInput } from "../../../lib/dom.js";
import { FREQ_SPANS } from "../../../model/gauges/meter.js";
import {
  METER_FLOORS,
  METER_RANGES,
  meterFloor,
  pageRange,
  rangeButtons,
  setMeterFloor,
  setPageRange,
  setRangeButtons,
  setSpectrumColors,
  setSpectrumStyle,
  spectrumColors,
  spectrumStyle,
} from "../../../store/ui/prefs.js";
import { freqSpan, setFreqSpan } from "../../../store/faceplate/view.js";
import { setSpectrumOffset, spectrumOffset } from "../../../store/meter/delay.js";
import { Seg } from "../drawers/pipelines/parts.js";
import { Popover, parkAt, triggerProps } from "../Popover.js";

/** @typedef {import("../drawers/pipelines/parts.js").SegOption} Opt */
/** @typedef {{ target: { value: string } }} ChangeEv */

/** The popover's id, as its button names it. */
const DISPLAY = "display";

const LABEL = "Display";

/** @type {Opt[]} */
const SPECTRA = [
  { v: "trace", label: "Trace" },
  { v: "bars", label: "Bars" },
  { v: "ridges", label: "Ridges" },
  { v: "aurora", label: "Aurora" },
  { v: "fade", label: "Fade" },
];

/** @type {Opt[]} */
const SUITES = [
  { v: "accent", label: "Accent" },
  { v: "retro", label: "Retro" },
  { v: "inferno", label: "Inferno" },
  { v: "viridis", label: "Viridis" },
  { v: "borealis", label: "Borealis" },
  { v: "mono", label: "Mono" },
];

/** @type {Opt[]} */
const FLOORS = METER_FLOORS.map((v) => ({ v, label: v }));

/** @type {Opt[]} */
const SHOW_HIDE = [
  { v: "1", label: "Show" },
  { v: "0", label: "Hide" },
];

/** @type {Opt[]} */
const RANGES = METER_RANGES.map((v) => ({ v, label: v }));

/** @type {Record<string, string>} */
const SPAN_LABELS = { full: "Full", half: "1/2", quarter: "1/4" };

/** @type {Opt[]} */
const SPANS = FREQ_SPANS.map((v) => ({ v, label: SPAN_LABELS[v] }));

/** @param {string} v */
const setShown = (v) => setRangeButtons(v === "1");

/** @typedef {import("../../../model/shell/place.js").Side} Side */
/** @typedef {import("../../../model/shell/place.js").Place} Place */

// Left of the button, its top level with the button's, kept 22 px off both plate edges; raised when it would come within
// 14 px of the plate's foot.
/** @type {{ side: Side, foot: number, at: Place }} */
const HOW = { side: 22, foot: 14, at: { x: "before", y: "top", gap: 8 } };

/** @param {HTMLElement} panel */
function parkBeside(panel) {
  const at = parkAt(panel, HOW);
  if (!at) return;
  panel.style.left = `${Math.round(at.left)}px`;
  panel.style.top = `${Math.round(at.top)}px`;
}

/**
 * One field: its label (and unit) over its options, the one in force lit, and a line saying what it does; another
 * writes it.
 *
 * @param {{ label: string, unit?: string, man: string, opts: Opt[], value: string, set: (v: string) => void, testid?: string }} props
 */
function Field({ label, unit, man, opts, value, set, testid }) {
  return html`
    <div class="dfield" data-testid=${testid}>
      <span class="cl">${label}${unit && html` <span class="u">${unit}</span>`}</span>
      <${Seg} aria=${unit ? `${label}, ${unit}` : label} cls="view" value=${value} options=${opts} onChange=${set} />
      <p class="man">${man}</p>
    </div>
  `;
}

/**
 * The spectrum delay: its label over the delay in seconds, typed, and a line saying what it does; what the box holds
 * is written as the user leaves it.
 */
function Delay() {
  return html`
    <div class="dfield" data-field="vdelay">
      <span class="cl">Spectrum delay</span>
      <div class="num">
        <${TypedInput}
          type="number"
          class="vfd"
          min="-5"
          max="5"
          step="0.01"
          aria-label="Spectrum delay, seconds"
          value=${spectrumOffset.value}
          onChange=${(/** @type {ChangeEv} */ e) => setSpectrumOffset(e.target.value)}
        />
        <span class="u">s</span>
      </div>
      <p class="man">Adjust the spectrum's response to your own ears.</p>
    </div>
  `;
}

/** The Display popover. */
export function DisplayOptions() {
  return html`
    <${Popover} id=${DISPLAY} cls="dpop" role="dialog" label=${LABEL} park=${parkBeside}>
      <${Field} label="Spectrum style" man="Change the spectrum's visual style." opts=${SPECTRA} value=${spectrumStyle.value} set=${setSpectrumStyle} />
      <${Field} label="Colors" man="Change the spectrum's colors." opts=${SUITES} value=${spectrumColors.value} set=${setSpectrumColors} />
      <${Field} label="Levels floor" man="Change how far down the meter range goes." unit="dBFS" opts=${FLOORS} value=${meterFloor.value} set=${setMeterFloor} />
      <${Field}
        label="Range buttons"
        man="Show buttons on the spectrum to adjust the level range."
        opts=${SHOW_HIDE}
        value=${rangeButtons.value ? "1" : "0"}
        set=${setShown}
        testid="display-range-buttons"
      />
      <${Field} label="Range" unit="dB" man="Change how far down the spectrum's level range goes." opts=${RANGES} value=${pageRange.value} set=${setPageRange} testid="display-range" />
      <${Field} label="Frequency span" man="Show a limited range of the spectrum's frequency." opts=${SPANS} value=${freqSpan.value} set=${setFreqSpan} />
      <${Delay} />
    <//>
  `;
}

/** The Source header's button that opens the popover. */
export function DisplayButton() {
  return html`<button type="button" class="btn" ...${triggerProps(DISPLAY, "dialog")}>${LABEL}</button>`;
}
