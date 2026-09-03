// The impulse pane: the transient as a ghost trace, the filtered output as the
// accent trace, the transient centred, milliseconds either side. The axis span
// follows the filter length so a short filter fills the frame as well as a
// long one. No y labels, so the left gutter is a margin and nothing more.
import { html } from "../../lib/dom.js";
import { filterPulse } from "../../lib/dsp/fir.js";
import { design, pulse } from "../../store/primergraph.js";
import { HALF_W as W, H, PADR, PADT, PLOT_H, fmt3, niceStep, r1, ticks, xAxis } from "./frame.js";

const PADL = 10;
const PLOT_W = W - PADL - PADR;
// The axis reaches a little past the filter's own half length.
const SPAN_MARGIN = 1.1;
// Ticks per side of the transient, at most; the step rounds up to a round
// figure so the labels never crowd.
const TIME_TICKS = 4;

/**
 * The pane's traces: output and pulse, in milliseconds from the pulse centre
 * and normalised to the pulse peak.
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
  const marks = ticks(0, span, step).flatMap((ms) =>
    ms === 0
      ? [{ x: xOf(0), label: "0" }]
      : [
          { x: xOf(-ms), label: `-${fmt3(ms)}` },
          { x: xOf(ms), label: fmt3(ms) },
        ],
  );
  return { out: trace(y, centre), ghost: trace(p, (p.length - 1) / 2), cx: xOf(0), cy: yOf(0), marks };
}

/** The impulse pane: transient ghost, filtered output accent, milliseconds either side. */
export function ImpulsePane() {
  const { out, ghost, cx, cy, marks } = impulse();
  return html`
    <div class="plot" data-pane="impulse">
      <div class="t-label">Impulse</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        <line class="plot-zero" x1=${PADL} y1=${r1(cy)} x2=${W - PADR} y2=${r1(cy)} />
        <line class="plot-zero" x1=${r1(cx)} y1=${PADT} x2=${r1(cx)} y2=${PADT + PLOT_H} />
        ${xAxis(W, marks, "ms")}
        <polyline class="plot-trace ghost" points=${ghost} />
        <polyline class="plot-trace applied" points=${out} />
      </svg>
    </div>
  `;
}
