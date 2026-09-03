// The impulse pane: the transient as a ghost trace, the filtered output as the
// accent trace, milliseconds either side of the transient. The frame follows
// the output's own energy: it spans the samples above one percent of the
// output's peak plus a small margin on each side, so a short filter fills the
// frame as well as a long one and a minimum-phase tail sits inside it. Time
// zero is the input's centre after the filter's nominal delay (store
// `output`), so a linear-phase output sits on the input and a minimum-phase
// one starts with it. The output is drawn through `traceColumns`, one rule per
// column, never one vertex per sample; the ghost is the source's own samples
// joined, drawn last so it stays visible where the two coincide. No y labels,
// so the left gutter is a margin and nothing more.
import { html } from "../../lib/dom.js";
import { traceColumns } from "../../lib/dsp/render.js";
import { design, output, rate, sourcePulse } from "../../store/primergraph.js";
import { HALF_W as W, H, PADR, PADT, PLOT_H, fmt3, niceStep, r1, ticks, xAxis } from "./frame.js";

const PADL = 10;
const PLOT_W = W - PADL - PADR;
/** Columns the output is reduced to: one per viewBox unit of plot width. */
const COLUMNS = PLOT_W;
/** The frame spans the output's samples above this fraction of its peak. */
const EXTENT = 0.01;
/** Margin past that span on each side, as a fraction of the span. */
const MARGIN = 0.05;
/** The frame never narrows below this many source samples either side of time zero. */
const MIN_HALF_SOURCE = 4;
/** The larger of unit amplitude and the output's peak sits this far below the plot top. */
const HEADROOM = 1.1;
/** Ticks across the frame, at most; the step rounds up to a round figure. */
const TIME_TICKS = 5;
/** A tick label this close to a plot edge is dropped rather than cut off. */
const EDGE = 8;

/**
 * The index window the frame shows: the output's samples above the extent
 * threshold, widened to the minimum half width and then by the margin.
 * @param {Float64Array} y
 * @param {number} zero
 * @param {number} minHalf
 * @returns {{ from: number, to: number, peak: number }}
 */
function window(y, zero, minHalf) {
  let peak = 0;
  for (let i = 0; i < y.length; i += 1) peak = Math.max(peak, Math.abs(y[i]));
  const thr = EXTENT * peak;
  let lo = 0;
  while (lo < y.length - 1 && Math.abs(y[lo]) <= thr) lo += 1;
  let hi = y.length - 1;
  while (hi > 0 && Math.abs(y[hi]) <= thr) hi -= 1;
  lo = Math.min(lo, zero - minHalf);
  hi = Math.max(hi, zero + minHalf);
  const m = MARGIN * (hi - lo);
  return { from: lo - m, to: hi + m, peak };
}

/**
 * The pane's traces: output and pulse in viewBox coordinates, time zero at
 * the input's centre, amplitude shared between the two.
 */
function impulse() {
  const { designRate } = design.value;
  const { y, zero } = output.value;
  const factor = Math.round(designRate / rate.value);
  const { from, to, peak } = window(y, zero, MIN_HALF_SOURCE * factor);
  const msPer = 1000 / designRate;
  const scale = Math.max(1, peak) * HEADROOM;
  const xOf = (/** @type {number} */ t) => PADL + ((t - from) / (to - from)) * PLOT_W;
  const yOf = (/** @type {number} */ v) => PADT + PLOT_H / 2 - (v / scale) * (PLOT_H / 2);
  const point = (/** @type {number} */ t, /** @type {number} */ v) => `${r1(xOf(t))},${r1(yOf(v))}`;
  const src = sourcePulse.value;
  const centre = (src.length - 1) / 2;
  const ghost = Array.from(src, (v, j) => [zero + (j - centre) * factor, v])
    .filter(([t]) => t >= from && t <= to)
    .map(([t, v]) => point(t, v));
  const leftMs = (from - zero) * msPer;
  const rightMs = (to - zero) * msPer;
  const step = niceStep((rightMs - leftMs) / TIME_TICKS);
  const marks = ticks(Math.ceil(leftMs / step) * step, rightMs, step)
    .map((ms) => ({ x: xOf(zero + ms / msPer), label: Math.abs(ms) < step / 2 ? "0" : fmt3(ms) }))
    .filter(({ x }) => x >= PADL + EDGE && x <= W - PADR - EDGE);
  return {
    out: traceColumns(y, from, to, COLUMNS)
      .map(([t, v]) => point(t, v))
      .join(" "),
    ghost: ghost.join(" "),
    cx: xOf(zero),
    cy: yOf(0),
    marks,
  };
}

/** The impulse pane: filtered output accent, transient ghost over it, milliseconds either side. */
export function ImpulsePane() {
  const { out, ghost, cx, cy, marks } = impulse();
  return html`
    <div class="plot" data-pane="impulse">
      <div class="t-label">Impulse</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        <line class="plot-zero" x1=${PADL} y1=${r1(cy)} x2=${W - PADR} y2=${r1(cy)} />
        <line class="plot-zero" x1=${r1(cx)} y1=${PADT} x2=${r1(cx)} y2=${PADT + PLOT_H} />
        ${xAxis(W, marks, "ms")}
        <polyline class="plot-trace applied" points=${out} />
        <polyline class="plot-trace ghost" points=${ghost} />
      </svg>
    </div>
  `;
}
