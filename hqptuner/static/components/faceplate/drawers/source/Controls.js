// The Source meter's view switches: Range, Channel, Window and Span in the spectrogram's head. Each lights the value
// it reads and writes its pick straight back; none stages and none marks the tab.

import { html } from "../../../../lib/dom.js";
import { FREQ_SPANS } from "../../../../model/gauges/meter.js";
import { setSpectrogramSpan } from "../../../../store/faceplate/drawers/source.js";
import {
  APOD_WINDOWS,
  METER_RANGES,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../../store/ui/prefs.js";

/** @typedef {import("../../../../store/faceplate/drawers/source.js").SourceMeterView} SourceMeterView */
/** @typedef {{ v: string, label: string }} SegOption */

const STEREO = 2;

/** @type {Record<string, string>} */
const WINDOW_LABELS = { 30: "30 s", 60: "1 min", 120: "2 min", 300: "5 min" };

/** @type {Record<string, string>} */
const SPAN_LABELS = { full: "Full", half: "1/2", quarter: "1/4" };

/**
 * A segmented switch, the option matching `value` lit; tapping another reports it.
 *
 * @param {{ testid: string, aria: string, cls: string, value: string, options: SegOption[], pick: (v: string) => void }} props
 */
function Seg({ testid, aria, cls, value, options, pick }) {
  return html`
    <div class=${`seg ${cls}`} role="radiogroup" aria-label=${aria} data-testid=${testid}>
      ${options.map((o) => {
        const on = o.v === value;
        return html`
          <button type="button" class=${on ? "on" : undefined} data-v=${o.v} onClick=${() => (on ? undefined : pick(o.v))}>
            ${o.label}
          </button>
        `;
      })}
    </div>
  `;
}

/**
 * One control: engraved label, its unit where it has one, then the switch.
 *
 * @param {{ label: string, unit?: string, children?: unknown }} props
 */
function Ctl({ label, unit, children }) {
  return html`
    <div class="mctl">
      <span class="eng">${label}</span>
      ${unit ? html`<span class="u">${unit}</span>` : null} ${children}
    </div>
  `;
}

/**
 * A channel choice's label: Sum, Left and Right on a stereo source, numbered channels otherwise.
 *
 * @param {string} v
 * @param {number} count  channels the source carries
 */
function channelLabel(v, count) {
  if (v === "sum") return "Sum";
  return count === STEREO ? ["Left", "Right"][Number(v)] : String(Number(v) + 1);
}

/**
 * The spectrogram head's Range, Channel, Window and Span switches.
 *
 * @param {{ view: SourceMeterView }} props
 */
export function SpectrogramControls({ view }) {
  const count = view.channels.length - 1;
  return html`
    <${Ctl} label="Range" unit="dB">
      <${Seg}
        testid="meter-range"
        aria="Range, dB"
        cls="view"
        value=${String(view.range)}
        options=${METER_RANGES.map((v) => ({ v, label: v }))}
        pick=${setMeterRange}
      />
    <//>
    <${Ctl} label="Channel">
      <${Seg}
        testid="meter-channel"
        aria="Channel"
        cls="view"
        value=${view.channel}
        options=${view.channels.map((v) => ({ v, label: channelLabel(v, count) }))}
        pick=${setMeterChannel}
      />
    <//>
    <${Ctl} label="Window">
      <${Seg}
        testid="meter-window"
        aria="Time window"
        cls="lc view"
        value=${view.window}
        options=${APOD_WINDOWS.map((v) => ({ v, label: WINDOW_LABELS[v] }))}
        pick=${setApodWindow}
      />
    <//>
    <${Ctl} label="Span">
      <${Seg}
        testid="meter-span"
        aria="Span"
        cls="view"
        value=${view.freqSpan}
        options=${FREQ_SPANS.map((v) => ({ v, label: SPAN_LABELS[v] }))}
        pick=${setSpectrogramSpan}
      />
    <//>
  `;
}
