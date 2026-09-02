// The filter primer's graph: two SVG panes side by side, both drawn from
// store/primergraph.js (docs/plans/filter-primer-graph.md).
//
// Impulse pane: the transient as a ghost trace, the filtered output as the
// accent trace, the transient centred, milliseconds either side. The axis span
// follows the filter length so a short filter fills the frame as well as a long
// one. Frequency pane: linear frequency from 0 to twice the source rate, the
// source music as a wash below Nyquist, its images mirrored above, the filter
// magnitude as the accent trace, and what survives both as a fill; the fill
// above the Nyquist mark is the leak.
//
// `PlotFrame` (../plots.js) is unusable here, its axis is log 20 Hz to 20 kHz;
// the plot classes and the depth ladder in cards/plots.css are reused. Every
// curve is textbook FIR design computed in the browser, no HQPlayer filter is
// plotted, named or approximated.
import { html } from "../../lib/dom.js";
import { clamp } from "../../lib/coerce.js";
import { filterPulse, gaussianPulse, magnitudeDb, sourceSpectrumDb } from "../../lib/dsp/fir.js";
import { content, design, rate, transientUs } from "../../store/primergraph.js";

const W = 320;
const H = 200;
const PADL = 30;
const PADR = 10;
const PADT = 10;
const PADB = 20;
const PLOT_W = W - PADL - PADR;
const PLOT_H = H - PADT - PADB;
const DB_MIN = -120;
const DB_STEP = 30;
const FREQ_POINTS = 512;
// The impulse axis reaches a little past the filter's own half length.
const SPAN_MARGIN = 1.1;
const TIME_TICKS = 4;

/** @param {number} v */
const r1 = (v) => v.toFixed(1);

/**
 * The impulse pane's traces: output and pulse, in milliseconds from the pulse
 * centre and normalised to the pulse peak.
 */
function impulse() {
  const { designRate, taps, h } = design.value;
  const pulse = gaussianPulse((transientUs.value / 1e6) * designRate);
  const { y, delay } = filterPulse(h, pulse);
  const centre = delay + (pulse.length - 1) / 2;
  const msPer = 1000 / designRate;
  const span = ((taps / 2) * msPer + (pulse.length * msPer) / 2) * SPAN_MARGIN;
  const xOf = (/** @type {number} */ ms) => PADL + ((ms + span) / (2 * span)) * PLOT_W;
  const yOf = (/** @type {number} */ v) => PADT + PLOT_H / 2 - (v * PLOT_H) / 2;
  const trace = (/** @type {Float64Array} */ s, /** @type {number} */ c) =>
    Array.from(s, (v, k) => `${r1(xOf((k - c) * msPer))},${r1(yOf(v))}`).join(" ");
  const step = niceStep(span / TIME_TICKS);
  /** @type {number[]} */
  const ticks = [];
  for (let ms = 0; ms <= span; ms += step) ticks.push(ms);
  return { out: trace(y, centre), ghost: trace(pulse, (pulse.length - 1) / 2), xOf, yOf, ticks };
}

/**
 * A round tick step at or below the raw one: 1, 2 or 5 times a power of ten.
 * @param {number} raw
 * @returns {number}
 */
function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = raw / mag;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * mag;
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
        ${ticks.map(
          (ms) => html`
            <text class="plot-lbl" x=${r1(xOf(ms))} y=${H - 6} text-anchor="middle">${fmtMs(ms)}</text>
            ${ms > 0 ? html`<text class="plot-lbl" x=${r1(xOf(-ms))} y=${H - 6} text-anchor="middle">-${fmtMs(ms)}</text>` : null}
          `,
        )}
        <text class="plot-lbl plot-axis" x=${W - PADR} y=${H - 6} text-anchor="end">ms</text>
        <polyline class="plot-trace ghost" points=${ghost} />
        <polyline class="plot-trace applied" points=${out} />
      </svg>
    </div>
  `;
}

/**
 * The frequency pane's curves on a linear grid from 0 to twice the source rate:
 * the source and its images, the filter, and their product.
 */
function frequency() {
  const { designRate, h } = design.value;
  const fs = rate.value;
  const top = 2 * fs;
  const grid = Array.from({ length: FREQ_POINTS }, (_, i) => (i / (FREQ_POINTS - 1)) * top);
  // Every image of the source is the source folded about a multiple of Nyquist.
  const folded = grid.map((f) => {
    const m = f % fs;
    return m > fs / 2 ? fs - m : m;
  });
  const source = sourceSpectrumDb(fs, folded, content.value);
  const filter = magnitudeDb(h, designRate, grid);
  const xOf = (/** @type {number} */ f) => PADL + (f / top) * PLOT_W;
  const yOf = (/** @type {number} */ db) => PADT + (clamp(db, DB_MIN, 0) / DB_MIN) * PLOT_H;
  const pt = (/** @type {number} */ i, /** @type {number} */ db) => `${r1(xOf(grid[i]))},${r1(yOf(db))}`;
  const filled = (/** @type {(i: number) => number} */ at, /** @type {number} */ from, /** @type {number} */ to) => {
    const pts = [];
    for (let i = from; i < to; i += 1) pts.push(pt(i, at(i)));
    return `M${r1(xOf(grid[from]))},${r1(yOf(DB_MIN))} L${pts.join(" L")} L${r1(xOf(grid[to - 1]))},${r1(yOf(DB_MIN))} Z`;
  };
  const half = grid.findIndex((f) => f > fs / 2);
  return {
    wash: filled((i) => source[i], 0, half),
    images: filled((i) => source[i], half, grid.length),
    leak: filled((i) => source[i] + filter[i], 0, grid.length),
    filter: grid.map((_, i) => pt(i, filter[i])).join(" "),
    xOf,
    yOf,
    top,
    nyquist: fs / 2,
  };
}

/** @param {number} f */
const fmtKhz = (f) => `${Number((f / 1000).toPrecision(3))}`;

function FrequencyPane() {
  const { wash, images, leak, filter, xOf, yOf, top, nyquist } = frequency();
  /** @type {number[]} */
  const dbLines = [];
  for (let db = 0; db >= DB_MIN; db -= DB_STEP) dbLines.push(db);
  const fTicks = [0, nyquist, 2 * nyquist, 3 * nyquist, top];
  const nx = r1(xOf(nyquist));
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
        <text class="plot-lbl plot-axis" x=${PADL - 4} y=${PADT - 2} text-anchor="end">dB</text>
        <path class="primer-wash" d=${wash} />
        <path class="primer-images" d=${images} />
        <line class="primer-nyquist" x1=${nx} y1=${PADT} x2=${nx} y2=${PADT + PLOT_H} />
        <text class="plot-lbl plot-axis" x=${nx} y=${PADT - 2} text-anchor="middle">Nyquist</text>
        <path class="primer-leak" d=${leak} />
        <polyline class="plot-trace applied" points=${filter} />
        ${fTicks.map(
          (f) => html`<text class="plot-lbl" x=${r1(xOf(f))} y=${H - 6} text-anchor="middle">${fmtKhz(f)}</text>`,
        )}
        <text class="plot-lbl plot-axis" x=${W - PADR} y=${PADT - 2} text-anchor="end">kHz</text>
      </svg>
    </div>
  `;
}

/** The primer graph: impulse pane and frequency pane, side by side. */
export function PrimerGraph() {
  return html`
    <div class="primer-panes">
      <${ImpulsePane} />
      <${FrequencyPane} />
    </div>
  `;
}
