// Output rate dial: one tuner glass, two bands. See drawer.css for the visual rules.
//
// Tiers are octaves 1x … 2048x, evenly spaced on one axis: 32x PCM (1.536 MHz) to 64x SDM (3.072 MHz) is just the
// next octave, so the glass is continuous. It carries two settings, though (PCM limit defaults_samplerate, SDM limit
// defaults_bitrate), so each band has its own needle, confined to its band: the 32x|64x seam is a hard stop.
// Bands are told apart by an engraved legend over each, a bezel seam, and units (kHz left, MHz right).
// Both bands are always settable, whatever the output mode (set the PCM rate before switching
// to PCM). Hatched = device announced it cannot carry the tier.
// Green lamp = the rate running now (only ever one).
//
// Each band is its own slider (a transparent region over its half): drag / tap a tier, ←/→ (↓/↑) step, Home/End.
// Layers: hatch → seam → band legends → rule + minor ticks → needles → tier printing → playing lamp → band sliders.

import { h, s } from '../lib/dom.js';
import { hatchDefs } from '../lib/glyphs.js';
import { tierIndex } from '../model/output.js';

const W = 806;          // viewBox width = the Format row at the 1080 plate, so the printing is 1:1
const H = 106;
const X0 = 38;          // x of the first tier
const RULE_Y = 56;
const BANDS = [
  { id: 'pcm', legend: 'PCM' },
  { id: 'sdm', legend: 'SDM (DSD)' },
];

/**
 * @param {HTMLElement} dial  empty .dial
 * @param {{tiers:object[], limits:{pcm:number,sdm:number}, playing:number}} cfg
 * @param {() => void} onChange
 */
export function mountRateDial(dial, { tiers, limits, playing }, onChange) {
  const DX = (W - 2 * X0) / (tiers.length - 1);
  const xs = tiers.map((_, i) => X0 + i * DX);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, 'aria-hidden': 'true' });
  dial.append(svg);
  const add = (el, parent = svg) => (parent.append(el), el);

  const span = (b) => {
    const idx = tierIndex(tiers, b);
    return { lo: idx[0], hi: idx[idx.length - 1] };
  };
  const seamX = (xs[span('pcm').hi] + xs[span('sdm').lo]) / 2;

  // Layer 1: hatch behind unavailable tiers
  add(hatchDefs('hatch', { pattern: 'hatch' }));
  tiers.forEach((t, i) => t.unavailable && add(s('rect', { x: xs[i] - DX / 2, y: 0, width: DX, height: H, fill: 'url(#hatch)' })));

  // Layer 2: bezel seam between the bands
  add(s('g.seam', {}, s('line.sd', { x1: seamX, y1: 0, x2: seamX, y2: H }), s('line.sl', { x1: seamX + 1.5, y1: 0, x2: seamX + 1.5, y2: H })));

  // Per band: legend, rule, ticks, needle, printing.
  const state = {};
  for (const b of BANDS) {
    const { lo, hi } = span(b.id);
    const g = add(s('g.band', { data: { band: b.id } }));
    const x1 = xs[lo] - DX / 2 + 8, x2 = xs[hi] + DX / 2 - 8;

    // Legend: engraved name over a bracket spanning the band.
    add(s('path.bl', { d: `M${x1},20 V14 H${x2} V20` }), g);
    add(s('text.legend', { x: (x1 + x2) / 2, y: 18, 'text-anchor': 'middle', text: b.legend }), g);

    // Rule + quarter-step minor ticks, within the band
    add(s('line.rule', { x1: x1, y1: RULE_Y, x2: x2, y2: RULE_Y }), g);
    for (let x = xs[lo] - DX / 2 + DX / 4; x < x2; x += DX / 4) {
      if (x > x1 && !xs.some((t) => Math.abs(t - x) < 1)) add(s('line.minor', { x1: x, y1: RULE_Y - 5, x2: x, y2: RULE_Y }), g);
    }

    // Needle (behind the scale printing, like a real tuner glass)
    const needle = add(s('g.ndl', {}, s('rect.needle', { x: -1.25, y: 26, width: 2.5, height: 64, rx: 1 })), g);

    // Tier printing
    const marks = [];
    for (let i = lo; i <= hi; i++) {
      const t = tiers[i];
      marks.push(add(s('g', { class: t.unavailable ? 'unav' : null, data: { i } },
        s('line.major', { x1: xs[i], y1: RULE_Y - 12, x2: xs[i], y2: RULE_Y }),
        s('text.tier', { x: xs[i], y: 38, 'text-anchor': 'middle', text: t.name }),
        s('text.freq', { x: xs[i], y: 71, 'text-anchor': 'middle', text: `${t.f44} ${t.unit}` }),
        s('text.freq', { x: xs[i], y: 83, 'text-anchor': 'middle', text: `${t.f48} ${t.unit}` }),
        t.unavailable && s('text.note', { x: xs[i], y: 99, 'text-anchor': 'middle', text: 'unavailable' }),
      ), g));
    }

    // The band's slider: a transparent region over its half of the glass.
    const left = b.id === 'pcm' ? 0 : seamX / W * 100;
    const width = b.id === 'pcm' ? seamX / W * 100 : 100 - seamX / W * 100;
    const el = h('div.bandsl', {
      role: 'slider', tabindex: 0, style: `left:${left}%;width:${width}%`,
      'aria-label': `${b.legend} rate`, 'aria-valuemin': lo, 'aria-valuemax': hi,
    });
    dial.append(el);
    state[b.id] = { lo, hi, cur: limits[b.id], needle, marks, el };
  }

  // Playing lamp (above the bands; the running rate is one tier, whichever band it is in)
  const lamp = add(s('circle.playing', { cx: xs[playing], cy: 96, r: 3.5 }));
  // Mock scenario: the lamp moves to the tier playing now, and goes out when nothing plays (null).
  dial._setPlaying = (i) => { lamp.style.display = i == null ? 'none' : ''; if (i != null) lamp.setAttribute('cx', xs[i]); };

  function set(b, i, fromUser) {
    const st = state[b];
    i = Math.max(st.lo, Math.min(st.hi, i));
    const moved = i !== st.cur;
    st.cur = i;
    st.needle.style.transform = `translateX(${xs[i]}px)`;
    st.marks.forEach((m) => m.classList.toggle('sel', Number(m.dataset.i) === i));
    st.el.setAttribute('aria-valuenow', i);
    st.el.setAttribute('aria-valuetext', tiers[i].name + (tiers[i].unavailable ? ', unavailable' : ''));
    if (moved && fromUser) onChange();
  }

  const tierAt = (e) => {
    const r = svg.getBoundingClientRect();
    return Math.round(((e.clientX - r.left) / r.width * W - X0) / DX);
  };

  const KEYS = {
    ArrowLeft: (c) => c - 1, ArrowDown: (c) => c - 1,
    ArrowRight: (c) => c + 1, ArrowUp: (c) => c + 1,
    Home: (c, st) => st.lo, End: (c, st) => st.hi,
  };

  for (const b of Object.keys(state)) {
    const st = state[b];
    let dragging = false;
    st.el.addEventListener('pointerdown', (e) => {
      dragging = true;
      dial.classList.add('drag');
      st.el.setPointerCapture(e.pointerId);
      set(b, tierAt(e), true);
    });
    st.el.addEventListener('pointermove', (e) => { if (dragging) set(b, tierAt(e), true); });
    const up = () => { dragging = false; dial.classList.remove('drag'); };
    st.el.addEventListener('pointerup', up);
    st.el.addEventListener('pointercancel', up);
    st.el.addEventListener('keydown', (e) => {
      if (!KEYS[e.key]) return;
      e.preventDefault();
      set(b, KEYS[e.key](st.cur, st), true);
    });
  }

  for (const b of Object.keys(state)) set(b, state[b].cur, false);
  // Discard (mock): the drawer reads both limits as one value and puts them back.
  return {
    value: () => `${state.pcm.cur}|${state.sdm.cur}`,
    setValue: (v) => { const [p, q] = String(v).split('|').map(Number); set('pcm', p, false); set('sdm', q, false); },
  };
}
