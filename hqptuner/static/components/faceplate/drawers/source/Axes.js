// The Source meter's axis labels: the frequency gutter beside the spectrogram, kHz up from 0 to the source Nyquist,
// and the time axis under it. Each label sits at its fraction along the edge; the end labels are marked so the
// stylesheet keeps them inside their track.

import { html } from "../../../../lib/dom.js";
import { classNames, minusText } from "../../../../model/shell/format.js";

/** @typedef {import("../../../../store/faceplate/drawers/source.js").SourceMeterView} SourceMeterView */

/**
 * A fraction of the axis as a CSS percentage.
 *
 * @param {number} f
 */
const pct = (f) => `${(f * 100).toFixed(2)}%`;

/**
 * The frequency gutter: a label per tick in kHz, the unit on the 0 tick at the bottom, the source Nyquist on the top
 * edge.
 *
 * @param {{ freq: SourceMeterView["freq"] }} props
 */
export function FreqAxis({ freq }) {
  return html`
    <div class="gut gy" aria-hidden="true">
      ${freq.ticks.map(
        (t) =>
          html`<span style=${`top:${pct(t.at)}`} class=${t.khz === 0 ? "last" : undefined}>
            ${t.khz ? String(t.khz) : "0 kHz"}
          </span>`,
      )}
      <span class="first" data-nyq style=${`top:${pct(freq.nyq.at)}`} title="Source Nyquist">${String(freq.nyq.khz)}</span>
    </div>
  `;
}

/**
 * The time axis: track position from the start for All, seconds or minutes back to now otherwise.
 *
 * @param {{ time: SourceMeterView["time"] }} props
 */
export function TimeAxis({ time }) {
  const unit = time.inMin ? "min" : "s";
  const last = time.ticks.length - 1;
  return html`
    <div class="xaxis" aria-hidden="true">
      ${time.ticks.map(
        (t, i) =>
          html`<span style=${`left:${pct(t.at)}`} class=${classNames(i === 0 && "first", i === last && "last") || undefined}>
            ${`${minusText(t.value)} ${unit}`}
          </span>`,
      )}
    </div>
  `;
}
