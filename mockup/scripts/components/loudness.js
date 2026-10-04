// Loudness drawer body (under the Loudness Off/On row, which is a plain schema row).
//   Bands  one side at a time behind v1's Bass | Treble switch: Type, Frequency, Steepness / Q, Level left, that side's
//          manual lines right (v1 settings.json, verbatim). Type = engine tokens (lshelf|hshelf / peak / peakq), mono.
//   Range  the bounds on their own axis, −120 … 0 dBFS (the 6.0.4 form's min/max for both bounds): parentheses + strip,
//          the Volume Range bar's glyphs, here as the handles. Green needle = live playback volume (a readout). Each mark
//          is named once, beside its glyph, in the boxes under the bar. Clamp: whole dB, Lower ≤ Upper.
//   Plot   v1's loudness plot: the maximum shelving ("max") against what the live volume applies ("x% applied",
//          the rail's own copy), −3 … +24 dB like v1. Each band is a draggable dot at (frequency, level), v1 REW-style.
// Everything stages through the drawer block context; grays while the matrix engine is bypassed or loudness is Off.

import { h, s } from '../lib/dom.js';
import { scale } from '../lib/plate.js';
import { seg, select } from './seg.js';
import { mountRespPlot } from './resp-plot.js';
import { loudnessDb, shelfScale } from '../lib/xdsp.js';

const AXIS = { min: -120, max: 0 };
const PADX = 14;
const Y = { bar: 10, barH: 14, tick: 33, label: 54, H: 59 };
const fmtDb = (d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);
const fmtLevel = (v) => (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(1);

/**
 * @param {HTMLElement} host
 * @param {object} cfg       LOUDNESS (data/matrix.js)
 * @param {{set:Function, init:Function, watch:Function}} ctx
 * @param {{bypassed:(v:object)=>string, level:number, levelBus:EventTarget}} o
 */
export function mountLoudness(host, cfg, ctx, { bypassed, level: lvl0, levelBus }) {
  const p = { low: { ...cfg.low }, high: { ...cfg.high } };
  const rng = { low: cfg.rangeLow, high: cfg.rangeHigh };
  let level = lvl0, grayed = false;
  const id = (side, k) => `ld${side}${k}`;
  for (const side of ['low', 'high']) for (const k of ['type', 'freq', 'steep', 'level']) ctx.init(id(side, k), p[side][k]);
  ctx.init('ldrlow', rng.low); ctx.init('ldrhigh', rng.high);

  // ── Bands ─────────────────────────────────────────────────────────────
  const ctl = {};
  const typeSeg = (sd) => seg({ aria: `${sd === 'low' ? 'Bass' : 'Treble'} type`, cls: 'enum mini2',
    options: cfg.types[sd].map((t) => ({ v: t, label: t })), value: p[sd].type,
    onChange: (v) => { p[sd].type = v; stage(sd, 'type', v); plot(); } });
  const numIn = (sd, k, step, min, max) => {
    const input = h('input.vfd', { type: 'number', step, min, max, 'aria-label': `${sd === 'low' ? 'Bass' : 'Treble'} ${k}` });
    input.addEventListener('change', () => { p[sd][k] = Number(input.value); stage(sd, k, p[sd][k]); plot(); });
    return input;
  };
  for (const sd of ['low', 'high']) {
    ctl[sd] = { type: typeSeg(sd), freq: numIn(sd, 'freq', 1, 20, 20000), steep: numIn(sd, 'steep', 0.1, 0.1, 10), level: numIn(sd, 'level', 0.1, -20, 20) };
  }
  // One side at a time (v1's own Bass | Treble switch): its four rows left, its four manual lines right. A side holding
  // staged edits keeps a dot on its switch button while hidden (v1: staged edits on the hidden side are never invisible).
  const ROWS = [['type', 'Type', ''], ['freq', 'Frequency', 'Hz'], ['steep', 'Steepness / Q', ''], ['level', 'Level', 'dB']];
  let side = 'low';
  const dirtySide = { low: false, high: false };
  const sideSeg = seg({ aria: 'Band', cls: 'lsw view', value: side,
    options: [{ v: 'low', label: 'Bass' }, { v: 'high', label: 'Treble' }], onChange: (v) => showSide(v) });
  const rowsHost = h('div.lrows');
  const copyHost = h('div.man.lcopy');
  // The gray reason sits at the head of the copy column, beside the switch it explains (no height of its own).
  const reason = h('span.gr', { hidden: true });
  const bands = h('div.lbands', {}, h('div.lleft', {}, sideSeg, rowsHost), h('div.lrc', {}, reason, copyHost));
  function showSide(v) {
    side = v;
    select(sideSeg, v);
    rowsHost.replaceChildren(...ROWS.map(([k, label, unit]) => h('div.lrow', {},
      h('span.ll', { text: label }),
      k === 'type' ? ctl[v].type : h('div.num', {}, ctl[v][k], unit && h('span.u', { text: unit })))));
    copyHost.replaceChildren(...ROWS.map(([k, label]) => h('p', {}, h('b', { text: label }), ' — ', cfg.man[v][k])));
    paintSideDots();
  }
  function paintSideDots() {
    for (const b of sideSeg.querySelectorAll('button')) b.classList.toggle('dirty', dirtySide[b.dataset.v] && b.dataset.v !== side);
  }
  const stage = (sd, k, v) => { dirtySide[sd] = true; ctx.set(id(sd, k), v); paintSideDots(); };

  // ── Range bar ─────────────────────────────────────────────────────────
  const svg = s('svg.vrbar.lrbar', { role: 'img', 'aria-label': 'Loudness range' });
  const box = (k, label, glyph) => {
    const input = h('input.vfd', { type: 'number', step: 1, min: AXIS.min, max: AXIS.max, 'aria-label': label });
    input.addEventListener('change', () => move(k, Number(input.value)));
    return { input, el: h('label.vrbox', {}, keyGlyph(glyph), h('span.cl', { text: label }), input, h('span.u', { text: 'dBFS' })) };
  };
  const boxes = { low: box('low', 'Lower', 'lparen'), high: box('high', 'Upper', 'rparen') };
  const levelOut = h('output.vfd.ro.live', { 'aria-label': 'Playback volume' });
  const plotHost = h('div.eq.lplot');
  host.append(
    bands,
    h('div.lbot', {},
      h('div.lrange', {},
        // The needle is named on the head line, beside its glyph; the two bounds in the boxes under the bar.
        h('div.fh.lrh', {}, h('b', { text: 'Range' }),
          h('div.vrbox.lpb', {}, keyGlyph('needle'), h('span.cl', { text: 'Playback' }), levelOut, h('span.u', { text: 'dB' }))),
        h('div.vrwell', {}, svg),
        // Each bound's box with its own manual line straight under it (copy beside its setting).
        h('div.lbound', {}, boxes.low.el, h('p.man', { text: cfg.man.rangeLow })),
        h('div.lbound', {}, boxes.high.el, h('p.man', { text: cfg.man.rangeHigh })),
      ),
      plotHost,
    ),
  );
  const rp = mountRespPlot(plotHost, { lo: -3, hi: 24, step: 6, minor: 3, aria: 'Loudness response' });

  let drag = null;
  const dbAt = (e) => {
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale();
    return AXIS.min + (x - PADX) / (svg.clientWidth - 2 * PADX) * (AXIS.max - AXIS.min);
  };
  svg.addEventListener('pointerdown', (e) => {
    if (grayed) return;
    const d = dbAt(e);
    drag = Math.abs(rng.low - d) <= Math.abs(rng.high - d) ? 'low' : 'high';
    svg.setPointerCapture(e.pointerId);
    move(drag, d);
  });
  svg.addEventListener('pointermove', (e) => { if (drag) move(drag, dbAt(e)); });
  const end = () => { drag = null; draw(); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  function move(k, d) {
    let n = Math.round(Math.max(AXIS.min, Math.min(AXIS.max, d)));
    n = k === 'low' ? Math.min(n, rng.high) : Math.max(n, rng.low);
    if (n !== rng[k]) { rng[k] = n; ctx.set(k === 'low' ? 'ldrlow' : 'ldrhigh', n); }
    paintRange();
    plot();
  }

  function paintRange() {
    boxes.low.input.value = rng.low; boxes.high.input.value = rng.high;
    boxes.low.input.max = rng.high; boxes.high.input.min = rng.low;
    levelOut.textContent = fmtLevel(level);
    draw();
  }

  function draw() {
    const W = svg.clientWidth;
    if (!W) return;
    const x = (d) => Math.round((PADX + (W - 2 * PADX) * (d - AXIS.min) / (AXIS.max - AXIS.min)) * 2) / 2;
    const by = Y.bar, bh = Y.barH;
    const ticks = [];
    for (let d = AXIS.min; d <= AXIS.max; d += 10) ticks.push(d);
    const LABELS = new Map([[-120, '−120'], [-90, '−90'], [-60, '−60'], [-30, '−30'], [0, '0 dBFS']]);
    const paren = (d, dir, k) => {
      const xx = x(d), bow = 5 * dir;
      return s('path', { class: `paren ${drag === k ? 'act' : ''}`, d: `M${xx},${by - 7} Q${xx - bow},${by + bh / 2} ${xx},${by + bh + 7}` });
    };
    const lv = Math.max(AXIS.min, Math.min(AXIS.max, level));
    svg.setAttribute('viewBox', `0 0 ${W} ${Y.H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', Y.H);
    svg.replaceChildren(...[
      s('rect.trk', { x: PADX - 3, y: by, width: W - 2 * PADX + 6, height: bh, rx: 3 }),
      s('rect.lspan', { x: x(rng.low), y: by, width: Math.max(0, x(rng.high) - x(rng.low)), height: bh }),
      ticks.map((d) => s('line', { class: `tk ${LABELS.has(d) ? 'major' : ''}`, x1: x(d), x2: x(d), y1: Y.tick, y2: Y.tick + (LABELS.has(d) ? 9 : 5) })),
      [...LABELS].map(([d, t]) => s('text.tl', { x: x(d), y: Y.label, 'text-anchor': d === AXIS.min ? 'start' : d === AXIS.max ? 'end' : 'middle', text: t })),
      s('g.needle', {}, s('line', { x1: x(lv), x2: x(lv), y1: by - 3, y2: by + bh + 3 }), s('circle', { cx: x(lv), cy: by + bh + 7, r: 2.5 })),
      paren(rng.low, 1, 'low'), paren(rng.high, -1, 'high'),
      drag && s('text.bub', { x: x(rng[drag]), y: Y.label, 'text-anchor': 'middle', text: `${fmtDb(rng[drag])} dBFS` }),
    ].flat(2).filter(Boolean));
  }

  // ── Plot ──────────────────────────────────────────────────────────────
  function paintBands() {
    for (const sd of ['low', 'high']) {
      select(ctl[sd].type, p[sd].type);
      for (const k of ['freq', 'steep', 'level']) ctl[sd][k].value = p[sd][k];
    }
  }
  // Grabbing a dot points the switch at that dot's side (v1).
  const handle = (sd) => ({
    f: p[sd].freq, db: p[sd].level, off: grayed,
    onDrag: (f, d) => { if (side !== sd) showSide(sd); p[sd].freq = f; p[sd].level = Math.max(-20, Math.min(20, d)); paintBands(); plot(); },
    onEnd: (f, d) => {
      p[sd].freq = f; p[sd].level = Math.max(-20, Math.min(20, d));
      stage(sd, 'freq', p[sd].freq); stage(sd, 'level', p[sd].level);
      paintBands(); plot();
    },
  });
  function plot() {
    const amt = shelfScale(level, rng.low, rng.high);
    rp.draw([
      { cls: 'ghost', label: 'max', fn: (f) => loudnessDb(p, f, 1) },
      { label: `${Math.round(amt * 100)}% applied`, fn: (f) => loudnessDb(p, f, amt) },
    ], [handle('low'), handle('high')]);
  }

  ctx.watch((v) => {
    const why = bypassed(v) || (v.ldon === '0' ? cfg.off : '');
    grayed = !!why;
    // Controls, bar and plot gray; the copy and the reason stay legible (as in every drawer).
    for (const el of [bands.querySelector('.lleft'), host.querySelector('.lrange'), plotHost]) el.classList.toggle('grayed', grayed);
    for (const x of host.querySelectorAll('button,input')) x.disabled = grayed;
    reason.textContent = why; reason.hidden = !why;
    plot();
  });
  levelBus.addEventListener('level', (e) => { level = e.detail; paintRange(); plot(); });
  // Discard (mock): both bands and the bounds go back; the side dots clear.
  ctx.onDiscard((b) => {
    for (const sd of ['low', 'high']) for (const k of ['type', 'freq', 'steep', 'level']) p[sd][k] = k === 'type' ? b[id(sd, k)] : Number(b[id(sd, k)]);
    rng.low = Number(b.ldrlow); rng.high = Number(b.ldrhigh);
    dirtySide.low = dirtySide.high = false;
    paintSideDots(); paintBands(); paintRange(); plot();
  });
  new ResizeObserver(draw).observe(svg.parentElement);
  showSide('low');
  paintBands();
  paintRange();
  plot();
  return { range: () => ({ ...rng }) };
}

/** Key glyphs, the Volume Range bar's (volume-range.js), so each mark is named beside its own shape. */
function keyGlyph(kind) {
  const shape = {
    lparen: s('path.paren', { d: 'M9,1 Q3,9 9,17' }),
    rparen: s('path.paren', { d: 'M5,1 Q11,9 5,17' }),
    needle: [s('line.nl', { x1: 7, x2: 7, y1: 1, y2: 13 }), s('circle.nd', { cx: 7, cy: 15.5, r: 2 })],
  }[kind];
  return s('svg.vrkey', { viewBox: '0 0 14 18', width: 14, height: 18, 'aria-hidden': 'true' }, shape);
}
