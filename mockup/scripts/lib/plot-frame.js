// The frame every response plot draws (components/matrix-plot.js, components/resp-plot.js): log frequency 20 Hz–20 kHz
// at true decade positions, linear dB, dB labels in a left gutter and frequency labels in a bottom band, both clear of
// the trace. Geometry from model/plot-axes.js; the SVG fills its box and redraws on resize.

import { s } from './dom.js';
import { signedDb } from './gauge.js';
import { GUTTER, PAD, round1 as r } from '../model/plot-axes.js';

const hzLabel = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));

/**
 * The plot's SVG, appended to `host`; `draw` reruns whenever the host resizes.
 *
 * @param {HTMLElement} host
 * @param {string} aria
 * @param {() => void} draw
 * @returns {SVGSVGElement}
 */
export function mountPlotSvg(host, aria, draw) {
  const svg = s('svg', { role: 'img', 'aria-label': aria });
  host.append(svg);
  new globalThis.ResizeObserver(draw).observe(host);
  return svg;
}

/**
 * The grid behind the trace: decade lines and the lines between them, the level grid (minors only with room), and the
 * 0 dB line when the scale crosses it.
 *
 * @param {import('../model/plot-axes.js').PlotGeometry} geo
 * @param {import('../model/plot-axes.js').LevelGrid} grid
 */
export function plotGrid({ x, y, lo, hi, x0, x1, yb }, grid) {
  const vline = (f) => s('line', { x1: r(x(f)), y1: PAD, x2: r(x(f)), y2: yb });
  const hline = (d) => s('line', { x1: x0, y1: r(y(d)), x2: x1, y2: r(y(d)) });
  return [
    s('g.grid.minor', {}, [50, 200, 500, 2000, 5000].map(vline), grid.roomy && grid.minor.map(hline)),
    s('g.grid', {}, [100, 1000, 10000].map(vline), grid.major.map(hline)),
    lo < 0 && hi > 0 && s('line.zero', { x1: x0, y1: r(y(0)), x2: x1, y2: r(y(0)) }),
  ];
}

/**
 * The axis labels: dB in the gutter, frequency in the band.
 *
 * @param {import('../model/plot-axes.js').PlotGeometry} geo
 * @param {import('../model/plot-axes.js').LevelGrid} grid
 */
export function plotLabels({ x, y, H, x0, x1 }, grid) {
  return s('g.lbl', {},
    grid.labels.map((d) => s('text', { x: GUTTER - 5, y: r(y(d) + 3), 'text-anchor': 'end', text: signedDb(d) })),
    s('text', { x: GUTTER - 5, y: H - 4, 'text-anchor': 'end', text: 'dB' }),
    s('text', { x: x0, y: H - 4, text: '20 Hz' }),
    [100, 1000, 10000].map((f) => s('text', { x: r(x(f)), y: H - 4, 'text-anchor': 'middle', text: hzLabel(f) })),
    s('text', { x: x1, y: H - 4, 'text-anchor': 'end', text: '20k' }),
  );
}
