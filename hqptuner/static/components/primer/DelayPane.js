// The delay pane: group delay against frequency, 0 to the Nyquist of the
// slower of the two streams, in milliseconds. Both phases are drawn at once,
// the selected one as the accent trace and the other as the ghost, so the
// comparison needs no toggling: linear phase is flat at half the filter length,
// minimum phase near zero low and climbing toward the cliff. The stop band is
// blanked by the store, and the pen lifts across it.
import { html } from "../../lib/dom.js";
import { clamp } from "../../lib/coerce.js";
import { delay, lengthMs, noFilter, phase } from "../../store/primergraph.js";
import {
  HALF_W as W,
  H,
  PADR,
  PADT,
  PLOT_H,
  cornerNames,
  fmt3,
  fmtKhz,
  niceStep,
  r1,
  ticks,
  xAxis,
  yAxis,
} from "./frame.js";

const PADL = 30;
const PLOT_W = W - PADL - PADR;
const FREQ_TICKS = 8;
const MS_TICKS = 4;
// The axis top sits a little above half the filter length, which is where a
// linear-phase filter arrives, and never below this many milliseconds, so a
// unit tap still draws on a readable scale. The span is not rounded: the tick
// step rounds, as in the impulse pane, so the flat linear trace holds one
// height while the Length control moves and the ticks slide under it.
const HEADROOM = 1.1;
const MIN_TOP_MS = 0.1;
/** Both phases are drawn at once, so both are named; the stack sits in the plot's top right corner. */
const NAMES = { x: W - PADR - 2, y: PADT + 10, anchor: "end" };
const LINEAR = { trace: "linear", text: "Linear phase" };
const MINIMUM = { trace: "minimum", text: "Minimum phase" };

/**
 * The trace names, accent first: the selected phase is the accent trace and the
 * other its ghost, so the pair of names carries the same reading as the pair of
 * curves and a reader can tell which is which without toggling.
 * @param {boolean} minimumSelected
 */
const names = (minimumSelected) => [
  { kind: "applied", ...(minimumSelected ? MINIMUM : LINEAR) },
  { kind: "ghost", ...(minimumSelected ? LINEAR : MINIMUM) },
];

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

/** The pane's curves on its grid, with the tick marks of both axes. */
function curves() {
  const { freqsHz, linearMs, minimumMs } = delay.value;
  // The store's grid ends at the axis top, so the pane takes its scale from the
  // grid rather than recomputing it: one rule, in one place, for both.
  const nyquist = freqsHz[freqsHz.length - 1];
  // The scale comes from the Length control, not from the drawn peak: a
  // stop-band null spike would set it otherwise (math.md 3.5), and a peak
  // rounded to a tick multiple steps the top through a handful of values over
  // one drag, snapping the flat trace to a new height at each.
  const top = Math.max(lengthMs.value / 2, MIN_TOP_MS) * HEADROOM;
  const step = niceStep(top / MS_TICKS);
  const xOf = (/** @type {number} */ f) => PADL + (f / nyquist) * PLOT_W;
  // A stop-band null is a spike, not an arrival time (math.md 3.5), and the
  // mask lets the shallower ones through, so the value is held to the drawn
  // range before it becomes a coordinate: a spike pins to a frame edge instead
  // of running out of the pane. NaN passes through, so the pen still lifts.
  const yOf = (/** @type {number} */ ms) => PADT + PLOT_H - (clamp(ms, 0, top) / top) * PLOT_H;
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

/**
 * The delay pane: both phases' group delay, the selected one as the accent
 * trace. Where the chain is the identity the unit tap has no phase to choose,
 * both curves are the same flat line on 0 ms, and two traces named for two
 * phases would claim a comparison that does not exist: one trace, no names.
 */
export function DelayPane() {
  const { linear, minimum, xMarks, yMarks } = curves();
  const minimumSelected = phase.value === "minimum";
  const identity = noFilter.value;
  return html`
    <div class="plot" data-pane="delay">
      <div class="t-label">Delay</div>
      <svg viewBox="0 0 ${W} ${H}" class="plot-svg">
        ${yMarks.map((m) => html`<line class="plot-grid" x1=${PADL} y1=${r1(m.y)} x2=${W - PADR} y2=${r1(m.y)} />`)}
        ${yAxis(PADL, yMarks, "ms")}
        ${xAxis(W, xMarks, "kHz")}
        ${identity ? null : html`<path class="plot-trace ghost" d=${minimumSelected ? linear : minimum} />`}
        <path class="plot-trace applied" d=${minimumSelected ? minimum : linear} />
        ${identity ? null : cornerNames(names(minimumSelected), NAMES)}
      </svg>
    </div>
  `;
}
