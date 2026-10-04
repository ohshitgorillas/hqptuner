// Matrix response plot. Redraws 1:1 at whatever size its box is (the Matrix engine section absorbs the
// page's spare height, so the size depends on which stages are engaged). Log frequency, linear dB.
// Layout: dB labels in a left gutter, frequency labels in a bottom band, both clear of the trace (lib/plot-frame.js).

import { s } from "../../lib/shell/dom.js";
import { paintSvg } from "../../lib/plots/gauge.js";
import { mountPlotSvg, plotGrid, plotLabels } from "../../lib/plots/plot-frame.js";
import { centredLevelY, levelGrid, plotGeometry, tracePath } from "../../model/gauges/plot-axes.js";

/** @typedef {{ from: number, dbPerOct: number }} Slope  a slope in dB per octave above `from` Hz */

/**
 * The plot's data (data/matrix.js MATRIX_PLOT): ± dB shown, the frequency span, the peaking bands [centre Hz, gain dB,
 * width in octaves], the soft tilt and the top drop; `flat` draws a profile that changes nothing.
 *
 * @typedef {object} MatrixPlot
 * @property {number} range
 * @property {number} fMin
 * @property {number} fMax
 * @property {number[][]} bands
 * @property {Slope} tilt
 * @property {Slope} top
 * @property {boolean} [flat]
 */

/**
 * Response in dB at f, from the data's bands + tilts (placeholder shape).
 *
 * @param {number} f
 * @param {MatrixPlot} cfg
 */
function response(f, { bands, tilt, top }) {
  let d = 0;
  for (const [fc, g, w] of bands) d += g * Math.exp(-0.5 * (Math.log2(f / fc) / w) ** 2);
  const t = Math.log2(f / tilt.from);
  d += (tilt.dbPerOct * Math.log1p(Math.exp(1.5 * t))) / 1.5;
  d += top.dbPerOct * Math.max(0, Math.log2(f / top.from));
  return d;
}

/**
 * The Matrix engine section's response plot, redrawn at its box's size.
 *
 * @param {HTMLElement} host  .eq box; the SVG fills it
 * @param {MatrixPlot} cfg    MATRIX_PLOT
 */
export function mountMatrixPlot(host, cfg) {
  const svg = mountPlotSvg(host, "Matrix response", draw);

  function draw() {
    const W = host.clientWidth,
      H = host.clientHeight;
    if (!W || !H) return;
    const { range, fMin, fMax } = cfg;
    const geo = plotGeometry({ W, H, fMin, fMax, lo: -range, hi: range }, centredLevelY);
    // dB grid: majors every 6 dB; 3 dB minors only once there's room for them.
    const grid = levelGrid({ lo: -range, hi: range, step: 6, minor: 3 }, geo.plotH, 14);
    // flat: a profile that changes nothing (mock)
    const path = tracePath(geo, Math.max(200, Math.round(W)), (f) => (cfg.flat ? 0 : response(f, cfg)));
    paintSvg(svg, W, H, [plotGrid(geo, grid), s("path.trace", { d: path }), plotLabels(geo, grid)]);
  }

  draw();
}
