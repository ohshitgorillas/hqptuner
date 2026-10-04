// Crossfeed drawer body.
//   Gate       ENGAGE | BYPASS (v1's crossfeed gate; stage gates are ENGAGE | BYPASS). It acts on
//              whichever implementation is picked below.
//   Lines      Bauer | Structural, one picked (Volume's choice grammar); the unpicked one folds to one summary line (the
//              Resampling · Shaping bar grammar) so the drawer never scrolls. Picking a line is a view choice in v1's
//              sense: it switches the implementation, it never engages crossfeed by itself.
//     Bauer      HQPlayer's post-process (libbs2b): Preset, Frequency + Level (live only on Custom, manual §7), and v1's
//                Crossfeed compensation (0–150 %: the center path's treble tilt brought back toward neutral).
//     Structural HQPTuner's sixteen-pipeline block (v1 docs/crossfeed-math.md): Preset, Speaker angle, Head circumference,
//                Center character. Its copy is v1's (owner copy).
//   Under the lines, filling the height left:
//     Bauer      response plot, traces named beside their lines (v1 trace names).
//     Structural v1's top-down cartoon (xfeed/Geometry.js conventions): speakers toed in at ±angle, head sized by the
//                circumference, solid = each ear's near path, dashed = the far path crossfeed synthesizes, ±30° reference
//                ticks, drawn on the plate (no plot glass) under the controls, with v1's readouts beside it.
// Everything stages (restore lane) through the drawer block context. Grays whole while the matrix engine is bypassed;
// the lines gray with v1's `Enable crossfeed to adjust.` while bypassed here.

import { h, s, grayBut } from '../lib/dom.js';
import { seg, select } from './seg.js';
import { mountRespPlot } from './resp-plot.js';
import { BAUER_PRESETS, bauerMS, pathParams, toDb } from '../lib/xdsp.js';
import { withXref } from '../lib/xref.js';

const fmt = (v, d = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const OFF_REASON = 'Enable crossfeed to adjust.';   // v1 gray.js crossfeedOff

/**
 * @param {HTMLElement} host
 * @param {object} cfg  CROSSFEED (data/matrix.js)
 * @param {{set:Function, init:Function, watch:Function}} ctx
 * @param {(v:object) => string} bypassed  gray reason from the family's values
 */
export function mountCrossfeed(host, cfg, ctx, bypassed) {
  const st = { gate: cfg.mode === 'off' ? '0' : '1', impl: cfg.mode === 'off' ? 'bauer' : cfg.mode, ...cfg.bauer, ...cfg.structural };
  const ID = { gate: 'xfgate', impl: 'xfimpl', preset: 'xfpreset', freq: 'xffreq', level: 'xflevel', comp: 'xfcomp', angle: 'xsangle', circ: 'xscirc', lambda: 'xslambda' };
  for (const [k, id] of Object.entries(ID)) ctx.init(id, st[k]);
  const mode = () => (st.gate === '1' ? st.impl : 'off');
  ctx.init('xfmode', mode());   // what runs: off | bauer | structural (main.js reads it on Apply)
  let iir2fir = '0', mxWhy = '';
  const M = cfg.man;

  const set = (k, v) => { st[k] = v; ctx.set(ID[k], v); if (k === 'gate' || k === 'impl') ctx.set('xfmode', mode()); };

  // ── Controls ──────────────────────────────────────────────────────────
  /** Slider + number box, one value (v1 SliderNumber): drag streams the picture, release stages. mul = shown per stored unit. */
  function slider({ k, label, min, max, step, unit, dp, sub, mul = 1 }) {
    const range = h('input', { type: 'range', min, max, step, 'aria-label': label });
    const box = h('input.vfd', { type: 'number', min, max, step, 'aria-label': label });
    const subEl = sub && h('span.h', {});   // e.g. the radius the model works from, beside the label
    const show = (v) => { range.value = v; box.value = Number(v).toFixed(dp); if (subEl) subEl.textContent = sub(v); };
    const paint = () => show(st[k] * mul);
    range.addEventListener('input', () => { st[k] = Number(range.value) / mul; show(Number(range.value)); picture(); paintPreset(); });
    const commit = (v) => { set(k, Math.max(min, Math.min(max, v)) / mul); paintAll(); };
    range.addEventListener('change', () => commit(Number(range.value)));
    box.addEventListener('change', () => commit(Number(box.value)));
    const el = h('div.xsl', {}, h('span.cl', {}, label, subEl), range, h('div.num', {}, box, h('span.u', { text: unit })));
    return { el, paint };
  }

  const gateSeg = seg({ aria: 'Crossfeed', value: st.gate,
    options: [{ v: '0', label: 'Bypass' }, { v: '1', label: 'Engage' }],   // default leftmost
    onChange: (v) => { set('gate', v); paintAll(); } });

  // Bauer
  const presetSeg = seg({ aria: 'Preset', options: cfg.presets, value: st.preset,
    onChange: (v) => { set('preset', v); paintAll(); } });
  const num = (k, label, unit, step, min, max) => {
    const input = h('input.vfd', { type: 'number', step, min, max, 'aria-label': label });
    input.addEventListener('change', () => { set(k, Number(input.value)); paintAll(); });
    return { input, el: h('label.ci', {}, h('span.cl', { text: label }), h('div.num', {}, input, h('span.u', { text: unit }))) };
  };
  const freq = num('freq', 'Frequency', 'Hz', 1, 300, 2000);
  const level = num('level', 'Level', 'dB', 0.1, 1, 15);
  const custom = h('div.cgrp', {}, freq.el, level.el);
  const comp = slider({ k: 'comp', label: 'Crossfeed compensation', min: 0, max: 150, step: 1, unit: '%', dp: 0 });
  const tilt = h('span.cap');

  // Structural
  const sPreset = h('select.vfd.xspre', { 'aria-label': 'Preset' });
  sPreset.addEventListener('change', () => {
    const p = cfg.sPresets.find((x) => x.v === sPreset.value);
    if (p) { set('angle', p.angle); set('lambda', p.lambda); }
    paintAll();
  });
  const angle = slider({ k: 'angle', label: 'Speaker angle', min: 5, max: 60, step: 0.5, unit: '°', dp: 1 });
  const circ = slider({ k: 'circ', label: 'Head circumference', min: 41, max: 66, step: 0.25, unit: 'cm', dp: 2,
    sub: (c) => `${(c / (2 * Math.PI)).toFixed(2)} cm radius` });
  const lambda = slider({ k: 'lambda', label: 'Center character', min: 0, max: 150, step: 1, unit: '%', dp: 0, mul: 100 });
  const conflict = h('span.gr', { hidden: true, text: M.linear });

  // ── Lines ─────────────────────────────────────────────────────────────
  const paras = (list) => h('div.man', {}, list.map(([k, t]) => h('p', {}, k && h('b', { text: k }), k && ' — ', t)));
  const line = (v, label, controls, copy) => {
    const radio = h('button.radio', { type: 'button', role: 'radio', 'aria-label': label, on: { click: () => pick(v) } });
    const sum = h('span.xsum');
    const body = h('div.xctl', {}, controls);
    const el = h('div.chline.xline', { data: { v } },
      h('div.xleft', {},
        h('div.chl', {}, radio, h('span.chn', { on: { click: () => pick(v) } }, h('b', { text: label })), sum),
        body),
      copy);
    return { v, el, radio, sum, body, copy };
  };
  const lines = [
    line('bauer', 'Bauer', [
      h('div.ci', {}, h('span.cl', { text: 'Preset' }), presetSeg),
      custom,
      h('div.ci', {}, comp.el, tilt, h('span.cap', { text: M.compScale })),
    ], paras([[null, M.bauer], ['Preset', M.preset], ['Frequency', M.freq], ['Level', M.level], ['Crossfeed compensation', M.comp]])),
    line('structural', 'Structural', [
      h('div.ci', {}, h('span.cl', { text: 'Preset' }), sPreset),
      angle.el, circ.el, lambda.el, conflict,
    ], paras([['Speaker angle', M.angle], ['Head circumference', M.circ], ['Center character', M.lambda]])),
  ];
  const reason = h('span.gr', { hidden: true });
  const plotHost = h('div.eq.xfplot');
  // Structural: no plot glass. v1's card layout: the cartoon drawn on the plate under the controls column, and v1's
  // three readouts (owner copy) beside it, where the copy column sits above.
  const diagram = s('svg.xfdiag', { role: 'img', 'aria-label': 'Top-down view: the simulated speakers, toed in toward the listener', viewBox: '52 6 296 172', preserveAspectRatio: 'xMidYMid meet' });
  const ro = (label) => { const v = h('dd'), sub = h('span'); return { v, sub, el: h('div', {}, h('dt', { text: label }), h('dd', {}, v, sub)) }; };
  const RO = { itd: ro('Ear-to-ear delay'), far: ro('Far ear, treble'), center: ro('Center shift') };
  const diagHost = h('div.xfgeo', {}, h('div.xfpic', {}, diagram), h('dl.xfro', {}, Object.values(RO).map((r) => r.el)));
  host.append(
    h('div.xgate', {}, h('b', { text: 'Crossfeed' }), gateSeg, reason),
    h('div.chlist.xlist', { role: 'radiogroup', 'aria-label': 'Crossfeed implementation' }, lines.map((l) => l.el)),
    plotHost, diagHost);
  const rp = mountRespPlot(plotHost, { lo: -15, hi: 3, step: 3, aria: 'Bauer crossfeed response' });

  function pick(v) { if (v !== st.impl) { set('impl', v); paintAll(); } }

  // ── Paint ─────────────────────────────────────────────────────────────
  const bauerFc = () => (st.preset === 'custom' ? [st.freq, st.level] : BAUER_PRESETS[st.preset]);
  const sMatch = () => cfg.sPresets.find((p) => Math.abs(p.angle - st.angle) < 0.05 && Math.abs(p.lambda - st.lambda) < 0.005);
  const presetName = (v) => cfg.presets.find((p) => p.v === v).label;

  function paintPreset() {
    const m = sMatch();
    sPreset.replaceChildren(...cfg.sPresets.map((p) => h('option', { value: p.v, text: p.label })),
      !m && h('option', { value: 'custom', text: 'Custom' }));
    sPreset.value = m ? m.v : 'custom';
  }

  function paintAll() {
    select(gateSeg, st.gate);
    for (const l of lines) {
      const on = l.v === st.impl;
      l.el.classList.toggle('cur', on);
      l.el.classList.toggle('fold', !on);
      l.radio.setAttribute('aria-checked', String(on));
      l.body.hidden = !on;
      l.copy.hidden = !on;
      l.sum.hidden = on;
    }
    // Folded summaries: what the line would install (engine names / numbers, no new words).
    const [fc, fd] = bauerFc();
    lines[0].sum.textContent = `${presetName(st.preset)} · ${fc} Hz · ${fmt(fd)} dB · ${Math.round(st.comp)}%`;
    lines[1].sum.textContent = `${sMatch()?.label || 'Custom'} · ${fmt(st.angle)}° · ${fmt(st.circ, 2)} cm · ${Math.round(st.lambda * 100)}%`;
    select(presetSeg, st.preset);
    freq.input.value = st.freq; level.input.value = st.level;
    comp.paint(); angle.paint(); circ.paint(); lambda.paint();
    paintPreset();
    gray();
    picture();
  }

  /** Gray: matrix bypassed → everything (family reason); crossfeed bypassed → the lines (v1 reason); Custom-only fields. */
  function gray() {
    const off = st.gate === '0';
    const why = mxWhy || (off ? OFF_REASON : '');
    grayBut(host, reason, !!mxWhy);   // the reason stays legible: it links to the Matrix engine
    // Bypassed here: the implementations' controls gray; the Bauer | Structural pick stays live (a view choice, v1).
    for (const l of lines) l.body.classList.toggle('grayed', off && !mxWhy);
    for (const x of host.querySelectorAll('button,input,select')) {
      const inCtl = x.closest('.xctl');
      x.disabled = !!mxWhy || (!!inCtl && off) || (!!x.closest('.cgrp') && st.preset !== 'custom');
    }
    custom.classList.toggle('grayed', st.preset !== 'custom');
    reason.replaceChildren(...withXref(why)); reason.hidden = !why;
    conflict.hidden = !(st.impl === 'structural' && iir2fir === '2');
  }

  function picture() {
    const bauer = st.impl === 'bauer';
    plotHost.hidden = !bauer;
    diagHost.hidden = bauer;
    if (bauer) {
      const [fc, feed] = bauerFc();
      const k = st.comp / 100;
      tilt.textContent = `crossfeed dulls the center by ${fmt(-toDb(bauerMS(fc, feed, 20000).mid))} dB`;   // v1 Comp.js readout
      rp.draw([
        k > 0 && { cls: 'ghost', label: 'center, uncorrected', fn: (f) => toDb(bauerMS(fc, feed, f).mid) },
        { label: k > 0 ? `center, corrected ${Math.round(st.comp)}%` : 'center, uncorrected', fn: (f) => (1 - k) * toDb(bauerMS(fc, feed, f).mid) },
        { cls: 'side', label: 'stereo sides', fn: (f) => toDb(bauerMS(fc, feed, f).side) },
      ].filter(Boolean));
    } else {
      drawGeometry();
    }
  }

  // Top-down cartoon (v1 Geometry.js conventions). Listener low and facing up; speaker distance fixed (angle is the
  // variable); head radius mapped across a narrow band so 41–66 cm reads without the head becoming a boulder.
  function drawGeometry() {
    const CX = 200, CY = 140, R = 112;
    const a = st.circ / (2 * Math.PI);                        // cm radius, ~6.5–10.5
    const r = 15 + (Math.max(6.5, Math.min(10.5, a)) - 6.5) * 2.5;
    const rad = (d) => d * Math.PI / 180;
    const at = (deg, rr) => [CX + rr * Math.sin(rad(deg)), CY - rr * Math.cos(rad(deg))];
    const earL = [CX - r, CY], earR = [CX + r, CY];
    const spk = [-st.angle, st.angle].map((d) => ({ d, p: at(d, R) }));
    // Far path: speaker → tangent over the front of the head → around to the far ear.
    const farPath = (P, ear, side) => {
      const dx = P[0] - CX, dy = P[1] - CY, d = Math.hypot(dx, dy);
      const phi = Math.atan2(dy, dx), al = Math.acos(r / d);
      const t = [phi + al, phi - al].map((q) => [CX + r * Math.cos(q), CY + r * Math.sin(q)])
        .sort((u, v) => u[1] - v[1])[0];                     // the tangent point on the front (upper) side
      return `M${P[0].toFixed(1)},${P[1].toFixed(1)} L${t[0].toFixed(1)},${t[1].toFixed(1)} A${r},${r} 0 0 ${side} ${ear[0].toFixed(1)},${ear[1].toFixed(1)}`;
    };
    const ref = [-30, 30].map((d) => { const [x1, y1] = at(d, R - 16), [x2, y2] = at(d, R + 16); return s('line.ref', { x1, y1, x2, y2 }); });
    const [ax, ay] = at(st.angle / 2, 54);   // label beyond the arc, clear of the near path
    // v1 Readouts: ITD (ray) · its low-frequency value (+ shadow-filter group delays), far-ear treble, center shift at λ.
    const pp = pathParams(st.angle, a / 100);
    RO.itd.v.textContent = `${Math.round(pp.itd * 1e6)} µs`;
    RO.itd.sub.textContent = ` · ${Math.round((pp.itd + pp.gdF - pp.gdN) * 1e6)} µs at low frequencies`;
    RO.far.v.textContent = `${fmt(20 * Math.log10(pp.af))} dB`;
    const cs = 20 * Math.log10(st.lambda * (pp.an + pp.af) / 2 + (1 - st.lambda));
    RO.center.v.textContent = `${cs >= 0 ? '+' : '−'}${Math.abs(cs).toFixed(2)} dB`;
    diagram.replaceChildren(...[
      s('line.axis', { x1: CX, y1: CY - r, x2: CX, y2: CY - R - 14 }),
      ref,
      s('path.arc', { d: `M${CX},${CY - 40} A40,40 0 0 1 ${at(st.angle, 40).map((v) => v.toFixed(1)).join(',')}` }),
      s('text.ang', { x: ax, y: ay, 'text-anchor': 'middle', text: `${fmt(st.angle)}°` }),
      // Far paths first (dashed, under), then near paths (solid).
      s('path.far', { d: farPath(spk[0].p, earR, 1) }),
      s('path.far', { d: farPath(spk[1].p, earL, 0) }),
      s('line.near', { x1: spk[0].p[0], y1: spk[0].p[1], x2: earL[0], y2: earL[1] }),
      s('line.near', { x1: spk[1].p[0], y1: spk[1].p[1], x2: earR[0], y2: earR[1] }),
      s('circle.head', { cx: CX, cy: CY, r }),
      s('path.nose', { d: `M${CX - 4},${CY - r + 1} L${CX},${CY - r - 6} L${CX + 4},${CY - r + 1}` }),
      s('rect.ear', { x: CX - r - 3, y: CY - 5, width: 4, height: 10, rx: 1.5 }),
      s('rect.ear', { x: CX + r - 1, y: CY - 5, width: 4, height: 10, rx: 1.5 }),
      spk.map(({ d, p }, i) => s('g.spk', {},
        s('g', { transform: `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) rotate(${d})` },
          s('rect', { x: -10, y: -8, width: 20, height: 16, rx: 2 }), s('circle.drv', { cx: 0, cy: 3.5, r: 3 })),
        s('text.sl', { x: p[0] + (i ? 18 : -18), y: p[1] + 4, 'text-anchor': i ? 'start' : 'end', text: i ? 'R' : 'L' }))),
    ].flat(2).filter(Boolean));
  }

  // Discard (mock): the staged values go back; the picture follows.
  ctx.onDiscard((b) => {
    for (const [k, id] of Object.entries(ID)) st[k] = ['gate', 'impl', 'preset'].includes(k) ? b[id] : Number(b[id]);
    paintAll();
  });

  ctx.watch((v) => {
    iir2fir = v.mxiir2fir ?? '0';
    mxWhy = bypassed(v);
    gray();
  });

  paintAll();
  return { mode, state: st };
}
