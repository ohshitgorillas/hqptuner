// Matrix response plot. Redraws 1:1 at whatever size its box is (the Matrix engine section absorbs the
// page's spare height, so the size depends on which stages are engaged). Log frequency, linear dB.
// Layout: dB labels in a left gutter, frequency labels in a bottom band, both clear of the trace.

import { s } from '../lib/dom.js';

const GUTTER = 28;   // left, for dB labels
const BAND = 16;     // bottom, for frequency labels
const PAD = 6;       // top

/** Response in dB at f, from the data's bands + tilts (placeholder shape). */
function response(f, { bands, tilt, top }) {
  let d = 0;
  for (const [fc, g, w] of bands) d += g * Math.exp(-0.5 * (Math.log2(f / fc) / w) ** 2);
  const t = Math.log2(f / tilt.from);
  d += tilt.dbPerOct * Math.log1p(Math.exp(1.5 * t)) / 1.5;
  d += top.dbPerOct * Math.max(0, Math.log2(f / top.from));
  return d;
}

const dbLabel = (d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);
const hzLabel = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));

/**
 * @param {HTMLElement} host  .eq box; the SVG fills it
 * @param {object} cfg        MATRIX_PLOT
 */
export function mountMatrixPlot(host, cfg) {
  const svg = s('svg', { role: 'img', 'aria-label': 'Matrix response' });
  host.append(svg);

  function draw() {
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    const { range, fMin, fMax } = cfg;
    const decades = Math.log10(fMax / fMin);
    const x = (f) => GUTTER + (W - GUTTER - 4) * Math.log10(f / fMin) / decades;
    const plotH = H - PAD - BAND;
    const y = (d) => PAD + plotH / 2 - d * (plotH / 2) / range;
    const r = (v) => Math.round(v * 10) / 10;
    const x0 = r(x(fMin)), x1 = r(x(fMax)), yb = r(y(-range));

    const vline = (f) => s('line', { x1: r(x(f)), y1: PAD, x2: r(x(f)), y2: yb });
    const hline = (d) => s('line', { x1: x0, y1: r(y(d)), x2: x1, y2: r(y(d)) });

    // dB grid: majors every 6 dB; 3 dB minors only once there's room for them.
    const majorDb = [], minorDb = [];
    for (let d = -range; d <= range; d += 3) {
      if (d === 0) continue;
      (d % 6 === 0 ? majorDb : minorDb).push(d);
    }
    const roomy = plotH / (2 * range / 3) >= 14;

    let path = '';
    const N = Math.max(200, Math.round(W));
    for (let i = 0; i <= N; i++) {
      const f = fMin * 10 ** (decades * i / N);
      path += (i ? ' L' : 'M') + r(x(f)) + ' ' + r(y(cfg.flat ? 0 : response(f, cfg)));   // flat: a profile that changes nothing (mock)
    }

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.replaceChildren(
      s('g.grid.minor', {}, [50, 200, 500, 2000, 5000].map(vline), roomy && minorDb.map(hline)),
      s('g.grid', {}, [100, 1000, 10000].map(vline), majorDb.map(hline)),
      s('line.zero', { x1: x0, y1: r(y(0)), x2: x1, y2: r(y(0)) }),
      s('path.trace', { d: path }),
      s('g.lbl', {},
        [...majorDb, 0].map((d) => s('text', { x: GUTTER - 5, y: r(y(d) + 3), 'text-anchor': 'end', text: dbLabel(d) })),
        s('text', { x: GUTTER - 5, y: H - 4, 'text-anchor': 'end', text: 'dB' }),
        s('text', { x: x0, y: H - 4, text: '20 Hz' }),
        [100, 1000, 10000].map((f) => s('text', { x: r(x(f)), y: H - 4, 'text-anchor': 'middle', text: hzLabel(f) })),
        s('text', { x: x1, y: H - 4, 'text-anchor': 'end', text: '20k' }),
      ),
    );
  }

  new ResizeObserver(draw).observe(host);
  draw();
}
