// The page's Source section body: the Range column, the spectrum and one level bar per channel, stretched to the
// section's height; at 13″ each half carries its title and the bars their readings table, slim neither. Where there is
// no stream to draw, the line saying why sits in an empty glass well in the meter's place. The Range is a view, not a
// setting: it writes the page's own preference and nothing stages. What it shows is the store's
// (store/faceplate/page/meter.js).

import { html } from "../../../lib/dom.js";
import { classNames, minusText } from "../../../model/shell/format.js";
import { METER_NOTES as NOTES } from "../../../store/faceplate/drawers/source.js";
import { pageMeter } from "../../../store/faceplate/page/meter.js";
import { PAGE_RANGES, setPageRange } from "../../../store/ui/faceplate.js";
import { withXref } from "../Xref.js";

/** @typedef {import("../../../store/faceplate/page/meter.js").PageMeterView} PageMeterView */
/** @typedef {import("../../../store/faceplate/page/meter.js").ChannelLevel} ChannelLevel */

const SW = 600; // the spectrum's viewBox; the stylesheet stretches it over the plot
const SH = 170;
const STEREO = 2;

/**
 * A fraction of an axis as a CSS percentage.
 *
 * @param {number} f
 */
const pct = (f) => `${(f * 100).toFixed(2)}%`;

/**
 * A dB tick's label: the unit on full scale, a true minus below it.
 *
 * @param {number} db
 */
const dbText = (db) => (db === 0 ? "0 dBFS" : minusText(db));

/**
 * A channel's name on its bar and in the readings table: L and R on a stereo source, numbered otherwise.
 *
 * @param {number} i
 * @param {number} count
 */
const channelName = (i, count) => (count === STEREO ? ["L", "R"][i] : String(i + 1));

/**
 * A reading in dBFS to one place, blank while the channel has none.
 *
 * @param {number | null} db
 */
const reading = (db) => (db === null ? "" : minusText(db.toFixed(1)));

/**
 * The dB scale down an edge: one label per tick at its fraction from the top, the end labels marked so the stylesheet
 * keeps them inside their track.
 *
 * @param {{ cls: string, db: PageMeterView["db"] }} props
 */
function DbScale({ cls, db }) {
  const last = db.length - 1;
  return html`
    <div class=${cls} aria-hidden="true">
      ${db.map(
        (t, i) =>
          html`<span style=${`top:${pct(t.at)}`} class=${classNames(i === 0 && "first", i === last && "last") || undefined}>
            ${dbText(t.db)}
          </span>`,
      )}
    </div>
  `;
}

/**
 * The frequency axis under the spectrum: kHz across from 0, the unit on the 0 tick, the source Nyquist on the right
 * edge.
 *
 * @param {{ freq: PageMeterView["freq"] }} props
 */
function FreqScale({ freq }) {
  return html`
    <div class="xaxis" aria-hidden="true">
      ${freq.ticks.map(
        (t) =>
          html`<span style=${`left:${pct(t.at)}`} class=${t.khz === 0 ? "first" : undefined}>
            ${t.khz ? String(t.khz) : "0 kHz"}
          </span>`,
      )}
      <span class="last" data-nyq style=${`left:${pct(freq.nyq.at)}`} title="Source Nyquist">${`${freq.nyq.khz} kHz`}</span>
    </div>
  `;
}

/**
 * A trace's path in the viewBox, or undefined while it has no points.
 *
 * @param {[number, number][]} pts
 */
function pathOf(pts) {
  if (!pts.length) return undefined;
  return "M" + pts.map(([x, y]) => `${(x * SW).toFixed(1)},${(y * SH).toFixed(1)}`).join(" L");
}

/**
 * The spectrum: its title at 13″, the dB scale beside a glass well holding the grid, the filled trace and the held
 * peaks, the frequency axis under it.
 *
 * @param {{ view: PageMeterView }} props
 */
function Spectrum({ view }) {
  const line = pathOf(view.trace.disp);
  return html`
    <div class="sside">
      ${!view.slim && html`<div class="mhead"><b class="mt">Spectrum</b></div>`}
      <div class="sgrid1">
        <${DbScale} cls="gut gy" db=${view.db} />
        <div class="splot">
          <svg class="spectrum" viewBox=${`0 0 ${SW} ${SH}`} preserveAspectRatio="none" role="img" aria-label="Spectrum">
            <g class="sgridl">
              ${view.db.slice(1, -1).map((t) => html`<line x1="0" x2=${SW} y1=${t.at * SH} y2=${t.at * SH} />`)}
              ${view.freq.ticks.slice(1).map((t) => html`<line x1=${t.at * SW} x2=${t.at * SW} y1="0" y2=${SH} />`)}
            </g>
            <path class="sarea" d=${line && `${line} L${SW},${SH} L0,${SH} Z`} />
            <path class="shold" d=${pathOf(view.trace.peak)} />
            <path class="strace" d=${line} />
          </svg>
        </div>
        <span></span>
        <${FreqScale} freq=${view.freq} />
      </div>
    </div>
  `;
}

/**
 * One channel's bar: the peak fill, the RMS bar inside it and, with a reading, the hold mark.
 *
 * @param {{ lv: ChannelLevel, name: string }} props
 */
function Bar({ lv, name }) {
  return html`
    <div class="lvb">
      <div class="trough">
        <i class="pk" style=${`height:${pct(lv.peak)}`}></i>
        <i class="rm" style=${`height:${pct(lv.rms)}`}></i>
        ${lv.peakDb !== null && html`<i class="hd" style=${`bottom:${pct(lv.hold)}`}></i>`}
      </div>
      <span class="lvn">${name}</span>
    </div>
  `;
}

/**
 * The levels: their title at 13″, the dB scale, one bar per channel and, at 13″, the readings table.
 *
 * @param {{ view: PageMeterView }} props
 */
function Levels({ view }) {
  const n = view.levels.length;
  const names = view.levels.map((_, i) => channelName(i, n));
  return html`
    <div class="lside">
      ${!view.slim && html`<div class="mhead"><b class="mt">Levels</b></div>`}
      <div class="lvwrap">
        <${DbScale} cls="lvs" db=${view.db} />
        ${view.levels.map((lv, i) => html`<${Bar} lv=${lv} name=${names[i]} />`)}
        ${
          !view.slim &&
          html`
          <div class="lvtab">
            <span class="u">dBFS</span>
            ${names.map((name) => html`<span class="lvh">${name}</span>`)}
            <span class="lvh l">Peak</span>
            ${view.levels.map((lv) => html`<span class="npk">${reading(lv.peakDb)}</span>`)}
            <span class="lvh l">RMS</span>
            ${view.levels.map((lv) => html`<span class="nrm">${reading(lv.rmsDb)}</span>`)}
          </div>
        `
        }
      </div>
    </div>
  `;
}

/**
 * The Range column: its label over the stacked switch, the page's range lit; tapping another writes it.
 *
 * @param {{ range: number }} props
 */
function RangeColumn({ range }) {
  return html`
    <div class="mrange">
      <div class="lbl"><span class="eng">Range</span><span class="u">dB</span></div>
      <div class="seg view vert" role="radiogroup" aria-label="Range, dB" data-testid="page-range">
        ${PAGE_RANGES.map((v) => {
          const on = v === String(range);
          return html`
            <button type="button" class=${on ? "on" : undefined} data-v=${v} onClick=${() => on || setPageRange(v)}>
              ${v}
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

/** The page's Source section body, or the line saying why there is no meter. */
export function SourceMeter() {
  const view = pageMeter();
  if (view.state !== "live") {
    return html`
      <div class="pmeter" data-meter=${view.state}>
        <div class="mnone"><p>${withXref(NOTES[view.state], null)}</p></div>
      </div>
    `;
  }
  return html`
    <div class="pmeter" data-meter=${view.state}>
      <div class="mblk mtop">
        <${RangeColumn} range=${view.range} />
        <${Spectrum} view=${view} />
        <${Levels} view=${view} />
      </div>
    </div>
  `;
}
