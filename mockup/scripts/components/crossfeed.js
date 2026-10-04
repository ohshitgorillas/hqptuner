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
import { grayReason, manPara, numBox } from '../lib/controls.js';
import { headGlyph, speakerGlyph } from '../lib/glyphs.js';
import { minus, plusMinus } from '../model/format.js';
import {
  bauerPlot, bauerSummary, crossfeedGray, geometryReadouts, listeningGeometry, structuralPreset, structuralSummary,
} from '../model/crossfeed.js';
import { ENGAGE_BYPASS } from '../data/matrix.js';

const OFF_REASON = 'Enable crossfeed to adjust.';   // v1 gray.js crossfeedOff
const S_TOL = { angle: 0.05, lambda: 0.005 };        // a slider's Structural values still read as their preset
const ID = { gate: 'xfgate', impl: 'xfimpl', preset: 'xfpreset', freq: 'xffreq', level: 'xflevel', comp: 'xfcomp', angle: 'xsangle', circ: 'xscirc', lambda: 'xslambda' };

/**
 * One mounted drawer: its state, staging setter, matrix-family environment and the elements the paint passes reach.
 *
 * @typedef {{ host: HTMLElement, cfg: any, st: any, set: (k: string, val: any) => void,
 *   env: { iir2fir: string, mxWhy: string }, [el: string]: any }} View
 */

/**
 * @param {HTMLElement} host
 * @param {object} cfg  CROSSFEED (data/matrix.js)
 * @param {{set:Function, init:Function, watch:Function}} ctx
 * @param {(v:object) => string} bypassed  gray reason from the family's values
 */
export function mountCrossfeed(host, cfg, ctx, bypassed) {
  const st = { gate: cfg.mode === 'off' ? '0' : '1', impl: cfg.mode === 'off' ? 'bauer' : cfg.mode, ...cfg.bauer, ...cfg.structural };
  for (const [k, id] of Object.entries(ID)) ctx.init(id, st[k]);
  const mode = () => (st.gate === '1' ? st.impl : 'off');
  ctx.init('xfmode', mode());   // what runs: off | bauer | structural (main.js reads it on Apply)
  /** @type {View} */
  const v = { host, cfg, st, env: { iir2fir: '0', mxWhy: '' },
    set: (k, val) => { st[k] = val; ctx.set(ID[k], val); if (k === 'gate' || k === 'impl') ctx.set('xfmode', mode()); } };
  Object.assign(v, controls(v));
  v.lines = buildLines(v);
  Object.assign(v, pictureHosts());
  host.append(
    h('div.xgate', {}, h('b', { text: 'Crossfeed' }), v.gateSeg, v.reason.el),
    h('div.chlist.xlist', { role: 'radiogroup', 'aria-label': 'Crossfeed implementation' }, v.lines.map((l) => l.el)),
    v.plotHost, v.diagHost);
  v.rp = mountRespPlot(v.plotHost, { lo: -15, hi: 3, step: 3, aria: 'Bauer crossfeed response' });

  // Discard (mock): the staged values go back; the picture follows.
  ctx.onDiscard((b) => {
    for (const [k, id] of Object.entries(ID)) st[k] = ['gate', 'impl', 'preset'].includes(k) ? b[id] : Number(b[id]);
    paintAll(v);
  });

  ctx.watch((vals) => {
    v.env.iir2fir = vals.mxiir2fir ?? '0';
    v.env.mxWhy = bypassed(vals);
    gray(v);
  });

  paintAll(v);
  return { mode, state: st };
}

// ── Controls ──────────────────────────────────────────────────────────

/**
 * The gate, Bauer's and Structural's controls, in mount order.
 *
 * @param {View} v
 */
function controls(v) {
  const { st, cfg } = v, M = cfg.man;
  const gateSeg = seg({ aria: 'Crossfeed', value: st.gate,
    options: ENGAGE_BYPASS,   // default leftmost
    onChange: (/** @type {string} */ x) => { v.set('gate', x); paintAll(v); } });

  // Bauer
  const presetSeg = seg({ aria: 'Preset', options: cfg.presets, value: st.preset,
    onChange: (/** @type {string} */ x) => { v.set('preset', x); paintAll(v); } });
  const freq = numField(v, 'freq', 'Frequency', 'Hz', 1, 300, 2000);
  const level = numField(v, 'level', 'Level', 'dB', 0.1, 1, 15);
  const custom = h('div.cgrp', {}, freq.el, level.el);
  const comp = slider(v, { k: 'comp', label: 'Crossfeed compensation', min: 0, max: 150, step: 1, unit: '%', dp: 0 });
  const tilt = h('span.cap');

  // Structural
  const sPreset = h('select.vfd.xspre', { 'aria-label': 'Preset' });
  sPreset.addEventListener('change', () => {
    const p = cfg.sPresets.find((/** @type {{ v: string }} */ x) => x.v === sPreset.value);
    if (p) { v.set('angle', p.angle); v.set('lambda', p.lambda); }
    paintAll(v);
  });
  const angle = slider(v, { k: 'angle', label: 'Speaker angle', min: 5, max: 60, step: 0.5, unit: '°', dp: 1 });
  const circ = slider(v, { k: 'circ', label: 'Head circumference', min: 41, max: 66, step: 0.25, unit: 'cm', dp: 2,
    sub: (/** @type {number} */ c) => `${(c / (2 * Math.PI)).toFixed(2)} cm radius` });
  const lambda = slider(v, { k: 'lambda', label: 'Center character', min: 0, max: 150, step: 1, unit: '%', dp: 0, mul: 100 });
  const conflict = h('span.gr', { hidden: true, text: M.linear });
  return { gateSeg, presetSeg, freq, level, custom, comp, tilt, sPreset, angle, circ, lambda, conflict };
}

/**
 * A labelled number box that stages its value on change.
 *
 * @param {View} v
 * @param {string} k
 * @param {string} label
 * @param {string} unit
 * @param {number} step
 * @param {number} min
 * @param {number} max
 */
function numField(v, k, label, unit, step, min, max) {
  const { el, input } = numBox({ step, min, max, aria: label, unit });
  input.addEventListener('change', () => { v.set(k, Number(input.value)); paintAll(v); });
  return { input, el: h('label.ci', {}, h('span.cl', { text: label }), el) };
}

/**
 * Slider + number box, one value (v1 SliderNumber): drag streams the picture, release stages. mul = shown per stored unit.
 *
 * @param {View} v
 * @param {{ k: string, label: string, min: number, max: number, step: number, unit: string, dp: number,
 *   sub?: (v: number) => string, mul?: number }} spec
 */
function slider(v, { k, label, min, max, step, unit, dp, sub, mul = 1 }) {
  const range = h('input', { type: 'range', min, max, step, 'aria-label': label });
  const { el: num, input: box } = numBox({ min, max, step, aria: label, unit });
  const subEl = sub && h('span.h', {});   // e.g. the radius the model works from, beside the label
  const show = (/** @type {number} */ x) => { range.value = x; box.value = Number(x).toFixed(dp); if (subEl) subEl.textContent = sub(x); };
  const paint = () => show(v.st[k] * mul);
  range.addEventListener('input', () => { v.st[k] = Number(range.value) / mul; show(Number(range.value)); picture(v); paintPreset(v); });
  const commit = (/** @type {number} */ x) => { v.set(k, Math.max(min, Math.min(max, x)) / mul); paintAll(v); };
  range.addEventListener('change', () => commit(Number(range.value)));
  box.addEventListener('change', () => commit(Number(box.value)));
  const el = h('div.xsl', {}, h('span.cl', {}, label, subEl), range, num);
  return { el, paint };
}

// ── Lines ─────────────────────────────────────────────────────────────

/**
 * The Bauer and Structural lines, each with its controls and copy.
 *
 * @param {View} v
 */
function buildLines(v) {
  const M = v.cfg.man;
  return [
    line(v, 'bauer', 'Bauer', [
      h('div.ci', {}, h('span.cl', { text: 'Preset' }), v.presetSeg),
      v.custom,
      h('div.ci', {}, v.comp.el, v.tilt, h('span.cap', { text: M.compScale })),
    ], paras([[null, M.bauer], ['Preset', M.preset], ['Frequency', M.freq], ['Level', M.level], ['Crossfeed compensation', M.comp]])),
    line(v, 'structural', 'Structural', [
      h('div.ci', {}, h('span.cl', { text: 'Preset' }), v.sPreset),
      v.angle.el, v.circ.el, v.lambda.el, v.conflict,
    ], paras([['Speaker angle', M.angle], ['Head circumference', M.circ], ['Center character', M.lambda]])),
  ];
}

/** @param {[string | null, string][]} list */
const paras = (list) => h('div.man', {}, list.map(([k, text]) => manPara({ k, text })));

/**
 * One implementation line: radio, name, folded summary, controls and copy.
 *
 * @param {View} v
 * @param {string} val
 * @param {string} label
 * @param {HTMLElement[]} ctl
 * @param {HTMLElement} copy
 */
function line(v, val, label, ctl, copy) {
  const radio = h('button.radio', { type: 'button', role: 'radio', 'aria-label': label, on: { click: () => pick(v, val) } });
  const sum = h('span.xsum');
  const body = h('div.xctl', {}, ctl);
  const el = h('div.chline.xline', { data: { v: val } },
    h('div.xleft', {},
      h('div.chl', {}, radio, h('span.chn', { on: { click: () => pick(v, val) } }, h('b', { text: label })), sum),
      body),
    copy);
  return { v: val, el, radio, sum, body, copy };
}

/**
 * @param {View} v
 * @param {string} val
 */
function pick(v, val) { if (val !== v.st.impl) { v.set('impl', val); paintAll(v); } }

/** The gray reason, the Bauer plot host and the Structural cartoon with its readouts. */
function pictureHosts() {
  const reason = grayReason();
  const plotHost = h('div.eq.xfplot');
  // Structural: no plot glass. v1's card layout: the cartoon drawn on the plate under the controls column, and v1's
  // three readouts (owner copy) beside it, where the copy column sits above.
  const diagram = s('svg.xfdiag', { role: 'img', 'aria-label': 'Top-down view: the simulated speakers, toed in toward the listener', viewBox: '52 6 296 172', preserveAspectRatio: 'xMidYMid meet' });
  const ro = (/** @type {string} */ label) => { const val = h('dd'), sub = h('span'); return { v: val, sub, el: h('div', {}, h('dt', { text: label }), h('dd', {}, val, sub)) }; };
  const RO = { itd: ro('Ear-to-ear delay'), far: ro('Far ear, treble'), center: ro('Center shift') };
  const diagHost = h('div.xfgeo', {}, h('div.xfpic', {}, diagram), h('dl.xfro', {}, Object.values(RO).map((r) => r.el)));
  return { reason, plotHost, diagram, RO, diagHost };
}

// ── Paint ─────────────────────────────────────────────────────────────

/** @param {View} v */
function paintPreset(v) {
  const { st, cfg, sPreset } = v;
  const m = structuralPreset(cfg.sPresets, st.angle, st.lambda, S_TOL);
  sPreset.replaceChildren(...cfg.sPresets.map((/** @type {{ v: string, label: string }} */ p) => h('option', { value: p.v, text: p.label })),
    !m && h('option', { value: 'custom', text: 'Custom' }));
  sPreset.value = m ? m.v : 'custom';
}

/** @param {View} v */
function paintAll(v) {
  const { st, cfg, lines } = v;
  select(v.gateSeg, st.gate);
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
  const b = bauerSummary(st, cfg.presets, BAUER_PRESETS);
  lines[0].sum.textContent = `${b.label} · ${b.fc} Hz · ${minus(b.feed, 1)} dB · ${b.comp}%`;
  const sm = structuralSummary(st, cfg.sPresets, S_TOL);
  lines[1].sum.textContent = `${sm.label || 'Custom'} · ${minus(sm.angle, 1)}° · ${minus(sm.circ, 2)} cm · ${sm.lambda}%`;
  select(v.presetSeg, st.preset);
  v.freq.input.value = st.freq; v.level.input.value = st.level;
  v.comp.paint(); v.angle.paint(); v.circ.paint(); v.lambda.paint();
  paintPreset(v);
  gray(v);
  picture(v);
}

/**
 * Gray: matrix bypassed → everything (family reason); crossfeed bypassed → the lines (v1 reason); Custom-only fields.
 *
 * @param {View} v
 */
function gray(v) {
  const { host, env } = v;
  const g = crossfeedGray(v.st, env.mxWhy, env.iir2fir);
  grayBut(host, v.reason.el, g.matrix);   // the reason stays legible: it links to the Matrix engine
  // Bypassed here: the implementations' controls gray; the Bauer | Structural pick stays live (a view choice, v1).
  for (const l of v.lines) l.body.classList.toggle('grayed', g.linesGrayed);
  for (const x of host.querySelectorAll('button,input,select')) {
    /** @type {any} */ (x).disabled = !(x.closest('.cgrp') ? g.custom : x.closest('.xctl') ? g.controls : g.gate);
  }
  v.custom.classList.toggle('grayed', g.customGrayed);
  v.reason.say(env.mxWhy || (g.off ? OFF_REASON : ''));
  v.conflict.hidden = !g.conflict;
}

/** @param {View} v */
function picture(v) {
  const bauer = v.st.impl === 'bauer';
  v.plotHost.hidden = !bauer;
  v.diagHost.hidden = bauer;
  if (bauer) drawBauer(v);
  else drawGeometry(v);
}

/** @param {View} v */
function drawBauer(v) {
  const { fc, feed, k, ghost, pct } = bauerPlot(v.st, BAUER_PRESETS);
  const mid = (/** @type {number} */ f) => toDb(bauerMS(fc, feed, f).mid);
  v.tilt.textContent = `crossfeed dulls the center by ${minus(-mid(20000), 1)} dB`;   // v1 Comp.js readout
  v.rp.draw([
    ghost && { cls: 'ghost', label: 'center, uncorrected', fn: mid },
    { label: ghost ? `center, corrected ${pct}%` : 'center, uncorrected', fn: (/** @type {number} */ f) => (1 - k) * mid(f) },
    { cls: 'side', label: 'stereo sides', fn: (/** @type {number} */ f) => toDb(bauerMS(fc, feed, f).side) },
  ].filter(Boolean));
}

/** @param {[number, number]} p */
const xy = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

// Top-down cartoon (v1 Geometry.js conventions), coordinates from model/crossfeed.js listeningGeometry.
/** @param {View} v */
function drawGeometry(v) {
  const { st } = v;
  const g = listeningGeometry(st.angle, st.circ);
  const { cx, cy, r, earL, earR, speakers: spk, arc } = g;
  // v1 Readouts: ITD (ray) · its low-frequency value (+ shadow-filter group delays), far-ear treble, center shift at λ.
  const ro = geometryReadouts(pathParams(st.angle, g.a / 100), st.lambda);
  v.RO.itd.v.textContent = `${ro.itd} µs`;
  v.RO.itd.sub.textContent = ` · ${ro.itdLow} µs at low frequencies`;
  v.RO.far.v.textContent = `${minus(ro.far, 1)} dB`;
  v.RO.center.v.textContent = `${plusMinus(ro.center, 2)} dB`;
  // Far path: speaker → tangent over the front of the head → around to the far ear.
  const far = (/** @type {typeof g.far[0]} */ p) => `M${xy(p.from)} L${xy(p.via)} A${r},${r} 0 0 ${p.sweep} ${xy(p.to)}`;
  v.diagram.replaceChildren(...[
    s('line.axis', g.axis),
    g.ref.map((l) => s('line.ref', l)),
    s('path.arc', { d: `M${arc.from[0]},${arc.from[1]} A${arc.r},${arc.r} 0 0 1 ${arc.to.map((x) => x.toFixed(1)).join(',')}` }),
    s('text.ang', { x: g.label[0], y: g.label[1], 'text-anchor': 'middle', text: `${minus(st.angle, 1)}°` }),
    // Far paths first (dashed, under), then near paths (solid).
    s('path.far', { d: far(g.far[0]) }),
    s('path.far', { d: far(g.far[1]) }),
    s('line.near', { x1: spk[0].p[0], y1: spk[0].p[1], x2: earL[0], y2: earL[1] }),
    s('line.near', { x1: spk[1].p[0], y1: spk[1].p[1], x2: earR[0], y2: earR[1] }),
    headGlyph(cx, cy, r, 6),
    s('rect.ear', { x: earL[0] - 3, y: cy - 5, width: 4, height: 10, rx: 1.5 }),
    s('rect.ear', { x: earR[0] - 1, y: cy - 5, width: 4, height: 10, rx: 1.5 }),
    spk.map(({ d, p }, i) => s('g.spk', {},
      speakerGlyph(p[0], p[1], d),
      s('text.sl', { x: p[0] + (i ? 18 : -18), y: p[1] + 4, 'text-anchor': i ? 'start' : 'end', text: i ? 'R' : 'L' }))),
  ].flat(2).filter(Boolean));
}
