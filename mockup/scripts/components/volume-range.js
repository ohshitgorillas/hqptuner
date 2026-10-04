// Volume range bar (Volume drawer, Range tab). HQPTuner v1's RangeBar on the faceplate:
// Min / Startup / Max on one shared dBFS axis, so the relationship three separate boxes never stated is drawn —
// the filled span between the brackets IS the range the engine will allow at runtime.
//
//   axis      −120 … +12 dBFS, linear (lib/volume.js AXIS_MIN / AXIS_MAX). Ticks every 10 dB to 0, plus +12;
//             numbers at −120 dB, −90, −60, −30, −3, 0, +12; heavy lines at 0 (limiter threshold) and −3
//             (recommended ceiling when resampling).
//   Min / Max brackets on the bar, arms pointing in at the span they enclose. Startup: hollow pin above the bar,
//             so it stays grabbable at Min or Max. Cannot cross: clampVolume (whole dB; Min ≤ 0; Max ≤ +12).
//   Loudness  bounds as parentheses + a strip inside the bar, shown while loudness is engaged. Reference only:
//             they are Loudness settings (one home per setting), edited in the Loudness drawer (the `Loudness ›` link opens it).
//   Needle    live playback volume (engine-row control); a readout, never a handle.
//
// Drag on the bar moves the nearest handle (the pin row prefers Startup); the boxes below take typed values.
// Edits stage (restore lane), so they mark the tab dirty through the drawer block context.
// Grays whole while Fixed volume is not Off (gray reason from the data, re-read on every drawer change).

import { h, s } from '../lib/dom.js';
import { scale } from '../lib/plate.js';
import { withXref } from '../lib/xref.js';

const PADX = 16;                       // track inset, room for the end labels
const Y = { pin: 3, bar: 30, barH: 14, tick: 56, label: 80, H: 86 };

const fmtDb = (d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);

/** v1 lib/volume.js clampVolume. */
function clampVolume(which, n, { min, startup, max }, axis) {
  n = Math.round(n);
  if (which === 'min') return Math.max(axis.min, Math.min(n, 0, startup, max));
  if (which === 'max') return Math.min(axis.max, Math.max(n, min, startup));
  return Math.max(min, Math.min(n, max));
}

/**
 * @param {HTMLElement} host   drawer block container
 * @param {object} cfg         VOLUME_RANGE
 * @param {{set:Function, init:Function, watch:Function}} ctx  drawer block context
 * @param {EventTarget} levelBus  'level' events {detail: dB} from the engine-row volume control
 */
export function mountVolumeRange(host, cfg, ctx, levelBus) {
  const { axis, loudness, ids } = cfg;
  const cur = { min: cfg.min, startup: cfg.startup, max: cfg.max };
  let level = cfg.level;
  let grayed = false;
  for (const k of ['min', 'startup', 'max']) ctx.init(ids[k], cur[k]);

  const svg = s('svg.vrbar', { role: 'img', 'aria-label': 'Volume range' });
  const well = h('div.vrwell', {}, svg);

  const box = (k, label, key) => {
    const input = h('input.vfd', { type: 'number', id: ids[k], step: 1, 'aria-label': label });
    input.addEventListener('change', () => move(k, Number(input.value)));
    return { input, el: h('label.vrbox', {}, keyGlyph(key), h('span.cl', { text: label }), input, h('span.u', { text: 'dBFS' })) };
  };
  const boxes = { min: box('min', 'Min', 'min'), startup: box('startup', 'Startup', 'pin'), max: box('max', 'Max', 'max') };

  // Every mark on the bar is named once, beside its own glyph: the volume marks in the box stack (Playback is a
  // live readout, not a box), the loudness bounds in their own row (read-only here; set in the Loudness drawer).
  const fmtLevel = (v) => (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(1);   // engine-row style, one decimal
  const levelOut = h('output.vfd.ro.live', { 'aria-label': 'Playback volume' });
  const readout = (key, label, out, unit) =>
    h('div.vrbox', {}, keyGlyph(key), h('span.cl', { text: label }), out, h('span.u', { text: unit }));
  const bound = (v) => h('output.vfd.ro', { text: fmtDb(v) });
  const lowOut = bound(loudness.low), highOut = bound(loudness.high);

  const reason = h('span.gr', { hidden: true });
  host.append(
    h('div.fh', {}, h('b', { text: cfg.label })),
    well,
    h('div.vrrow', {},
      h('div.vrctl', {},
        h('div.vrboxes', {}, boxes.min.el, boxes.startup.el, boxes.max.el, readout('needle', 'Playback', levelOut, 'dB')),
        reason),
      h('div.man', {}, cfg.man.map((m) => h('p', {}, h('b', { text: m.k }), ' — ', m.text))),
    ),
    // Loudness: reference + (dead) link out to its own drawer, where the bounds are set.
    h('div.vrrow.vrloud', {},
      h('div.vrctl', {},
        h('div.fh', {}, h('b', { text: 'Loudness bounds' }),
          h('a.xref', { href: '#', on: { click: (e) => { e.preventDefault(); cfg.openLoudness?.(); } } },
            'Loudness', h('span', { 'aria-hidden': 'true', text: ' ›' }))),
        h('div.vrboxes.inl', { hidden: !loudness.on },
          readout('lparen', 'Lower', lowOut, 'dBFS'),
          readout('rparen', 'Upper', highOut, 'dBFS')),
      ),
      h('div.man', {}, loudness.man.map((m) => h('p', {}, h('b', { text: m.k }), ' — ', m.text))),
    ),
  );

  // Drag: nearest handle; the pin row (above the bar) prefers Startup.
  let drag = null;
  const dbAt = (e) => {
    const r = svg.getBoundingClientRect();
    const k = scale();
    const x = (e.clientX - r.left) / k;
    const W = svg.clientWidth;
    return axis.min + (x - PADX) / (W - 2 * PADX) * (axis.max - axis.min);
  };
  svg.addEventListener('pointerdown', (e) => {
    if (grayed) return;
    const db = dbAt(e);
    const yTop = (e.clientY - svg.getBoundingClientRect().top) / scale();
    drag = yTop < Y.bar - 2 ? 'startup'
      : ['min', 'max', 'startup'].reduce((a, b) => (Math.abs(cur[b] - db) < Math.abs(cur[a] - db) ? b : a));
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('drag');
    move(drag, db);
  });
  svg.addEventListener('pointermove', (e) => { if (drag) move(drag, dbAt(e)); });
  const end = () => { drag = null; svg.classList.remove('drag'); draw(); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  // Discard (mock): the bounds and startup go back.
  ctx.onDiscard((b) => { for (const k of ['min', 'startup', 'max']) cur[k] = Number(b[ids[k]]); paint(); });

  function move(k, db) {
    const n = clampVolume(k, db, cur, axis);
    if (n !== cur[k]) { cur[k] = n; ctx.set(ids[k], n); }
    paint();
  }

  function paint() {
    for (const k of ['min', 'startup', 'max']) boxes[k].input.value = cur[k];
    boxes.min.input.min = axis.min; boxes.min.input.max = Math.min(0, cur.startup);
    boxes.startup.input.min = cur.min; boxes.startup.input.max = cur.max;
    boxes.max.input.min = cur.startup; boxes.max.input.max = axis.max;
    draw();
  }

  function draw() {
    const W = svg.clientWidth;
    if (!W) return;
    const x = (d) => Math.round((PADX + (W - 2 * PADX) * (d - axis.min) / (axis.max - axis.min)) * 2) / 2;
    const ticks = [];
    for (let d = axis.min; d <= 0; d += 10) ticks.push(d);
    ticks.push(-3, axis.max);
    const LABELS = new Map([[-120, '−120 dB'], [-90, '−90'], [-60, '−60'], [-30, '−30'], [-3, '−3'], [0, '0'], [axis.max, fmtDb(axis.max)]]);
    const weight = (d) => (d === 0 || d === -3 ? 'strong' : LABELS.has(d) ? 'major' : 'minor');
    const len = { minor: 5, major: 9, strong: 13 };
    const by = Y.bar, bh = Y.barH;

    const bracket = (d, dir, k) => {
      const xx = x(d), arm = 6 * dir;
      return s('path', { class: `brk ${drag === k ? 'act' : ''}`,
        d: `M${xx + arm},${by - 5} H${xx} V${by + bh + 5} H${xx + arm}` });
    };
    const paren = (d, dir) => {
      const xx = x(d), bow = 5 * dir;
      return s('path.paren', { d: `M${xx},${by - 7} Q${xx - bow},${by + bh / 2} ${xx},${by + bh + 7}` });
    };
    const px = x(cur.startup);

    svg.setAttribute('viewBox', `0 0 ${W} ${Y.H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', Y.H);
    svg.replaceChildren(...[
      s('rect.trk', { x: PADX - 3, y: by, width: W - 2 * PADX + 6, height: bh, rx: 3 }),
      s('rect.span', { x: x(cur.min), y: by, width: Math.max(0, x(cur.max) - x(cur.min)), height: bh }),
      loudness.on && [
        s('rect.lband', { x: x(loudness.low), y: by + bh - 4, width: x(loudness.high) - x(loudness.low), height: 3 }),
        paren(loudness.low, 1), paren(loudness.high, -1),
      ],
      ticks.map((d) => s('line', { class: `tk ${weight(d)}`, x1: x(d), x2: x(d), y1: Y.tick, y2: Y.tick + len[weight(d)] })),
      [...LABELS].map(([d, t]) => s('text.tl', { x: x(d), y: Y.label,
        'text-anchor': d === axis.min ? 'start' : d === axis.max ? 'end' : 'middle', text: t })),
      level !== null && s('g.needle', {},
        s('line', { x1: x(level), x2: x(level), y1: by - 3, y2: by + bh + 3 }),
        s('circle', { cx: x(level), cy: by + bh + 7, r: 2.5 })),
      bracket(cur.min, 1, 'min'), bracket(cur.max, -1, 'max'),
      s('path', { class: `pin ${drag === 'startup' ? 'act' : ''}`,
        d: `M${px - 6},${Y.pin + 3} Q${px - 6},${Y.pin} ${px - 3},${Y.pin} H${px + 3} Q${px + 6},${Y.pin} ${px + 6},${Y.pin + 3} V${Y.pin + 14} L${px},${Y.pin + 21} L${px - 6},${Y.pin + 14} Z` }),
      drag && s('text.bub', { x: x(cur[drag]), y: Y.label, 'text-anchor': 'middle', text: `${fmtDb(cur[drag])} dBFS` }),
    ].flat(2).filter(Boolean));   // native replaceChildren doesn't flatten or skip falsy
  }

  ctx.watch((vals) => {
    const why = cfg.gray(vals);
    grayed = !!why;
    host.classList.toggle('grayed-range', grayed);
    for (const b of Object.values(boxes)) b.input.disabled = grayed;
    reason.replaceChildren(...withXref(why));
    reason.hidden = !why;
  });

  const paintLevel = () => { levelOut.textContent = level === null ? '—' : fmtLevel(level); };
  levelBus.addEventListener('level', (e) => { level = e.detail; paintLevel(); draw(); });
  // Loudness applied (Loudness drawer, mock Apply): the bounds and their visibility follow.
  levelBus.addEventListener('loudness', () => {
    lowOut.textContent = fmtDb(loudness.low); highOut.textContent = fmtDb(loudness.high);
    host.querySelector('.vrloud .vrboxes').hidden = !loudness.on;
    draw();
  });
  paintLevel();
  new ResizeObserver(draw).observe(well);
  paint();
}

/** Small key glyphs shared by the boxes and the legend, so each mark is named where it's typed. */
function keyGlyph(kind) {
  const shape = {
    min: s('path.brk', { d: 'M9,2 H4 V16 H9' }),
    max: s('path.brk', { d: 'M5,2 H10 V16 H5' }),
    pin: s('path.pin', { d: 'M4,4 Q4,2 6,2 H8 Q10,2 10,4 V11 L7,15 L4,11 Z' }),
    lparen: s('path.paren', { d: 'M9,1 Q3,9 9,17' }),
    rparen: s('path.paren', { d: 'M5,1 Q11,9 5,17' }),
    needle: [s('line.nl', { x1: 7, x2: 7, y1: 1, y2: 13 }), s('circle.nd', { cx: 7, cy: 15.5, r: 2 })],
  }[kind];
  return s('svg.vrkey', { viewBox: '0 0 14 18', width: 14, height: 18, 'aria-hidden': 'true' }, shape);
}
