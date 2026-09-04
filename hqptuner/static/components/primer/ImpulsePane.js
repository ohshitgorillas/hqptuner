// The impulse pane: the transient as a ghost trace, the filtered output as the
// accent trace, milliseconds either side of the transient. The frame comes
// from the state, never from the drawing: the axis spans the filter's length
// as the Length control states it, unrounded, so a filter of a given length
// always fills the frame and a drag rescales the axis smoothly instead of
// jumping at each round figure. The tick step rounds; the span does not. Where
// the transient is wider than the filter the frame widens to hold it, the
// input being a reference a reader compares against and a cut reference being
// worse than a wide frame. Time zero is the input's centre after the filter's
// nominal delay (store `output`); linear phase is symmetric about it, minimum
// phase runs the filter to the right of it and holds only the input's own half
// extent to the left. Amplitude is fixed to unit input with headroom, so the
// pane is comparable across states and a real level drop reads as one; a peak
// past the headroom is clipped to the plot rectangle rather than drawn over
// the pane's top band. The output is drawn through `traceColumns`, one rule
// per column and one column per rendered pixel, so the trace resolves to the
// window it is drawn in rather than to the viewBox, and a resize redraws it at
// the new resolution instead of scaling the old points; where the ring at the
// cutoff runs faster than the columns can draw a wave, the output is a band of
// each column's excursion instead (`bandColumns`), the envelope a hash would
// hide; the input is the source's own
// samples, one vertex each, in the dashed muted ghost every other plot uses,
// drawn over the output so the reference stays readable where the two
// coincide. The left gutter carries an amplitude axis whose ticks are fixed to
// unit input rather than to what is drawn, so a peak below one reads as the
// level drop it is instead of filling the frame, and each trace carries its own
// name in the plot's top corner. Where the design is the identity the output is
// the input's own array and one name is drawn, not two on the same pixels.
import { useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { bandColumns, traceColumns } from "../../lib/dsp/render.js";
import { design, lengthMs, output, phase, plotPx, rate, sourcePulse } from "../../store/primergraph.js";
import { HALF_W as W, H, PADR, PADT, PLOT_H, cornerNames, fmt3, niceStep, r1, ticks, xAxis, yAxis } from "./frame.js";
import { useMeasuredPlot } from "./measure.js";

const PADL = 30;
const PLOT_W = W - PADL - PADR;
/**
 * Columns the output is reduced to where the page has measured nothing: one per
 * viewBox unit of plot width. A measured pane uses its pixels instead.
 */
const COLUMNS = PLOT_W;
/** The clip the traces are drawn inside: the plot rectangle, title band excluded. */
const CLIP = "primer-impulse-plot";
/** Unit input reaches this far short of the plot's top and bottom edges. */
const HEADROOM = 1.1;
/** Ticks across the frame, at most; the step rounds up to a round figure. */
const TIME_TICKS = 5;
/**
 * The amplitude ticks, fixed: the scale is unit input in every state, so the
 * figures are the same in every state too and one of them is the input's own
 * peak. A step taken from what is drawn would move the scale under the reader.
 */
const AMP_TICKS = [1, 0.5, 0, -0.5, -1];
/** Trace names sit in the plot's top right corner, one line apart. */
const NAMES = { x: W - PADR - 2, y: PADT + 10, anchor: "end" };
/** A tick label within this many units of a plot edge is anchored to it. */
const EDGE = 1;
/**
 * The share of the filter's length a minimum-phase frame holds before time
 * zero, so the output's onset stands off the left frame edge at every length;
 * the input's own half extent takes over where it is wider.
 */
const LEAD = 0.05;
/**
 * Below this many columns per ring cycle the output is drawn as a band rather
 * than a polyline: a cycle two columns wide draws as a hash, and what the
 * reader needs from it is the ring's envelope. The ring is at the cutoff.
 */
const BAND_COLUMNS = 4;

/**
 * The frame the state asks for: its width in milliseconds and the milliseconds
 * it holds before time zero. The span is the filter's length, taken from the
 * Length control rather than the tap count so that no oversampling, where the
 * design is a single tap, keeps tracking the slider. It widens only where the
 * transient is itself wider, so the input is never cut at a frame edge. Linear
 * phase is symmetric about zero; minimum phase runs the filter to the right of
 * it and holds the larger of the input's half extent and a twentieth of the
 * filter to the left.
 * @param {number} filterMs the filter's length, as the Length control states it
 * @param {number} pulseMs the pulse's half extent
 * @param {boolean} minimum
 * @returns {{ span: number, lead: number }}
 */
function frame(filterMs, pulseMs, minimum) {
  if (minimum) {
    const lead = Math.max(pulseMs, LEAD * filterMs);
    return { span: lead + Math.max(filterMs, pulseMs), lead };
  }
  const half = Math.max(filterMs / 2, pulseMs);
  return { span: 2 * half, lead: half };
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
  const { designRate, taps, cutoffHz } = design.value;
  const { y, zero } = output.value;
  const src = sourcePulse.value;
  const factor = Math.round(designRate / rate.value);
  const msPer = 1000 / designRate;
  const pulseMs = (((src.length - 1) / 2) * 1000) / rate.value;
  const { span, lead } = frame(lengthMs.value, pulseMs, phase.value === "minimum");
  const from = zero - lead / msPer;
  const to = zero + (span - lead) / msPer;
  const xOf = (/** @type {number} */ t) => PADL + ((t - from) / (to - from)) * PLOT_W;
  const yOf = (/** @type {number} */ v) => PADT + PLOT_H / 2 - (v / HEADROOM) * (PLOT_H / 2);
  const point = (/** @type {number} */ t, /** @type {number} */ v) => `${r1(xOf(t))},${r1(yOf(v))}`;
  const centre = (src.length - 1) / 2;
  // The input is the source's own samples, one vertex each: the reference a
  // reader compares the output against, so its drawn peak must not move with
  // the plot's width or with anything the filter does.
  const ghost = Array.from(src, (v, j) => [zero + (j - centre) * factor, v])
    .filter(([t]) => t >= from && t <= to)
    .map(([t, v]) => point(t, v));
  const step = niceStep(span / TIME_TICKS);
  const marks = ticks(Math.ceil(-lead / step) * step, span - lead, step).map((ms) =>
    mark(xOf(zero + ms / msPer), ms, step),
  );
  // No filter: the output is the input's own samples, so it draws as the input
  // does. Reducing it through the columns instead would draw a smooth curve
  // against the input's own straight chords, two pictures of one array.
  // One column per rendered pixel, so the trace resolves to the window it is
  // drawn in and the per-column rule draws the same picture every sample would.
  // A column fixed in viewBox units draws one point list at every width, coarse
  // on a wide window and finer than the screen on a narrow one.
  const columns = plotPx.value || COLUMNS;
  // The output rings at the cutoff. Where a ring cycle spans fewer columns
  // than a line can show a wave in, the output is drawn as a band, the
  // excursion of each column, and the polyline is not drawn at all.
  const columnsPerCycle = (designRate / cutoffHz) * (columns / (to - from));
  const banded = taps > 1 && columnsPerCycle < BAND_COLUMNS;
  const band = banded ? bandColumns(y, from, to, columns) : [];
  const upper = band.map(([t, hi]) => point(t, hi));
  const lower = band.map(([t, , lo]) => point(t, lo)).reverse();
  const out = taps === 1 ? ghost : banded ? null : traceColumns(y, from, to, columns).map(([t, v]) => point(t, v));
  return {
    out: out === null ? null : out.join(" "),
    band: banded && band.length > 0 ? `M${upper.join(" L")} L${lower.join(" L")} Z` : null,
    ghost: ghost.join(" "),
    cx: xOf(zero),
    cy: yOf(0),
    marks,
    yMarks: AMP_TICKS.map((v) => ({ y: yOf(v), label: fmt3(v) })),
    identity: taps === 1,
  };
}

/**
 * The trace names, top down. The output is named in every state; the input only
 * where it is a second curve, since where the design is the identity the two are
 * one array and two names would sit on the same pixels claiming two traces.
 * @param {boolean} identity
 */
const names = (/** @type {boolean} */ identity) =>
  identity
    ? [{ kind: "applied", text: "Output" }]
    : [
        { kind: "applied", text: "Output" },
        { kind: "ghost", text: "Input" },
      ];

/** The impulse pane: the filtered output as the accent trace, the input's dashed ghost over it. */
export function ImpulsePane() {
  const svg = useRef(/** @type {SVGSVGElement | null} */ (null));
  useMeasuredPlot(svg, plotPx, PLOT_W / W);
  const { out, band, ghost, cx, cy, marks, yMarks, identity } = impulse();
  return html`
    <div class="plot" data-pane="impulse">
      <div class="t-label">Impulse</div>
      <svg ref=${svg} viewBox="0 0 ${W} ${H}" class="plot-svg">
        <clipPath id=${CLIP}><rect x=${PADL} y=${PADT} width=${PLOT_W} height=${PLOT_H} /></clipPath>
        <line class="plot-zero" x1=${PADL} y1=${r1(cy)} x2=${W - PADR} y2=${r1(cy)} />
        <line class="plot-zero" x1=${r1(cx)} y1=${PADT} x2=${r1(cx)} y2=${PADT + PLOT_H} />
        ${xAxis(W, marks, "ms")} ${yAxis(PADL, yMarks, "level")}
        <g clip-path=${`url(#${CLIP})`}>
          ${band ? html`<path class="primer-band" d=${band} />` : null}
          ${out === null ? null : html`<polyline class="plot-trace applied" points=${out} />`}
          <polyline class="plot-trace ghost" points=${ghost} />
        </g>
        ${cornerNames(names(identity), NAMES)}
      </svg>
    </div>
  `;
}
