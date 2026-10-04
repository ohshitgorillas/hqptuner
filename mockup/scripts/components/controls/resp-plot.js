// Response plot for the matrix-family drawers (Crossfeed, Loudness). Same glass and grid grammar as the page's Matrix
// response plot (matrix-plot.js), both drawn by lib/plot-frame.js: log frequency 20 Hz–20 kHz at true decade
// positions, linear dB, labels in a left gutter and a bottom band. Draws 1:1 at its box size, redraws on resize.
//
// Traces are named once, beside their own line (direct labels at the right end, nudged apart when they'd collide):
// no legend line (Volume range bar). Classes: '' = amber (what you get), 'ghost' = ink-3 dashed
// (the reference), 'side' = ink-2. Handles = draggable dots (v1 REW-style), each with onDrag(f, dB) / onEnd(f, dB).

import { s } from "../../lib/shell/dom.js";
import { scale } from "../../lib/shell/plate.js";
import { paintSvg } from "../../lib/plots/gauge.js";
import { mountPlotSvg, plotGrid, plotLabels } from "../../lib/plots/plot-frame.js";
import { PAD, round1 as r, levelGrid, plotGeometry, pointAt, tracePath } from "../../model/gauges/plot-axes.js";

/** @typedef {import('../../model/gauges/plot-axes.js').PlotGeometry} PlotGeometry */
/** @typedef {{lo: number, hi: number, step: number, minor?: number, fMin?: number, fMax?: number, aria: string}} PlotCfg */
/** @typedef {{fn: (f: number) => number, cls?: string, label?: string}} Trace  one line: dB at f */
/**
 * @typedef {object} Handle  one draggable dot
 * @property {number} f
 * @property {number} db
 * @property {boolean} [off]  shown, not draggable
 * @property {(f: number, db: number) => void} onDrag
 * @property {(f: number, db: number) => void} [onEnd]
 */

/**
 * Mount the plot in `host`; draw() paints the traces and handles given, and every resize repaints the last ones.
 *
 * @param {HTMLElement} host  .eq box (fills it)
 * @param {PlotCfg} cfg
 * @returns {{draw(traces: Trace[], handles?: Handle[]): void}}
 */
export function mountRespPlot(host, cfg) {
  const fMin = cfg.fMin ?? 20,
    fMax = cfg.fMax ?? 20000;
  const svg = mountPlotSvg(host, cfg.aria, draw);
  /** @type {Trace[]} */
  let traces = [];
  /** @type {Handle[]} */
  let handles = [];
  /** @type {PlotGeometry | null} */
  let geo = null;
  /** @type {number | null} */
  let drag = null;

  function draw() {
    const W = host.clientWidth,
      H = host.clientHeight;
    if (!W || !H) return;
    geo = plotGeometry({ W, H, fMin, fMax, lo: cfg.lo, hi: cfg.hi });
    const grid = levelGrid(cfg, geo.plotH, 12);
    paintSvg(svg, W, H, [
      plotGrid(geo, grid),
      tracePaths(geo, cfg, traces),
      traceLabels(geo, traces, fMax),
      plotLabels(geo, grid),
      handleDots(geo, cfg, handles, drag),
    ]);
  }

  // Handle drag: frequency on the log axis (whole Hz), level in 0.1 dB.
  /** @param {PointerEvent} e */
  const at = (e) => {
    const b = svg.getBoundingClientRect(),
      k = scale();
    // A handle is only there to drag once a draw has measured the plot.
    return pointAt(/** @type {PlotGeometry} */ (geo), (e.clientX - b.left) / k, (e.clientY - b.top) / k);
  };
  svg.addEventListener("pointerdown", (e) => {
    const c = /** @type {SVGElement | null} */ (/** @type {Element} */ (e.target).closest(".hdl"));
    if (!c || c.classList.contains("off")) return;
    drag = Number(c.dataset.i);
    svg.setPointerCapture(e.pointerId);
    draw();
  });
  svg.addEventListener("pointermove", (e) => {
    if (drag !== null) handles[drag].onDrag(...at(e));
  });
  /** @param {PointerEvent} e */
  const end = (e) => {
    if (drag === null) return;
    const hd = handles[drag];
    drag = null;
    hd.onEnd?.(...at(e));
    draw();
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  return {
    draw(t, hds = []) {
      traces = t;
      handles = hds;
      draw();
    },
  };
}

/**
 * Each trace's line, its level held just outside the scale.
 *
 * @param {PlotGeometry} geo
 * @param {PlotCfg} cfg
 * @param {Trace[]} traces
 * @returns {SVGElement[]}
 */
function tracePaths(geo, cfg, traces) {
  const N = Math.max(160, Math.round(geo.W / 2));
  return traces.map((t) =>
    s("path", {
      class: `trace ${t.cls || ""}`,
      d: tracePath(geo, N, (f) => Math.max(cfg.lo - 2, Math.min(cfg.hi + 2, t.fn(f)))),
    }),
  );
}

/**
 * Direct labels at the right end, above their line; nudged apart (11px) so none overlap.
 *
 * @param {PlotGeometry} geo
 * @param {Trace[]} traces
 * @param {number} fMax
 * @returns {SVGElement}
 */
function traceLabels(geo, traces, fMax) {
  const { y, x1, yb } = geo;
  const lab = traces
    .filter((t) => t.label)
    .map((t) => ({ t, yy: y(t.fn(fMax * 0.82)) - 5 }))
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < lab.length; i++) if (lab[i].yy - lab[i - 1].yy < 11) lab[i].yy = lab[i - 1].yy + 11;
  for (const l of lab) l.yy = Math.max(PAD + 9, Math.min(yb - 3, l.yy));
  return s(
    "g.tl",
    {},
    lab.map((l) => s("text", { class: l.t.cls || "", x: x1 - 2, y: r(l.yy), "text-anchor": "end", text: l.t.label })),
  );
}

/**
 * The handles' dots, each held inside the scale; the one being dragged reads active.
 *
 * @param {PlotGeometry} geo
 * @param {PlotCfg} cfg
 * @param {Handle[]} handles
 * @param {number | null} drag  the dragged handle's position
 * @returns {SVGElement[]}
 */
function handleDots(geo, cfg, handles, drag) {
  return handles.map((hd, i) =>
    s("circle", {
      class: `hdl ${drag === i ? "act" : ""} ${hd.off ? "off" : ""}`,
      cx: r(geo.x(hd.f)),
      cy: r(geo.y(Math.max(cfg.lo, Math.min(cfg.hi, hd.db)))),
      r: 6,
      data: { i },
    }),
  );
}
