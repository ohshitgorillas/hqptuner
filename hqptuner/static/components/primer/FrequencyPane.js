// The frequency pane: linear frequency from 0 to the larger of twice the
// source rate and the output rate, the source music as a wash below source
// Nyquist, its images mirrored above, the filter magnitude as the accent
// trace, and the output stream as a fill: above source Nyquist it is the leak,
// and when downsampling what folds into the passband. No oversampling draws no
// filter and no leak: the output is the source's own curve, and a fill painted
// over the wash and its images at one opacity would flatten the two into one
// slab.
//
// Every curve is drawn through `peakColumns`, one column per pixel the page
// reports and the column's peak within it, so a comb finer than the window can
// hold reads as its own envelope instead of beating against the pixel grid;
// the store's grid is dense enough for the peak to be one (math section 5.4).
// The dB scale carries headroom above 0 so a passband overshoot draws as the
// overshoot it is rather than as a flat run along the top of the plot, and the
// Nyquist marks are drawn over the fills so a reference line stays a line.
import { useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { clamp } from "../../lib/coerce.js";
import { peakColumns } from "../../lib/dsp/render.js";
import { axisHz, freqPx, outputRate, rate, spectrum } from "../../store/primergraph.js";
import { AXIS_Y, FULL_W as W, H, PADR, PADT, PLOT_H, fmtKhz, niceStep, r1, ticks, xAxis, yAxis } from "./frame.js";
import { useMeasuredPlot } from "./measure.js";

const PADL = 30;
const PLOT_W = W - PADL - PADR;
const DB_MIN = -120;
/** Headroom over unity: the passband ripple of a short filter lives up here. */
const DB_MAX = 6;
const DB_STEP = 30;
// Frequency ticks across the axis, at most; the step rounds up to a round figure.
const FREQ_TICKS = 8;

/**
 * The pane's curves from the store's spectrum on its grid from 0 to the axis
 * top: the source and its images, the filter, and the output stream. Each is
 * reduced to the columns the page gives the pane, or to the pane's own drawing
 * width where the page has measured nothing.
 */
function frequency() {
  const { freqsHz, sourceDb, filterDb, resultDb } = spectrum.value;
  const fs = rate.value;
  const top = axisHz.value;
  const out = outputRate.value;
  const columns = freqPx.value || PLOT_W;
  const xOf = (/** @type {number} */ f) => PADL + (f / top) * PLOT_W;
  const yOf = (/** @type {number} */ db) => PADT + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * PLOT_H;
  const pt = (/** @type {number} */ i, /** @type {number} */ db) => `${r1(xOf(freqsHz[i]))},${r1(yOf(db))}`;
  const drawn = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) =>
    peakColumns(at, from, to, columns);
  const filled = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) => {
    const keep = drawn(at, from, to);
    if (keep.length === 0) return null;
    const pts = keep.map((i) => pt(i, at[i]));
    const foot = (/** @type {number} */ i) => `${r1(xOf(freqsHz[i]))},${r1(yOf(DB_MIN))}`;
    return `M${foot(keep[0])} L${pts.join(" L")} L${foot(keep[keep.length - 1])} Z`;
  };
  // Where the axis stops at the source's own Nyquist, as it does when the chain
  // decimates, the grid holds no frequency above it and the image band is empty.
  const above = freqsHz.findIndex((/** @type {number} */ f) => f > fs / 2);
  const half = above < 0 ? freqsHz.length : above;
  const step = niceStep(top / 1000 / FREQ_TICKS) * 1000;
  const identity = out === null || out === fs;
  return {
    wash: filled(sourceDb, 0, half),
    images: filled(sourceDb, half, freqsHz.length),
    leak: identity ? null : filled(resultDb, 0, freqsHz.length),
    filter:
      out === null
        ? null
        : drawn(filterDb, 0, freqsHz.length)
            .map((i) => pt(i, filterDb[i]))
            .join(" "),
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
  const svg = useRef(/** @type {SVGSVGElement | null} */ (null));
  useMeasuredPlot(svg, freqPx, PLOT_W / W);
  const { wash, images, leak, filter, xMarks, yMarks, marks } = frequency();
  return html`
    <div class="plot" data-pane="frequency">
      <div class="t-label">Frequency</div>
      <svg ref=${svg} viewBox="0 0 ${W} ${H}" class="plot-svg">
        ${yMarks.map((m) => html`<line class="plot-grid" x1=${PADL} y1=${r1(m.y)} x2=${W - PADR} y2=${r1(m.y)} />`)}
        ${yAxis(PADL, yMarks, "dB")}
        ${wash ? html`<path class="primer-wash" d=${wash} />` : null}
        ${images ? html`<path class="primer-images" d=${images} />` : null}
        ${leak ? html`<path class="primer-leak" d=${leak} />` : null}
        ${marks.map(({ mark, x, hz }) => {
          const sx = r1(x);
          return html`
            <line class="primer-nyquist" data-mark=${mark} x1=${sx} y1=${PADT} x2=${sx} y2=${PADT + PLOT_H} />
            <text class="plot-lbl plot-axis" x=${sx} y=${AXIS_Y} text-anchor="middle">${fmtKhz(hz)}k</text>
          `;
        })}
        ${filter ? html`<polyline class="plot-trace applied" points=${filter} />` : null}
        ${xAxis(W, xMarks, "kHz")}
      </svg>
    </div>
  `;
}
