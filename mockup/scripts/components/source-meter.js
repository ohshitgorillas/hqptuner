// Source meter. Drawer (Source drawer, Meter tab): the apodizing strip over the spectrogram on one time axis, filling the
// drawer (spectrum and levels live on the page's Source section, cfg.compact).
// Mounted as a drawer block. Everything here is a view, not a setting: its controls
// never mark the tab dirty.
//
// Mock feed: a deterministic music-like source (chords with harmonics, kick, hats, CD brick-wall above
// ~20 kHz, 16-bit noise floor) so the layout reads at rest and in motion. The real app drives this from the
// 4322 metering stream (store/meter/feed.js): per channel peakMax/peak/rms/rmsMax + 1025-bin transform.
// History clears at track start; "All" spans track start to now.
//
// Units: every control, axis and readout names its unit. Frequency axes are linear, 0 to source Nyquist.
//
// cfg.compact: the page's Source section (main.js; only while the Matrix section is gone and the display has the room,
// lib/plate.js SIZES meter): spectrum + levels only, stretched to the section's height; no spectrogram. Its own view
// state, like a second window on the same stream: one Range column left of the spectrum, stacked, setting both the
// spectrum's span and the levels' floor (cfg.pageRanges; floor = −range). The heads carry titles only.

import { h, s } from '../lib/dom.js';
import { seg } from './seg.js';
import { PLATFORM } from '../lib/clock.js';
import { emptySpectrum, hash, levelTarget, stepFrame, stepLevel, stepSpectrum } from '../model/meter.js';
import { classNames, minusText } from '../model/format.js';

const COLS = 600;                // spectrogram canvas width, px
const ROWS = 320;                // spectrogram canvas rows (frequency, top = Nyquist); stretched to the plot
const BINS = 300;                // spectrum points, 0..Nyquist
const SW = 600, SH = 170;        // spectrum viewBox
const MAX_HISTORY_S = 600;       // mock memory cap
const LEVEL_TICKS = {
  '-48': [0, -6, -12, -24, -36, -48],
  '-60': [0, -10, -20, -30, -40, -50, -60],
  '-90': [0, -15, -30, -45, -60, -75, -90],
  '-120': [0, -20, -40, -60, -80, -100, -120],
};
const DB_STEP = { 60: 10, 90: 15, 120: 20, 200: 40, 300: 50 };
const RAMP = ['--spec-0', '--spec-1', '--spec-2', '--spec-3', '--spec-4', '--spec-5'];

/**
 * @param {HTMLElement} host  empty block container inside a drawer panel
 * @param {object} cfg        METER from data/source.js
 * @param {import('../lib/clock.js').Clock} [clock]  frame stamps and scheduling
 */
export function mountSourceMeter(host, cfg, clock = PLATFORM) {
  const compact = !!cfg.compact;
  const st = { floor: cfg.floor, range: cfg.range, channel: cfg.channel, window: cfg.window };
  if (compact) { st.range = cfg.pageRange; st.floor = -cfg.pageRange; }
  const nch = cfg.channels;
  const nyq = cfg.nyquist;
  const brick = cfg.brick ?? 19600;   // where the mock source's content ends (CD brick-wall; hi-res runs higher)
  const perCol = 1 / cfg.colsPerSec;
  const chOff = () => (st.channel === 'sum' ? 2 : Number(st.channel)) * ROWS;

  // ── Spectrum ──────────────────────────────────────────────────────────
  const grid = s('g.sgridl');
  const area = s('path.sarea');
  const trace = s('path.strace');
  const hold = s('path.shold');
  const cross = s('line.scross', { y1: 0, y2: SH, visibility: 'hidden' });
  const svg = s('svg.spectrum', { viewBox: `0 0 ${SW} ${SH}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Spectrum' },
    grid, area, hold, trace, cross);
  const readout = h('div.sread', { hidden: true });
  const plot = h('div.splot', {}, svg, readout);
  const sY = h('div.gut.gy', { 'aria-hidden': 'true' });
  const sX = h('div.xaxis', { 'aria-hidden': 'true' });

  // Default (Sum, v1 prefs) leftmost.
  const chOptions = [{ v: 'sum', label: 'Sum' }, ...Array.from({ length: nch }, (_, i) => ({ v: String(i), label: nch === 2 ? ['Left', 'Right'][i] : String(i + 1) }))];
  const specSide = h('div.sside', {},
    h('div.mhead', {},
      h('b.mt', { text: 'Spectrum' }),
      h('span.grow'),
      !compact && ctl('Range', 'dB', seg({ aria: 'Range, dB', cls: 'view', value: st.range, options: cfg.ranges.map((v) => ({ v, label: String(v) })),
        onChange: (v) => { st.range = Number(v); paintSpectrumAxes(); paintSpectrum(); paintSpectrogram(); } })),
    ),
    h('div.sgrid1', {}, sY, plot, h('span'), sX),
  );

  // ── Levels (vertical) ─────────────────────────────────────────────────
  const lvScale = h('div.lvs', { 'aria-hidden': 'true' });
  const bars = Array.from({ length: nch }, (_, i) => {
    const pk = h('i.pk'), rm = h('i.rm'), hd = h('i.hd');
    return { pk, rm, hd, el: h('div.lvb', {}, h('div.trough', {}, pk, rm, hd), h('span.lvn', { text: chName(i) })) };
  });
  const cells = Array.from({ length: nch }, () => ({ peak: h('span.npk'), rms: h('span.nrm') }));
  const lvSide = h('div.lside', {},
    h('div.mhead', {},
      h('b.mt', { text: 'Levels' }),
      h('span.grow'),
      !compact && ctl('Floor', 'dBFS', seg({ aria: 'Floor, dBFS', cls: 'view', value: st.floor, options: cfg.floors.map((v) => ({ v, label: minusText(v) })),
        onChange: (v) => { st.floor = Number(v); paintLvScale(); } })),
    ),
    h('div.lvwrap', {}, lvScale, bars.map((b) => b.el), h('div.lvtab', {},
      h('span.u', { text: 'dBFS' }), Array.from({ length: nch }, (_, i) => h('span.lvh', { text: chName(i) })),
      h('span.lvh.l', { text: 'Peak' }), cells.map((c) => c.peak),
      h('span.lvh.l', { text: 'RMS' }), cells.map((c) => c.rms),
    )),
  );

  // Page: one Range for both halves, stacked in its own column left of the spectrum.
  const rangeCol = compact && h('div.mrange', {},
    h('div.lbl', {}, h('span.eng', { text: 'Range' }), h('span.u', { text: 'dB' })),
    seg({ aria: 'Range, dB', cls: 'view vert', value: st.range, options: cfg.pageRanges.map((v) => ({ v, label: String(v) })),
      onChange: (v) => { st.range = Number(v); st.floor = -st.range; paintSpectrumAxes(); paintSpectrum(); paintLvScale(); } }));
  const top = h('div.mblk.mtop', {}, rangeCol, specSide, lvSide);

  // ── Spectrogram + apodizing strip ─────────────────────────────────────
  const spec = h('canvas.spec', { width: COLS, height: ROWS, role: 'img', 'aria-label': 'Spectrogram' });
  const apod = h('canvas.apodstrip', { width: COLS, height: 1, role: 'img', 'aria-label': 'Apodizing events over time' });
  const gY = h('div.gut.gy', { 'aria-hidden': 'true' });
  const tAxis = h('div.xaxis', { 'aria-hidden': 'true' });
  const bottom = h('div.mblk', {},
    h('div.mhead', {},
      h('b.mt', { text: 'Spectrogram' }),
      h('span.grow'),
      ctl('Range', 'dB', seg({ aria: 'Range, dB', cls: 'view', value: st.range, options: cfg.ranges.map((v) => ({ v, label: String(v) })),
        onChange: (v) => { st.range = Number(v); paintSpectrogram(); } })),
      ctl('Channel', null, seg({ aria: 'Channel', cls: 'view', value: st.channel, options: chOptions, onChange: (v) => { st.channel = v; spectrumReset(); paintSpectrogram(); } })),
      ctl('Window', null, seg({ aria: 'Time window', cls: 'lc view', value: st.window, options: cfg.windows,
        onChange: (v) => { st.window = v === 'all' ? 'all' : Number(v); paintSpectrogram(); } })),
    ),
    h('div.sgrid2', {},
      h('span.rowl', { text: 'Apodizing' }), apod,
      gY, spec,
      h('span'), tAxis,
    ),
  );

  // The drawer holds the spectrogram alone: spectrum and levels live on the page's Source section.
  const root = compact ? top : bottom;
  host.append(root);

  const sctx = spec.getContext('2d');
  const actx = apod.getContext('2d');
  const img = sctx.createImageData(COLS, ROWS);
  const aimg = actx.createImageData(COLS, 1);
  let lut, apodLut, glass;

  // ── Mock source model ─────────────────────────────────────────────────
  const rowHz = Array.from({ length: ROWS }, (_, y) => nyq * (1 - (y + 0.5) / ROWS));
  const binHz = Array.from({ length: BINS }, (_, i) => Math.max(10, (nyq * i) / (BINS - 1)));

  function column(idx) {
    const t = idx * perCol;
    const chord = [[45, 57, 61, 64], [50, 57, 62, 66], [43, 55, 59, 62], [48, 55, 60, 64]][Math.floor(t / 2.4) % 4];
    const c = {
      idx,
      notes: chord.map((m) => 440 * 2 ** ((m - 69) / 12)),
      dyn: chord.map((_, n) => 6 * hash(Math.floor(t / 0.6), 20 + n) + (t % 2.4) * 2.5),
      hatDb: 10 * hash(idx, 9),
      kick: idx % 5 === 0,
      hat: idx % 5 === 3,
      env: 3 * Math.sin(t * 0.37) + 1.5 * Math.sin(t * 1.9) + (hash(idx, 7) - 0.5) * 2,
      // Apodizing events cluster in the opening bars (12 this track); rare afterwards.
      apod: idx < 90 ? (hash(idx, 3) < 0.12 ? 1 + Math.floor(hash(idx, 4) * 2) : 0) : (hash(idx, 5) < 0.0015 ? 1 : 0),
    };
    // Spectrogram rows: L, R, Sum (dBFS), computed once per column.
    c.db = new Float32Array(ROWS * 3);
    for (let y = 0; y < ROWS; y++) {
      const [l, r] = [0, 1].map((ch) => power(c, rowHz[y], ch) * jitter(c, y, ch));
      c.db[y] = dB(l); c.db[ROWS + y] = dB(r); c.db[2 * ROWS + y] = dB((l + r) / 2);
    }
    return c;
  }

  /** Linear power at f for one channel of one column, env applied. */
  function power(c, f, ch) {
    let p = 10 ** ((-56 - 5 * Math.log2(Math.max(f, 60) / 250) - (f < 60 ? 12 * Math.log2(60 / f) : 0)) / 10);
    c.notes.forEach((f0, n) => {
      const pan = (n + ch) % 2 ? 0 : -2.5;
      for (let k = 1; k <= 14; k++) {
        const fk = f0 * k;
        if (fk > brick * 0.97) break;
        const d = Math.log2(f / fk);
        if (d > 0.15 || d < -0.15) continue;
        p += 10 ** ((-20 - 6.5 * Math.log2(k) + pan - (n === 0 ? 0 : 4) - c.dyn[n]) / 10) * Math.exp(-0.5 * (d / 0.035) ** 2);
      }
    });
    if (c.kick && f < 180) p += 10 ** (-12 / 10) * Math.exp(-0.5 * (Math.log2(f / 60) / 0.6) ** 2);
    if (c.hat && f > 3000) p += 10 ** ((-58 - c.hatDb - 3 * Math.log2(f / 8000) ** 2) / 10);
    if (f > brick) p *= 10 ** (-Math.min(110, (f - brick) * (brick > 30000 ? 0.012 : 0.09)) / 10);
    p += 10 ** (-112 / 10);
    // DSD source (decimated to its base rate): the modulator's noise climbs toward the top of the band.
    if (cfg.dsdNoise && f > 12000) p += 10 ** ((-118 + ((f - 12000) / 10000) * 62) / 10);
    return p * 10 ** (c.env / 10);
  }
  const jitter = (c, i, ch) => 10 ** ((hash(c.idx * 211 + i, 1 + ch) - 0.5) * 0.6);

  // History since track start (index 0 = first column of the track).
  const hist = [];
  const elapsedCols = Math.round(cfg.trackElapsedSec * cfg.colsPerSec);
  for (let i = 0; i < elapsedCols; i++) hist.push(column(i));
  let firstIdx = 0;
  const cap = MAX_HISTORY_S * cfg.colsPerSec;
  function push() {
    hist.push(column(firstIdx + hist.length));
    if (hist.length > cap) { hist.shift(); firstIdx++; }
  }
  const latest = () => hist[hist.length - 1];

  // ── Colours from tokens ───────────────────────────────────────────────
  function readRamp() {
    const cs = getComputedStyle(document.documentElement);
    const stops = RAMP.map((n, i) => rgb(cs.getPropertyValue(n), [i * 50, i * 40, i * 20]));
    lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const pos = (i / 255) * (stops.length - 1);
      const a = Math.min(stops.length - 2, Math.floor(pos)), t = pos - a;
      for (let k = 0; k < 3; k++) lut[i * 3 + k] = stops[a][k] + (stops[a + 1][k] - stops[a][k]) * t;
    }
    glass = rgb(cs.getPropertyValue('--glass'), [8, 9, 11]);
    const bad = rgb(cs.getPropertyValue('--bad'), [224, 88, 75]);
    apodLut = [0, 1, 2, 3].map((n) => { const t = n ? 0.45 + 0.18 * n : 0; return glass.map((g, k) => g + (bad[k] - g) * t); });
  }

  // ── Spectrum painting ─────────────────────────────────────────────────
  let sp = emptySpectrum(BINS);
  const xOf = (f) => (f / nyq) * SW;
  const yOf = (db) => Math.max(0, Math.min(SH, (-db / st.range) * SH));

  function spectrumReset() { sp = emptySpectrum(BINS); spectrumFrame(0, true); }

  function spectrumFrame(now, jump = false) {
    const c = latest();
    const levels = Float64Array.from(binHz, (f, i) => {
      const p = st.channel === 'sum' ? (power(c, f, 0) + power(c, f, 1)) / 2 : power(c, f, Number(st.channel));
      return dB(p * jitter(c, i, 5));
    });
    sp = stepSpectrum(sp, levels, now, jump);
    paintSpectrum();
  }

  function paintSpectrum() {
    const pts = (arr) => Array.from(arr, (v, i) => `${(xOf(binHz[i])).toFixed(1)},${yOf(v).toFixed(1)}`).join(' L');
    const line = 'M' + pts(sp.disp);
    trace.setAttribute('d', line);
    area.setAttribute('d', `${line} L${SW},${SH} L0,${SH} Z`);
    hold.setAttribute('d', 'M' + pts(sp.peak));
  }

  function paintSpectrumAxes() {
    const step = DB_STEP[st.range];
    const dbs = []; for (let d = 0; d >= -st.range; d -= step) dbs.push(d);
    grid.replaceChildren(
      ...dbs.slice(1, -1).map((d) => s('line', { x1: 0, x2: SW, y1: yOf(d), y2: yOf(d) })),
      ...khzTicks().slice(1).map((f) => s('line', { x1: xOf(f), x2: xOf(f), y1: 0, y2: SH })),
    );
    sY.replaceChildren(...dbs.map((d, i) => h('span', {
      style: `top:${pct(yOf(d) / SH)}`, class: classNames(i === 0 && 'first', i === dbs.length - 1 && 'last'),
      text: d === 0 ? '0 dBFS' : minusText(d),
    })));
    sX.replaceChildren(...freqLabels((f) => xOf(f) / SW, 'x'));
  }

  // Hover / touch readout: frequency and level under the pointer.
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const i = Math.round(fx * (BINS - 1));
    cross.setAttribute('x1', fx * SW); cross.setAttribute('x2', fx * SW); cross.setAttribute('visibility', 'visible');
    readout.hidden = false;
    readout.textContent = `${(binHz[i] / 1000).toFixed(2)} kHz · ${minusText(sp.disp[i].toFixed(1))} dBFS`;
  });
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); readout.hidden = true; });

  // ── Spectrogram painting ──────────────────────────────────────────────
  function spanCols() {
    return st.window === 'all' ? firstIdx + hist.length : st.window * cfg.colsPerSec;
  }

  function paintSpectrogram() {
    const total = firstIdx + hist.length;                 // columns since track start
    const span = spanCols();
    const start = total - span;                           // track column at the left edge
    const off = chOff(), d = img.data, a = aimg.data, R = st.range;
    for (let x = 0; x < COLS; x++) {
      const i0 = start + Math.floor((x * span) / COLS);
      const i1 = Math.max(i0 + 1, start + Math.floor(((x + 1) * span) / COLS));
      let ev = 0;
      const cols = [];
      for (let i = Math.max(i0, firstIdx); i < i1 && i < total; i++) { const c = hist[i - firstIdx]; cols.push(c); ev += c.apod; }
      for (let y = 0; y < ROWS; y++) {
        const o = (y * COLS + x) * 4;
        if (!cols.length) { d[o] = glass[0]; d[o + 1] = glass[1]; d[o + 2] = glass[2]; d[o + 3] = 255; continue; }
        let m = -300;
        for (const c of cols) if (c.db[off + y] > m) m = c.db[off + y];
        const li = Math.round(Math.max(0, Math.min(1, (m + R) / R)) * 255) * 3;
        d[o] = lut[li]; d[o + 1] = lut[li + 1]; d[o + 2] = lut[li + 2]; d[o + 3] = 255;
      }
      const col = apodLut[Math.min(3, ev)];
      a[x * 4] = col[0]; a[x * 4 + 1] = col[1]; a[x * 4 + 2] = col[2]; a[x * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    actx.putImageData(aimg, 0, 0);
    paintTimeAxis(span, total);
  }

  function paintTimeAxis(span, total) {
    const spanS = span / cfg.colsPerSec;
    const all = st.window === 'all';
    const step = [5, 10, 15, 30, 60, 120, 300].find((v) => spanS / v <= 5) || 600;
    const inMin = spanS > 120;
    const fmt = (sec) => (inMin ? `${minusText(+(sec / 60).toFixed(1))} min` : `${minusText(Math.round(sec))} s`);
    const labels = [];
    if (all) {
      // Absolute track position, track start at the left edge.
      const endS = total / cfg.colsPerSec;
      for (let t = 0; t < endS - step * 0.35; t += step) labels.push([t / spanS, fmt(t)]);
      labels.push([1, fmt(endS)]);
    } else {
      for (let t = spanS; t > step * 0.35; t -= step) labels.push([1 - t / spanS, fmt(-t)]);
      labels.push([1, fmt(0)]);
    }
    tAxis.replaceChildren(...labels.map(([f, txt], i) => h('span', {
      style: `left:${pct(f)}`, class: classNames(i === 0 && 'first', i === labels.length - 1 && 'last'), text: txt,
    })));
  }

  function paintSpectrogramAxis() {
    gY.replaceChildren(...freqLabels((f) => 1 - f / nyq, 'y'));
  }

  function khzTicks() {
    const step = nyq > 60000 ? 20000 : nyq > 30000 ? 10000 : 5000;
    return Array.from({ length: Math.floor(nyq / step) + 1 }, (_, i) => i * step).filter((f) => f <= nyq * 0.85);
  }

  /** Frequency tick labels in kHz (unit on the 0 tick), plus the source Nyquist as the last label. */
  function freqLabels(pos, axis) {
    // x: 0 at the left edge, Nyquist at the right. y: Nyquist at the top edge, 0 at the bottom.
    const [prop, lo, hi] = axis === 'x' ? ['left', 'first', 'last'] : ['top', 'last', 'first'];
    return [
      ...khzTicks().map((f) => h('span', { style: `${prop}:${pct(pos(f))}`, class: f === 0 && lo, text: f ? String(f / 1000) : '0 kHz' })),
      h('span.nyq', { class: hi, style: `${prop}:${pct(pos(nyq))}`, title: 'Source Nyquist', text: `${+(nyq / 1000).toFixed(2)}${axis === 'x' ? ' kHz' : ''}` }),
    ];
  }

  // ── Levels ────────────────────────────────────────────────────────────
  const frac = (db) => Math.max(0, Math.min(1, (db - st.floor) / -st.floor));
  function paintLvScale() {
    lvScale.replaceChildren(...LEVEL_TICKS[String(st.floor)].map((d, i, a) => h('span', {
      style: `top:${pct(1 - frac(d))}`, class: classNames(i === 0 && 'first', i === a.length - 1 && 'last'),
      text: d === 0 ? '0 dBFS' : minusText(d),
    })));
  }
  let lv = bars.map(() => ({ peak: -60, rms: -60, hold: -60, holdAt: 0 }));
  function stepLevels(now, dt) {
    const c = latest();
    lv = lv.map((v, ch) => stepLevel(v, levelTarget(c, ch, now), now, dt));
    bars.forEach((b, ch) => {
      const v = lv[ch];
      b.pk.style.height = pct(frac(v.peak));
      b.rm.style.height = pct(frac(v.rms));
      b.hd.style.bottom = pct(frac(v.hold));
      cells[ch].peak.textContent = minusText(v.hold.toFixed(1));
      cells[ch].rms.textContent = minusText(v.rms.toFixed(1));
    });
  }

  // ── Run ───────────────────────────────────────────────────────────────
  function paintAll() {
    readRamp();
    paintSpectrumAxes();
    if (!compact) paintSpectrogramAxis();
    paintLvScale();
    spectrumFrame(0, true);
    if (!compact) paintSpectrogram();
  }
  paintAll();
  for (let k = 0; k < 40; k++) stepLevels(k * 50, 0.05);   // settle ballistics so the resting frame is a reading
  // Stylesheets can land after the module runs; repaint once the ramp tokens are certainly live.
  window.addEventListener('load', paintAll);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const shown = () => {
    if (compact) return document.visibilityState === 'visible' && !!host.offsetParent;
    const dr = host.closest('.drawer'), p = host.closest('.dpanel');
    return document.visibilityState === 'visible' && dr && !dr.hasAttribute('data-closed') && p && !p.hidden;
  };
  let loop = { prev: clock.now(), acc: 0 };
  (function tick(now) {
    if (!host.contains(root)) return;   // remounted (mock scenario changed the source): this instance stops
    const vis = !!shown();
    const step = stepFrame(loop, now, perCol, vis);
    loop = step;
    if (step.cols) {
      for (let k = 0; k < step.cols; k++) push();
      spectrumFrame(now);
      if (!compact) paintSpectrogram();
    }
    if (vis) stepLevels(now, step.dt);
    clock.requestAnimationFrame(tick);
  })(loop.prev);
}

/** Control: engraved label, optional unit, then the control. */
function ctl(label, unit, control) {
  return h('div.mctl', {}, h('span.eng', { text: label }), unit && h('span.u', { text: unit }), control);
}

const chName = (i) => ['L', 'R'][i] ?? String(i + 1);
const dB = (p) => 10 * Math.log10(p);
const pct = (f) => (f * 100).toFixed(2) + '%';

function rgb(hex, fallback) {
  const m = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(m)) return fallback;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
