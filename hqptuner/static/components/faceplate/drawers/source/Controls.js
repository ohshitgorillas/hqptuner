// The Source meter's view switches: Range, Channel, Window and Span in the spectrogram's head. Each lights the value
// it reads and writes its pick straight back; none stages and none marks the tab.

import { html } from "../../../../lib/dom.js";
import { FREQ_SPANS } from "../../../../model/gauges/meter/meter.js";
import { meterChoice, setSpectrogramSpan, spectrogramSpan } from "../../../../store/faceplate/drawers/source.js";
import {
  APOD_WINDOWS,
  METER_RANGES,
  apodWindow,
  meterRange,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../../store/ui/prefs.js";

/** @typedef {{ v: string, label: string }} SegOption */

const STEREO = 2;

/** @type {Record<string, string>} */
const WINDOW_LABELS = { 30: "30 s", 60: "1 min", 120: "2 min", 300: "5 min" };

/** @type {Record<string, string>} */
const SPAN_LABELS = { full: "Full", half: "1/2", quarter: "1/4" };

/** @type {SegOption[]} */
const RANGE_OPTIONS = METER_RANGES.map((v) => ({ v, label: v }));
/** @type {SegOption[]} */
const WINDOW_OPTIONS = APOD_WINDOWS.map((v) => ({ v, label: WINDOW_LABELS[v] }));
/** @type {SegOption[]} */
const SPAN_OPTIONS = FREQ_SPANS.map((v) => ({ v, label: SPAN_LABELS[v] }));

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

/** The Range switch: the color span in dB. */
function RangeCtl() {
  return html`
    <${Ctl} label="Range" unit="dB">
      <${Seg}
        testid="meter-range"
        aria="Range, dB"
        cls="view"
        value=${String(Number(meterRange.value))}
        options=${RANGE_OPTIONS}
        pick=${setMeterRange}
      />
    <//>
  `;
}

/** The Channel switch: the sum and each channel the source carries. */
function ChannelCtl() {
  const { channels, channel } = meterChoice.value;
  const count = channels.length - 1;
  return html`
    <${Ctl} label="Channel">
      <${Seg}
        testid="meter-channel"
        aria="Channel"
        cls="view"
        value=${channel}
        options=${channels.map((v) => ({ v, label: channelLabel(v, count) }))}
        pick=${setMeterChannel}
      />
    <//>
  `;
}

/** The Window switch: the playback the charts span. */
function WindowCtl() {
  return html`
    <${Ctl} label="Window">
      <${Seg}
        testid="meter-window"
        aria="Time window"
        cls="lc view"
        value=${apodWindow.value}
        options=${WINDOW_OPTIONS}
        pick=${setApodWindow}
      />
    <//>
  `;
}

/** The Span switch: the share of the band in view. */
function SpanCtl() {
  return html`
    <${Ctl} label="Span">
      <${Seg}
        testid="meter-span"
        aria="Span"
        cls="view"
        value=${spectrogramSpan.value}
        options=${SPAN_OPTIONS}
        pick=${setSpectrogramSpan}
      />
    <//>
  `;
}

/** The spectrogram head's Range, Channel, Window and Span switches, each reading only its own setting. */
export function SpectrogramControls() {
  return html`<${RangeCtl} /><${ChannelCtl} /><${WindowCtl} /><${SpanCtl} />`;
}
