// The frequency pane: linear frequency from 0 to the larger of twice the
// source rate and the output rate, the source music as a wash below source
// Nyquist, its images mirrored above, the filter magnitude as the accent
// trace, and the output stream as a fill: above source Nyquist it is the leak,
// and when downsampling what folds into the passband. No oversampling draws no
// filter and the output equals the input.
import { html } from "../../lib/dom.js";
import { clamp } from "../../lib/coerce.js";
import { axisHz, outputRate, rate, spectrum } from "../../store/primergraph.js";
import { AXIS_Y, FULL_W as W, H, PADR, PADT, PLOT_H, fmtKhz, niceStep, r1, ticks, xAxis, yAxis } from "./frame.js";

const PADL = 30;
const PLOT_W = W - PADL - PADR;
const DB_MIN = -120;
const DB_STEP = 30;
// Frequency ticks across the axis, at most; the step rounds up to a round figure.
const FREQ_TICKS = 8;

/**
 * The pane's curves from the store's spectrum on its grid from 0 to the axis
 * top: the source and its images, the filter, and the output stream.
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
  // Where the axis stops at the source's own Nyquist, as it does when the chain
  // decimates, the grid holds no frequency above it and the image band is empty.
  const above = freqsHz.findIndex((/** @type {number} */ f) => f > fs / 2);
  const half = above < 0 ? freqsHz.length : above;
  const step = niceStep(top / 1000 / FREQ_TICKS) * 1000;
  return {
    wash: filled(sourceDb, 0, half),
    images: filled(sourceDb, half, freqsHz.length),
    leak: filled(resultDb, 0, freqsHz.length),
    filter:
      out === null
        ? null
        : freqsHz.map((/** @type {number} */ _, /** @type {number} */ i) => pt(i, filterDb[i])).join(" "),
    xMarks: ticks(step, top, step).map((f) => ({ x: xOf(f), label: fmtKhz(f) })),
    yMarks: ticks(0, -DB_MIN, DB_STEP).map((db) => ({ y: yOf(-db), label: `${-db}` })),
    marks: [
      { mark: "source", x: xOf(fs / 2), hz: fs / 2 },
      ...(out !== null && out !== fs ? [{ mark: "output", x: xOf(out / 2), hz: out / 2 }] : []),
    ],
  };
}

/** The frequency pane: source wash, images, filter trace, Nyquist marks and the output fill. */
export function FrequencyPane() {
  const { wash, images, leak, filter, xMarks, yMarks, marks } = frequency();
  return html`
    <div class="plot" data-pane="frequency">
      <div class="t-label">Frequency</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        ${yMarks.map((m) => html`<line class="plot-grid" x1=${PADL} y1=${r1(m.y)} x2=${W - PADR} y2=${r1(m.y)} />`)}
        ${yAxis(PADL, yMarks, "dB")}
        <path class="primer-wash" d=${wash} />
        <path class="primer-images" d=${images} />
        ${marks.map(({ mark, x, hz }) => {
          const sx = r1(x);
          return html`
            <line class="primer-nyquist" data-mark=${mark} x1=${sx} y1=${PADT} x2=${sx} y2=${PADT + PLOT_H} />
            <text class="plot-lbl plot-axis" x=${sx} y=${AXIS_Y} text-anchor="middle">${fmtKhz(hz)}k</text>
          `;
        })}
        <path class="primer-leak" d=${leak} />
        ${filter ? html`<polyline class="plot-trace applied" points=${filter} />` : null}
        ${xAxis(W, xMarks, "kHz")}
      </svg>
    </div>
  `;
}
