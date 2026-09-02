// The filter primer's graph: two SVG panes side by side, both drawn from
// store/primergraph.js (docs/plans/filter-primer-graph.md).
//
// Impulse pane: the transient as a ghost trace, the filtered output as the
// accent trace, the transient centred, milliseconds either side. The axis span
// follows the filter length so a short filter fills the frame as well as a long
// one. Frequency pane: linear frequency from 0 to the larger of twice the
// source rate and the output rate, the source music as a wash below source
// Nyquist, its images mirrored above, the filter magnitude as the accent
// trace, and the output stream as a fill: above source Nyquist it is the leak,
// and when downsampling what folds into the passband. No oversampling draws no
// filter and the output equals the input.
//
// `PlotFrame` (../plots.js) is unusable here, its axis is log 20 Hz to 20 kHz;
// the plot classes and the depth ladder in cards/plots.css are reused. Every
// curve is textbook FIR design computed in the browser, no HQPlayer filter is
// plotted, named or approximated.
import { html } from "../../lib/dom.js";
import { clamp } from "../../lib/coerce.js";
import { filterPulse } from "../../lib/dsp/fir.js";
import { axisHz, design, outputRate, pulse, rate, spectrum } from "../../store/primergraph.js";
import { PrimerControls } from "./Controls.js";

const W = 320;
const H = 200;
const PADL = 30;
const PADR = 10;
// The top band is the axis words' own row, clear of the first tick label.
const PADT = 18;
const AXIS_Y = 9;
const PADB = 20;
const PLOT_W = W - PADL - PADR;
const PLOT_H = H - PADT - PADB;
const DB_MIN = -120;
const DB_STEP = 30;
// Frequency ticks across the axis, at most; the step rounds up to a round figure.
const FREQ_TICKS = 5;
// The impulse axis reaches a little past the filter's own half length.
const SPAN_MARGIN = 1.1;
// Ticks per side of the transient, at most; the step rounds up to a round
// figure so the labels never crowd.
const TIME_TICKS = 4;

/** @param {number} v */
const r1 = (v) => v.toFixed(1);
/**
 * The impulse pane's traces: output and pulse, in milliseconds from the pulse
 * centre and normalised to the pulse peak.
 */
function impulse() {
  const { designRate, taps, h } = design.value;
  const p = pulse.value;
  const { y, delay } = filterPulse(h, p);
  const centre = delay + (p.length - 1) / 2;
  const msPer = 1000 / designRate;
  const span = ((taps / 2) * msPer + (p.length * msPer) / 2) * SPAN_MARGIN;
  const xOf = (/** @type {number} */ ms) => PADL + ((ms + span) / (2 * span)) * PLOT_W;
  const yOf = (/** @type {number} */ v) => PADT + PLOT_H / 2 - (v * PLOT_H) / 2;
  const trace = (/** @type {Float64Array} */ s, /** @type {number} */ c) =>
    Array.from(s, (v, k) => `${r1(xOf((k - c) * msPer))},${r1(yOf(v))}`).join(" ");
  const step = niceStep(span / TIME_TICKS);
  /** @type {number[]} */
  const ticks = [];
  for (let ms = 0; ms <= span; ms += step) ticks.push(ms);
  return { out: trace(y, centre), ghost: trace(p, (p.length - 1) / 2), xOf, yOf, ticks };
}

/**
 * A round tick step at or above the raw one: 1, 2, 5 or 10 times a power of ten.
 * @param {number} raw
 * @returns {number}
 */
function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = raw / mag;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * mag;
}

/** @param {number} ms */
const fmtMs = (ms) => `${Number(ms.toPrecision(3))}`;

function ImpulsePane() {
  const { out, ghost, xOf, yOf, ticks } = impulse();
  const cx = r1(xOf(0));
  const cy = r1(yOf(0));
  return html`
    <div class="plot" data-pane="impulse">
      <div class="t-label">Impulse</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        <line class="plot-zero" x1=${PADL} y1=${cy} x2=${W - PADR} y2=${cy} />
        <line class="plot-zero" x1=${cx} y1=${PADT} x2=${cx} y2=${PADT + PLOT_H} />
        <text class="plot-lbl plot-axis" x=${PADL - 4} y=${H - 6} text-anchor="end">ms</text>
        ${ticks.map(
          (ms) => html`
            <text class="plot-lbl" x=${r1(xOf(ms))} y=${H - 6} text-anchor="middle">${fmtMs(ms)}</text>
            ${ms > 0 ? html`<text class="plot-lbl" x=${r1(xOf(-ms))} y=${H - 6} text-anchor="middle">-${fmtMs(ms)}</text>` : null}
          `,
        )}
        <polyline class="plot-trace ghost" points=${ghost} />
        <polyline class="plot-trace applied" points=${out} />
      </svg>
    </div>
  `;
}

/**
 * The frequency pane's curves from the store's spectrum on its grid from 0 to
 * the axis top: the source and its images, the filter, and the output stream.
 */
function frequency() {
  const { freqsHz, sourceDb, filterDb, resultDb } = spectrum.value;
  const fs = rate.value;
  const top = axisHz.value;
  const out = outputRate.value;
  const xOf = (/** @type {number} */ f) => PADL + (f / top) * PLOT_W;
  const yOf = (/** @type {number} */ db) => PADT + (clamp(db, DB_MIN, 0) / DB_MIN) * PLOT_H;
  const pt = (/** @type {number} */ i, /** @type {number} */ db) => `${r1(xOf(freqsHz[i]))},${r1(yOf(db))}`;
  const filled = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) => {
    const pts = [];
    for (let i = from; i < to; i += 1) pts.push(pt(i, at[i]));
    return `M${r1(xOf(freqsHz[from]))},${r1(yOf(DB_MIN))} L${pts.join(" L")} L${r1(xOf(freqsHz[to - 1]))},${r1(yOf(DB_MIN))} Z`;
  };
  const half = freqsHz.findIndex((/** @type {number} */ f) => f > fs / 2);
  const step = niceStep(top / 1000 / FREQ_TICKS) * 1000;
  /** @type {number[]} */
  const ticks = [];
  for (let f = step; f <= top; f += step) ticks.push(f);
  return {
    wash: filled(sourceDb, 0, half),
    images: filled(sourceDb, half, freqsHz.length),
    leak: filled(resultDb, 0, freqsHz.length),
    filter:
      out === null
        ? null
        : freqsHz.map((/** @type {number} */ _, /** @type {number} */ i) => pt(i, filterDb[i])).join(" "),
    xOf,
    yOf,
    ticks,
    marks: [{ mark: "source", hz: fs / 2 }, ...(out !== null && out !== fs ? [{ mark: "output", hz: out / 2 }] : [])],
  };
}

/** @param {number} f */
const fmtKhz = (f) => `${Number((f / 1000).toPrecision(3))}`;

function FrequencyPane() {
  const { wash, images, leak, filter, xOf, yOf, ticks, marks } = frequency();
  /** @type {number[]} */
  const dbLines = [];
  for (let db = 0; db >= DB_MIN; db -= DB_STEP) dbLines.push(db);
  return html`
    <div class="plot" data-pane="frequency">
      <div class="t-label">Frequency</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        ${dbLines.map(
          (db) => html`
            <line class="plot-grid" x1=${PADL} y1=${r1(yOf(db))} x2=${W - PADR} y2=${r1(yOf(db))} />
            <text class="plot-lbl" x=${PADL - 4} y=${r1(yOf(db) + 2.5)} text-anchor="end">${db}</text>
          `,
        )}
        <text class="plot-lbl plot-axis" x=${PADL - 4} y=${AXIS_Y} text-anchor="end">dB</text>
        <path class="primer-wash" d=${wash} />
        <path class="primer-images" d=${images} />
        ${marks.map(({ mark, hz }) => {
          const x = r1(xOf(hz));
          return html`
            <line class="primer-nyquist" data-mark=${mark} x1=${x} y1=${PADT} x2=${x} y2=${PADT + PLOT_H} />
            <text class="plot-lbl plot-axis" x=${x} y=${AXIS_Y} text-anchor="middle">${fmtKhz(hz)}k</text>
          `;
        })}
        <path class="primer-leak" d=${leak} />
        ${filter ? html`<polyline class="plot-trace applied" points=${filter} />` : null}
        <text class="plot-lbl plot-axis" x=${PADL - 4} y=${H - 6} text-anchor="end">kHz</text>
        ${ticks.map(
          (f) => html`
            <text class="plot-lbl" x=${r1(xOf(f))} y=${H - 6} text-anchor="middle">${fmtKhz(f)}</text>
          `,
        )}
      </svg>
    </div>
  `;
}

/** The primer graph: impulse pane and frequency pane, side by side, the controls beneath. */
export function PrimerGraph() {
  return html`
    <div class="primer-graph">
      <div class="primer-panes">
        <${ImpulsePane} />
        <${FrequencyPane} />
      </div>
      <${PrimerControls} />
    </div>
  `;
}
