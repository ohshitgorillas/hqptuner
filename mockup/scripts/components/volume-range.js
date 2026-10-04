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
import { withXref } from '../lib/xref.js';
import { paintSvg, signedDb as fmtDb } from '../lib/gauge.js';
import { barMarks, bindBar, fmtLevel, rangeBox, readout } from '../lib/range-bar.js';
import { clampVolume, pickVolumeHandle, tickMarks, ticksEvery } from '../model/range-axis.js';

const PADX = 16;                       // track inset, room for the end labels
const Y = { pin: 3, bar: 30, barH: 14, tick: 56, label: 80, H: 86 };

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

  const box = (k, label, key) => rangeBox(label, key, { id: ids[k] }, (v) => move(k, v));
  const boxes = { min: box('min', 'Min', 'min'), startup: box('startup', 'Startup', 'pin'), max: box('max', 'Max', 'max') };

  // Every mark on the bar is named once, beside its own glyph: the volume marks in the box stack (Playback is a
  // live readout, not a box), the loudness bounds in their own row (read-only here; set in the Loudness drawer).
  const levelOut = h('output.vfd.ro.live', { 'aria-label': 'Playback volume' });
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
  const BAR = { axis, padX: PADX, Y };
  const LABELS = new Map([[-120, '−120 dB'], [-90, '−90'], [-60, '−60'], [-30, '−30'], [-3, '−3'], [0, '0'], [axis.max, fmtDb(axis.max)]]);
  const MARKS = tickMarks([...ticksEvery(axis.min, 0, 10), -3, axis.max], LABELS, [0, -3]);
  const bar = bindBar(svg, { ...BAR, blocked: () => grayed, pick: (db, yTop) => pickVolumeHandle(db, yTop, cur, Y.bar - 2),
    move, draw, grab: () => svg.classList.add('drag'), drop: () => svg.classList.remove('drag') });

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
    const m = barMarks(W, BAR);
    const { x } = m;
    const by = Y.bar, bh = Y.barH;
    const drag = bar.key;

    const bracket = (d, dir, k) => {
      const xx = x(d), arm = 6 * dir;
      return s('path', { class: `brk ${drag === k ? 'act' : ''}`,
        d: `M${xx + arm},${by - 5} H${xx} V${by + bh + 5} H${xx + arm}` });
    };
    const px = x(cur.startup);

    paintSvg(svg, W, Y.H, [
      m.track(),
      m.span('span', cur.min, cur.max),
      loudness.on && [
        s('rect.lband', { x: x(loudness.low), y: by + bh - 4, width: x(loudness.high) - x(loudness.low), height: 3 }),
        m.paren(loudness.low, 1, 'paren'), m.paren(loudness.high, -1, 'paren'),
      ],
      m.ticks(MARKS, 'minor'),
      m.labels(LABELS),
      level !== null && m.needle(level),
      bracket(cur.min, 1, 'min'), bracket(cur.max, -1, 'max'),
      s('path', { class: `pin ${drag === 'startup' ? 'act' : ''}`,
        d: `M${px - 6},${Y.pin + 3} Q${px - 6},${Y.pin} ${px - 3},${Y.pin} H${px + 3} Q${px + 6},${Y.pin} ${px + 6},${Y.pin + 3} V${Y.pin + 14} L${px},${Y.pin + 21} L${px - 6},${Y.pin + 14} Z` }),
      drag && m.bubble(cur[drag]),
    ]);
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
  paint();
}
