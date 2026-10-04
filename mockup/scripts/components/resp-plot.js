// Response plot for the matrix-family drawers (Crossfeed, Loudness). Same glass and grid grammar as the page's Matrix
// response plot (matrix-plot.js), both drawn by lib/plot-frame.js: log frequency 20 Hz–20 kHz at true decade
// positions, linear dB, labels in a left gutter and a bottom band. Draws 1:1 at its box size, redraws on resize.
//
// Traces are named once, beside their own line (direct labels at the right end, nudged apart when they'd collide):
// no legend line (Volume range bar). Classes: '' = amber (what you get), 'ghost' = ink-3 dashed
// (the reference), 'side' = ink-2. Handles = draggable dots (v1 REW-style), each with onDrag(f, dB) / onEnd(f, dB).

import { s } from "../lib/dom.js";
import { scale } from "../lib/plate.js";
import { paintSvg } from "../lib/gauge.js";
import { mountPlotSvg, plotGrid, plotLabels } from "../lib/plot-frame.js";
import { PAD, round1 as r, levelGrid, plotGeometry, pointAt, tracePath } from "../model/plot-axes.js";

/**
 * @param {HTMLElement} host  .eq box (fills it)
 * @param {{lo:number, hi:number, step:number, minor?:number, fMin?:number, fMax?:number, aria:string}} cfg
 * @returns {{draw(traces:object[], handles?:object[]):void}}
 */
export function mountRespPlot(host, cfg) {
  const fMin = cfg.fMin ?? 20,
    fMax = cfg.fMax ?? 20000;
  const svg = mountPlotSvg(host, cfg.aria, draw);
  let traces = [],
    handles = [],
    geo = null,
    drag = null;

  function draw() {
    const W = host.clientWidth,
      H = host.clientHeight;
    if (!W || !H) return;
    geo = plotGeometry({ W, H, fMin, fMax, lo: cfg.lo, hi: cfg.hi });
    const { y, x1, yb } = geo;
    const grid = levelGrid(cfg, geo.plotH, 12);

    const N = Math.max(160, Math.round(W / 2));
    const paths = traces.map((t) =>
      s("path", {
        class: `trace ${t.cls || ""}`,
        d: tracePath(geo, N, (f) => Math.max(cfg.lo - 2, Math.min(cfg.hi + 2, t.fn(f)))),
      }),
    );

    // Direct labels at the right end, above their line; nudged apart (11px) so none overlap.
    const lab = traces
      .filter((t) => t.label)
      .map((t) => ({ t, yy: y(t.fn(fMax * 0.82)) - 5 }))
      .sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < lab.length; i++) if (lab[i].yy - lab[i - 1].yy < 11) lab[i].yy = lab[i - 1].yy + 11;
    for (const l of lab) l.yy = Math.max(PAD + 9, Math.min(yb - 3, l.yy));

    paintSvg(svg, W, H, [
      plotGrid(geo, grid),
      paths,
      s(
        "g.tl",
        {},
        lab.map((l) =>
          s("text", { class: l.t.cls || "", x: x1 - 2, y: r(l.yy), "text-anchor": "end", text: l.t.label }),
        ),
      ),
      plotLabels(geo, grid),
      handles.map((hd, i) =>
        s("circle", {
          class: `hdl ${drag === i ? "act" : ""} ${hd.off ? "off" : ""}`,
          cx: r(geo.x(hd.f)),
          cy: r(y(Math.max(cfg.lo, Math.min(cfg.hi, hd.db)))),
          r: 6,
          data: { i },
        }),
      ),
    ]);
  }

  // Handle drag: frequency on the log axis (whole Hz), level in 0.1 dB.
  const at = (e) => {
    const b = svg.getBoundingClientRect(),
      k = scale();
    return pointAt(geo, (e.clientX - b.left) / k, (e.clientY - b.top) / k);
  };
  svg.addEventListener("pointerdown", (e) => {
    const c = e.target.closest(".hdl");
    if (!c || c.classList.contains("off")) return;
    drag = Number(c.dataset.i);
    svg.setPointerCapture(e.pointerId);
    draw();
  });
  svg.addEventListener("pointermove", (e) => {
    if (drag !== null) handles[drag].onDrag(...at(e));
  });
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
