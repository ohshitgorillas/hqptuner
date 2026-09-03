// The impulse pane: the transient as a ghost trace, the filtered output as the
// accent trace, milliseconds either side of the transient. The frame comes
// from the state, never from the drawing: the filter's reach in milliseconds
// from its tap count and design rate, plus the pulse's half extent, rounded up
// to a round figure. A frame taken from the output's own energy is
// scale-invariant, so every filter length draws the same picture and every
// slider drag rescales the axis under the reader's hand. Time zero is the
// input's centre after the filter's nominal delay (store `output`); linear
// phase is symmetric about it, minimum phase puts the whole reach to the right
// and keeps a tenth of the span to the left so the input is never a sliver
// against the frame edge. Amplitude is fixed to unit input with headroom, so
// the pane is comparable across states and a real level drop reads as one. The
// output is drawn through `traceColumns`, one rule per column, never one
// vertex per sample; the input is a wide muted halo under it with a dot per
// source sample, so the reference stays visible where the two coincide. No y
// labels, so the left gutter is a margin and nothing more.
import { html } from "../../lib/dom.js";
import { traceColumns } from "../../lib/dsp/render.js";
import { design, output, phase, rate, sourcePulse } from "../../store/primergraph.js";
import { HALF_W as W, H, PADR, PADT, PLOT_H, fmt3, niceStep, r1, ticks, xAxis } from "./frame.js";

const PADL = 10;
const PLOT_W = W - PADL - PADR;
/** Columns the output is reduced to: one per viewBox unit of plot width. */
const COLUMNS = PLOT_W;
/** Minimum phase keeps this fraction of the span to the left of time zero. */
const LEAD = 0.1;
/** Unit input reaches this far short of the plot's top and bottom edges. */
const HEADROOM = 1.1;
/** Ticks across the frame, at most; the step rounds up to a round figure. */
const TIME_TICKS = 5;
/** A tick label within this many units of a plot edge is anchored to it. */
const EDGE = 1;

/**
 * The frame the state asks for: its width in milliseconds and the milliseconds
 * it holds before time zero. Linear phase is symmetric about zero; minimum
 * phase runs the filter's whole reach to the right of it and keeps `LEAD` of
 * the span to the left, widened if the pulse itself needs more. No filter is
 * symmetric whatever the phase, the conversion being the identity.
 * @param {number} reachMs the filter's whole reach, tap to tap
 * @param {number} pulseMs the pulse's half extent
 * @param {boolean} minimum
 * @returns {{ span: number, lead: number }}
 */
function frame(reachMs, pulseMs, minimum) {
  if (minimum && reachMs > 0) {
    const span = niceStep(Math.max(reachMs / (1 - LEAD), pulseMs / LEAD));
    return { span, lead: LEAD * span };
  }
  const span = niceStep(2 * (reachMs / 2 + pulseMs));
  return { span, lead: span / 2 };
}

/**
 * The x-axis mark for one tick value: its position, its label, and the anchor
 * that keeps it inside the plot at the frame's ends rather than dropping it.
 * @param {number} x
 * @param {number} ms
 * @param {number} step
 * @returns {{ x: number, label: string, anchor: string }}
 */
function mark(x, ms, step) {
  const anchor = x <= PADL + EDGE ? "start" : x >= W - PADR - EDGE ? "end" : "middle";
  return { x, label: Math.abs(ms) < step / 2 ? "0" : fmt3(ms), anchor };
}

/**
 * The pane's traces: output and pulse in viewBox coordinates, time zero at
 * the input's centre, amplitude shared between the two.
 */
function impulse() {
  const { designRate, taps } = design.value;
  const { y, zero } = output.value;
  const src = sourcePulse.value;
  const factor = Math.round(designRate / rate.value);
  const msPer = 1000 / designRate;
  const reachMs = ((taps - 1) / designRate) * 1000;
  const pulseMs = (((src.length - 1) / 2) * 1000) / rate.value;
  const { span, lead } = frame(reachMs, pulseMs, phase.value === "minimum");
  const from = zero - lead / msPer;
  const to = zero + (span - lead) / msPer;
  const xOf = (/** @type {number} */ t) => PADL + ((t - from) / (to - from)) * PLOT_W;
  const yOf = (/** @type {number} */ v) => PADT + PLOT_H / 2 - (v / HEADROOM) * (PLOT_H / 2);
  const point = (/** @type {number} */ t, /** @type {number} */ v) => `${r1(xOf(t))},${r1(yOf(v))}`;
  const centre = (src.length - 1) / 2;
  const samples = Array.from(src, (v, j) => [zero + (j - centre) * factor, v]).filter(
    ([t]) => t >= from && t <= to,
  );
  const ghost = samples.map(([t, v]) => point(t, v));
  const dots = samples.map(([t, v]) => ({ cx: r1(xOf(t)), cy: r1(yOf(v)) }));
  const step = niceStep(span / TIME_TICKS);
  const marks = ticks(Math.ceil(-lead / step) * step, span - lead, step).map((ms) =>
    mark(xOf(zero + ms / msPer), ms, step),
  );
  // No filter: the output is the input's own samples, so it draws as the input
  // does. Reducing it through the columns instead would draw a smooth curve
  // against the input's own straight chords, two pictures of one array.
  const out = taps === 1 ? ghost : traceColumns(y, from, to, COLUMNS).map(([t, v]) => point(t, v));
  return {
    out: out.join(" "),
    ghost: ghost.join(" "),
    dots,
    cx: xOf(zero),
    cy: yOf(0),
    marks,
  };
}

/** The impulse pane: input halo, filtered output accent over it, source samples as dots. */
export function ImpulsePane() {
  const { out, ghost, dots, cx, cy, marks } = impulse();
  return html`
    <div class="plot" data-pane="impulse">
      <div class="t-label">Impulse</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        <line class="plot-zero" x1=${PADL} y1=${r1(cy)} x2=${W - PADR} y2=${r1(cy)} />
        <line class="plot-zero" x1=${r1(cx)} y1=${PADT} x2=${r1(cx)} y2=${PADT + PLOT_H} />
        ${xAxis(W, marks, "ms")}
        <polyline class="plot-trace ghost halo" points=${ghost} />
        <polyline class="plot-trace applied" points=${out} />
        ${dots.map(({ cx: dx, cy: dy }) => html`<circle class="primer-sample" cx=${dx} cy=${dy} r="1.6" />`)}
      </svg>
    </div>
  `;
}
