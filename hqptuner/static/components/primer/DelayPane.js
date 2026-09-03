// The delay pane: group delay against frequency, 0 to source Nyquist, in
// milliseconds. Both phases are drawn at once, the selected one as the accent
// trace and the other as the ghost, so the comparison needs no toggling:
// linear phase is flat at half the filter length, minimum phase near zero low
// and climbing toward the cliff. The stop band is blanked by the store, and
// the pen lifts across it.
import { html } from "../../lib/dom.js";
import { delay, phase, rate } from "../../store/primergraph.js";
import { HALF_W as W, H, PADR, PADT, PLOT_H, fmt3, fmtKhz, niceStep, r1, ticks, xAxis, yAxis } from "./frame.js";

const PADL = 30;
const PLOT_W = W - PADL - PADR;
const FREQ_TICKS = 4;
const MS_TICKS = 4;
// The axis top sits a little above the slowest arrival, and never below this
// many milliseconds, so a unit tap still draws on a readable scale.
const HEADROOM = 1.1;
const MIN_TOP_MS = 0.1;

/**
 * A path through the finite points, lifting the pen where a point is blanked.
 * @param {number[]} xs
 * @param {Float64Array} ys
 * @returns {string}
 */
function brokenPath(xs, ys) {
  let d = "";
  let pen = false;
  for (let i = 0; i < ys.length; i += 1) {
    if (Number.isFinite(ys[i])) {
      d += `${pen ? " L" : " M"}${r1(xs[i])},${r1(ys[i])}`;
      pen = true;
    } else pen = false;
  }
  return d.trim();
}

/** The largest finite value across both curves, or zero. */
const peakOf = (/** @type {Float64Array[]} */ arrays) =>
  arrays.reduce((m, c) => c.reduce((a, v) => (Number.isFinite(v) && v > a ? v : a), m), 0);

/** The pane's curves on its grid, with the tick marks of both axes. */
function curves() {
  const { freqsHz, linearMs, minimumMs } = delay.value;
  const nyquist = rate.value / 2;
  const reach = Math.max(peakOf([linearMs, minimumMs]), MIN_TOP_MS) * HEADROOM;
  const step = niceStep(reach / MS_TICKS);
  const top = Math.ceil(reach / step) * step;
  const xOf = (/** @type {number} */ f) => PADL + (f / nyquist) * PLOT_W;
  const yOf = (/** @type {number} */ ms) => PADT + PLOT_H - (ms / top) * PLOT_H;
  const xs = freqsHz.map(xOf);
  const trace = (/** @type {Float64Array} */ ms) => brokenPath(xs, ms.map(yOf));
  const fStep = niceStep(nyquist / 1000 / FREQ_TICKS) * 1000;
  return {
    linear: trace(linearMs),
    minimum: trace(minimumMs),
    xMarks: ticks(fStep, nyquist, fStep).map((f) => ({ x: xOf(f), label: fmtKhz(f) })),
    yMarks: ticks(0, top, step).map((ms) => ({ y: yOf(ms), label: fmt3(ms) })),
  };
}

/** The delay pane: both phases' group delay, the selected one as the accent trace. */
export function DelayPane() {
  const { linear, minimum, xMarks, yMarks } = curves();
  const minimumSelected = phase.value === "minimum";
  return html`
    <div class="plot" data-pane="delay">
      <div class="t-label">Delay</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        ${yMarks.map((m) => html`<line class="plot-grid" x1=${PADL} y1=${r1(m.y)} x2=${W - PADR} y2=${r1(m.y)} />`)}
        ${yAxis(PADL, yMarks, "ms")}
        ${xAxis(W, xMarks, "kHz")}
        <path class="plot-trace ghost" d=${minimumSelected ? linear : minimum} />
        <path class="plot-trace applied" d=${minimumSelected ? minimum : linear} />
      </svg>
    </div>
  `;
}
