// Response plot for the matrix-family drawers (Crossfeed, Loudness). Same glass and grid grammar as the page's Matrix
// response plot (matrix-plot.js): log frequency 20 Hz–20 kHz at true decade positions, linear dB, labels in a left gutter
// and a bottom band. Draws 1:1 at its box size, redraws on resize.
//
// Traces are named once, beside their own line (direct labels at the right end, nudged apart when they'd collide):
// no legend line (Volume range bar). Classes: '' = amber (what you get), 'ghost' = ink-3 dashed
// (the reference), 'side' = ink-2. Handles = draggable dots (v1 REW-style), each with onDrag(f, dB) / onEnd(f, dB).

import { s } from '../lib/dom.js';
import { scale } from '../lib/plate.js';

const GUTTER = 28, BAND = 16, PAD = 6, LABEL_W = 0;

const dbLabel = (d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);
const hzLabel = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));

/**
 * @param {HTMLElement} host  .eq box (fills it)
 * @param {{lo:number, hi:number, step:number, minor?:number, fMin?:number, fMax?:number, aria:string}} cfg
 * @returns {{draw(traces:object[], handles?:object[]):void}}
 */
export function mountRespPlot(host, cfg) {
  const fMin = cfg.fMin ?? 20, fMax = cfg.fMax ?? 20000;
  const svg = s('svg', { role: 'img', 'aria-label': cfg.aria });
  host.append(svg);
  let traces = [], handles = [], geo = null, drag = null;

  function draw() {
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    const decades = Math.log10(fMax / fMin);
    const x = (f) => GUTTER + (W - GUTTER - 4 - LABEL_W) * Math.log10(f / fMin) / decades;
    const plotH = H - PAD - BAND;
    const y = (d) => PAD + plotH * (cfg.hi - d) / (cfg.hi - cfg.lo);
    const r = (v) => Math.round(v * 10) / 10;
    geo = { W, H, x, y, decades, plotH };
    const x0 = r(x(fMin)), x1 = r(x(fMax)), yb = r(y(cfg.lo));

    const vline = (f) => s('line', { x1: r(x(f)), y1: PAD, x2: r(x(f)), y2: yb });
    const hline = (d) => s('line', { x1: x0, y1: r(y(d)), x2: x1, y2: r(y(d)) });
    const major = [], minor = [];
    const m = cfg.minor || cfg.step;
    for (let d = Math.ceil(cfg.lo / m) * m; d <= cfg.hi + 1e-9; d += m) {
      if (Math.abs(d) < 1e-9) continue;
      (Math.abs(d / cfg.step - Math.round(d / cfg.step)) < 1e-9 ? major : minor).push(Math.round(d * 10) / 10);
    }
    const roomy = plotH / ((cfg.hi - cfg.lo) / m) >= 12;

    const N = Math.max(160, Math.round(W / 2));
    const paths = traces.map((t) => {
      let d = '';
      for (let i = 0; i <= N; i++) {
        const f = fMin * 10 ** (decades * i / N);
        const v = Math.max(cfg.lo - 2, Math.min(cfg.hi + 2, t.fn(f)));
        d += (i ? ' L' : 'M') + r(x(f)) + ' ' + r(y(v));
      }
      return s('path', { class: `trace ${t.cls || ''}`, d });
    });

    // Direct labels at the right end, above their line; nudged apart (11px) so none overlap.
    const lab = traces.filter((t) => t.label).map((t) => ({ t, yy: y(t.fn(fMax * 0.82)) - 5 }))
      .sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < lab.length; i++) if (lab[i].yy - lab[i - 1].yy < 11) lab[i].yy = lab[i - 1].yy + 11;
    for (const l of lab) l.yy = Math.max(PAD + 9, Math.min(yb - 3, l.yy));

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.replaceChildren(...[
      s('g.grid.minor', {}, [50, 200, 500, 2000, 5000].map(vline), roomy && minor.map(hline)),
      s('g.grid', {}, [100, 1000, 10000].map(vline), major.map(hline)),
      cfg.lo < 0 && cfg.hi > 0 && s('line.zero', { x1: x0, y1: r(y(0)), x2: x1, y2: r(y(0)) }),
      paths,
      s('g.tl', {}, lab.map((l) => s('text', { class: l.t.cls || '', x: x1 - 2, y: r(l.yy), 'text-anchor': 'end', text: l.t.label }))),
      s('g.lbl', {},
        [...major, 0].filter((d) => d >= cfg.lo && d <= cfg.hi).map((d) =>
          s('text', { x: GUTTER - 5, y: r(y(d) + 3), 'text-anchor': 'end', text: dbLabel(d) })),
        s('text', { x: GUTTER - 5, y: H - 4, 'text-anchor': 'end', text: 'dB' }),
        s('text', { x: x0, y: H - 4, text: '20 Hz' }),
        [100, 1000, 10000].map((f) => s('text', { x: r(x(f)), y: H - 4, 'text-anchor': 'middle', text: hzLabel(f) })),
        s('text', { x: x1, y: H - 4, 'text-anchor': 'end', text: '20k' }),
      ),
      handles.map((hd, i) => s('circle', { class: `hdl ${drag === i ? 'act' : ''} ${hd.off ? 'off' : ''}`,
        cx: r(x(hd.f)), cy: r(y(Math.max(cfg.lo, Math.min(cfg.hi, hd.db)))), r: 6, data: { i } })),
    ].flat(2).filter(Boolean));
  }

  // Handle drag: frequency on the log axis (whole Hz), level in 0.1 dB.
  const at = (e) => {
    const b = svg.getBoundingClientRect(), k = scale();
    const px = (e.clientX - b.left) / k, py = (e.clientY - b.top) / k;
    const { W, decades, plotH } = geo;
    const f = fMin * 10 ** (decades * (px - GUTTER) / (W - GUTTER - 4 - LABEL_W));
    const d = cfg.hi - (py - PAD) * (cfg.hi - cfg.lo) / plotH;
    return [Math.round(Math.max(fMin, Math.min(fMax, f))), Math.round(d * 10) / 10];
  };
  svg.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.hdl');
    if (!c || c.classList.contains('off')) return;
    drag = Number(c.dataset.i);
    svg.setPointerCapture(e.pointerId);
    draw();
  });
  svg.addEventListener('pointermove', (e) => { if (drag !== null) handles[drag].onDrag(...at(e)); });
  const end = (e) => {
    if (drag === null) return;
    const hd = handles[drag];
    drag = null;
    hd.onEnd?.(...at(e));
    draw();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  new ResizeObserver(draw).observe(host);
  return {
    draw(t, hds = []) { traces = t; handles = hds; draw(); },
  };
}
