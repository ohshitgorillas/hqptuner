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
// the new resolution instead of scaling the old points; the input is the source's own
// samples, one vertex each, in the dashed muted ghost every other plot uses,
// drawn over the output so the reference stays readable where the two
// coincide. The left gutter carries an amplitude axis whose ticks are fixed to
// unit input rather than to what is drawn, so a peak below one reads as the
// level drop it is instead of filling the frame, and each trace carries its own
// name in the plot's top corner. Where the design is the identity the output is
// the input's own array and one name is drawn, not two on the same pixels.
import { useEffect, useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { traceColumns } from "../../lib/dsp/render.js";
import { design, lengthMs, output, phase, plotPx, rate, sourcePulse } from "../../store/primergraph.js";
import { HALF_W as W, H, PADR, PADT, PLOT_H, fmt3, niceStep, r1, ticks, xAxis, yAxis } from "./frame.js";

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
const NAME_X = W - PADR - 2;
const NAME_Y = PADT + 10;
const NAME_GAP = 11;
/** A tick label within this many units of a plot edge is anchored to it. */
const EDGE = 1;

/**
 * The frame the state asks for: its width in milliseconds and the milliseconds
 * it holds before time zero. The span is the filter's length, taken from the
 * Length control rather than the tap count so that no oversampling, where the
 * design is a single tap, keeps tracking the slider. It widens only where the
 * transient is itself wider, so the input is never cut at a frame edge. Linear
 * phase is symmetric about zero; minimum phase runs the filter to the right of
 * it and holds the input's half extent to the left.
 * @param {number} filterMs the filter's length, as the Length control states it
 * @param {number} pulseMs the pulse's half extent
 * @param {boolean} minimum
 * @returns {{ span: number, lead: number }}
 */
function frame(filterMs, pulseMs, minimum) {
  if (minimum) return { span: pulseMs + Math.max(filterMs, pulseMs), lead: pulseMs };
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
  const { designRate, taps } = design.value;
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
  const out = taps === 1 ? ghost : traceColumns(y, from, to, columns).map(([t, v]) => point(t, v));
  return {
    out: out.join(" "),
    ghost: ghost.join(" "),
    cx: xOf(zero),
    cy: yOf(0),
    marks,
    yMarks: AMP_TICKS.map((v) => ({ y: yOf(v), label: fmt3(v) })),
    identity: taps === 1,
  };
}

/**
 * Report the plot rectangle's rendered width, in CSS pixels, for as long as the
 * pane is mounted, and again whenever the layout moves it. The SVG scales its
 * viewBox to whatever width the card gives it, so the drawing's own units say
 * nothing about how many pixels the trace has to live in; only the laid out
 * element does. A render with no layout behind it leaves the figure at zero and
 * the pane falls back to its viewBox width.
 * @param {{ current: SVGSVGElement | null }} ref
 * @returns {void}
 */
function useMeasuredPlot(ref) {
  useEffect(() => {
    const svg = ref.current;
    if (!svg || typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0];
      if (!box) return;
      plotPx.value = Math.round(box.contentRect.width * (PLOT_W / W));
    });
    ro.observe(svg);
    return () => {
      ro.disconnect();
      plotPx.value = 0;
    };
  }, [ref]);
}

/**
 * The trace names, top down. The output is named in every state; the input only
 * where it is a second curve, since where the design is the identity the two are
 * one array and two names would sit on the same pixels claiming two traces.
 * @param {boolean} identity
 */
function names(identity) {
  const named = identity
    ? [{ kind: "applied", text: "Output" }]
    : [
        { kind: "applied", text: "Output" },
        { kind: "ghost", text: "Input" },
      ];
  return named.map((n, i) => ({ ...n, y: NAME_Y + i * NAME_GAP }));
}

/** The impulse pane: the filtered output as the accent trace, the input's dashed ghost over it. */
export function ImpulsePane() {
  const svg = useRef(/** @type {SVGSVGElement | null} */ (null));
  useMeasuredPlot(svg);
  const { out, ghost, cx, cy, marks, yMarks, identity } = impulse();
  return html`
    <div class="plot" data-pane="impulse">
      <div class="t-label">Impulse</div>
      <svg ref=${svg} viewBox="0 0 ${W} ${H}" class="plot-svg">
        <clipPath id=${CLIP}><rect x=${PADL} y=${PADT} width=${PLOT_W} height=${PLOT_H} /></clipPath>
        <line class="plot-zero" x1=${PADL} y1=${r1(cy)} x2=${W - PADR} y2=${r1(cy)} />
        <line class="plot-zero" x1=${r1(cx)} y1=${PADT} x2=${r1(cx)} y2=${PADT + PLOT_H} />
        ${xAxis(W, marks, "ms")} ${yAxis(PADL, yMarks, "level")}
        <g clip-path=${`url(#${CLIP})`}>
          <polyline class="plot-trace applied" points=${out} />
          <polyline class="plot-trace ghost" points=${ghost} />
        </g>
        ${names(identity).map(
          (n) => html`<text class="plot-tlbl ${n.kind}" x=${NAME_X} y=${n.y} text-anchor="end">${n.text}</text>`,
        )}
      </svg>
    </div>
  `;
}
