// Source meter spectrum: the trace, its fill and held peaks over a dB grid on a linear 0 to Nyquist axis, with a
// hover / touch readout of frequency and level under the pointer.

import { h, s } from "../../../lib/shell/dom.js";
import { emptySpectrum, stepSpectrum } from "../../../model/gauges/meter.js";
import { freqTicks, freqX, spectrumAxes, spectrumPoints } from "../../../model/gauges/meter-plot.js";
import { binLevels } from "../../../model/gauges/meter-source.js";
import { minusText } from "../../../../../hqptuner/static/model/shell/format.js";
import { edgeLabels, freqLabels } from "./axes.js";

const BINS = 300; // spectrum points, 0..Nyquist
const SW = 600,
  SH = 170; // spectrum viewBox

/**
 * @typedef {import('../../../model/gauges/meter.js').SpectrumHold} SpectrumHold
 * @typedef {import('../../../model/gauges/meter-plot.js').SpectrumPlot} SpectrumPlot
 * @typedef {import('../../../model/gauges/meter-source.js').MockSource} MockSource
 * @typedef {import('../../../model/gauges/meter-source.js').MockColumn} MockColumn
 */

/**
 * The spectrum block's elements.
 *
 * @typedef {object} SpectrumBlock
 * @property {HTMLElement} el
 * @property {SVGElement} svg
 * @property {SVGElement} grid
 * @property {SVGElement} area
 * @property {SVGElement} trace
 * @property {SVGElement} hold
 * @property {SVGElement} cross     the pointer's crosshair
 * @property {HTMLElement} readout  frequency and level under the pointer
 * @property {HTMLElement} sY       dB axis
 * @property {HTMLElement} sX       frequency axis
 */

/**
 * The spectrum block: head with its title and `rangeCtl` (false on the page), the plot and its two axes.
 *
 * @param {HTMLElement | false} rangeCtl
 * @returns {SpectrumBlock}
 */
export function spectrumView(rangeCtl) {
  const grid = s("g.sgridl");
  const area = s("path.sarea");
  const trace = s("path.strace");
  const hold = s("path.shold");
  const cross = s("line.scross", { y1: 0, y2: SH, visibility: "hidden" });
  const svg = s(
    "svg.spectrum",
    { viewBox: `0 0 ${SW} ${SH}`, preserveAspectRatio: "none", role: "img", "aria-label": "Spectrum" },
    grid,
    area,
    hold,
    trace,
    cross,
  );
  const readout = h("div.sread", { hidden: true });
  const plot = h("div.splot", {}, svg, readout);
  const sY = h("div.gut.gy", { "aria-hidden": "true" });
  const sX = h("div.xaxis", { "aria-hidden": "true" });
  const el = h(
    "div.sside",
    {},
    h("div.mhead", {}, h("b.mt", { text: "Spectrum" }), h("span.grow"), rangeCtl),
    h("div.sgrid1", {}, sY, plot, h("span"), sX),
  );
  return { el, svg, grid, area, trace, hold, cross, readout, sY, sX };
}

/**
 * The trace, fill and held peaks of `sp`.
 *
 * @param {SpectrumBlock} view
 * @param {SpectrumHold} sp
 * @param {number[]} binHz
 * @param {SpectrumPlot} plot
 */
function paintSpectrum(view, sp, binHz, plot) {
  /** @param {ArrayLike<number>} arr  dBFS per bin */
  const pts = (arr) =>
    spectrumPoints(arr, binHz, plot)
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" L");
  const line = "M" + pts(sp.disp);
  view.trace.setAttribute("d", line);
  view.area.setAttribute("d", `${line} L${SW},${SH} L0,${SH} Z`);
  view.hold.setAttribute("d", "M" + pts(sp.peak));
}

/**
 * The dB and frequency grid lines and both axes' labels.
 *
 * @param {SpectrumBlock} view
 * @param {SpectrumPlot} plot
 */
function paintSpectrumAxes(view, plot) {
  const ax = spectrumAxes(plot);
  view.grid.replaceChildren(
    ...ax.db.slice(1, -1).map((t) => s("line", { x1: 0, x2: SW, y1: t.y, y2: t.y })),
    ...ax.hz.slice(1).map((t) => s("line", { x1: t.x, x2: t.x, y1: 0, y2: SH })),
  );
  edgeLabels(
    view.sY,
    "top",
    ax.db.map((t) => ({ at: t.y / SH, text: t.db === 0 ? "0 dBFS" : minusText(t.db) })),
  );
  view.sX.replaceChildren(
    ...freqLabels(
      freqTicks(plot.nyq, (f) => freqX(f, plot) / SW),
      "x",
    ),
  );
}

/**
 * Hover / touch readout: frequency and level under the pointer.
 *
 * @param {SpectrumBlock} view
 * @param {number[]} binHz
 * @param {() => SpectrumHold} current
 */
function wireReadout(view, binHz, current) {
  const { svg, cross, readout } = view;
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const i = Math.round(fx * (BINS - 1));
    cross.setAttribute("x1", String(fx * SW));
    cross.setAttribute("x2", String(fx * SW));
    cross.setAttribute("visibility", "visible");
    readout.hidden = false;
    readout.textContent = `${(binHz[i] / 1000).toFixed(2)} kHz · ${minusText(current().disp[i].toFixed(1))} dBFS`;
  });
  svg.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    readout.hidden = true;
  });
}

/**
 * The spectrum's painter over `view`: `frame` steps the hold to the latest column's levels and paints, `paint`
 * repaints, `axes` repaints the grid and labels, `reset` drops the hold and lands on the latest column at once.
 *
 * @param {SpectrumBlock} view
 * @param {import('../source-meter.js').MeterState} st  view state, read at each paint
 * @param {number} nyq                                   Hz
 * @param {{ source: MockSource, latest: () => MockColumn }} feed  the source and its latest column
 */
export function spectrumPainter(view, st, nyq, feed) {
  const { source, latest } = feed;
  const binHz = Array.from({ length: BINS }, (_, i) => Math.max(10, (nyq * i) / (BINS - 1)));
  let sp = emptySpectrum(BINS);
  /** @returns {SpectrumPlot} */
  const plot = () => ({ nyq, range: st.range, w: SW, h: SH });
  const paint = () => paintSpectrum(view, sp, binHz, plot());
  /**
   * @param {number} now      ms
   * @param {boolean} [jump]  land on the levels at once
   */
  function frame(now, jump = false) {
    sp = stepSpectrum(sp, binLevels(latest(), binHz, st.channel, source), now, jump);
    paint();
  }
  wireReadout(view, binHz, () => sp);
  return {
    frame,
    paint,
    axes: () => paintSpectrumAxes(view, plot()),
    reset: () => {
      sp = emptySpectrum(BINS);
      frame(0, true);
    },
  };
}
