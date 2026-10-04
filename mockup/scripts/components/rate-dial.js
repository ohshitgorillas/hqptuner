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
import { bandEdges, bandSpan, dialScale, minorTicks, moveNeedle, nearestTier, seamX } from '../model/output.js';

const W = 806;          // viewBox width = the Format row at the 1080 plate, so the printing is 1:1
const H = 106;
const X0 = 38;          // x of the first tier
const RULE_Y = 56;
const INSET = 8;        // a band's legend and rule stop this far inside its outer tiers' cells
const BANDS = [
  { id: 'pcm', legend: 'PCM' },
  { id: 'sdm', legend: 'SDM (DSD)' },
];

const KEYS = {
  ArrowLeft: (c) => c - 1, ArrowDown: (c) => c - 1,
  ArrowRight: (c) => c + 1, ArrowUp: (c) => c + 1,
  Home: (c, st) => st.lo, End: (c, st) => st.hi,
};

// One tier's printing: major tick, name, both exact rates, and the unavailable note.
function printTier(t, i, x) {
  return s('g', { class: t.unavailable ? 'unav' : null, data: { i } },
    s('line.major', { x1: x, y1: RULE_Y - 12, x2: x, y2: RULE_Y }),
    s('text.tier', { x, y: 38, 'text-anchor': 'middle', text: t.name }),
    s('text.freq', { x, y: 71, 'text-anchor': 'middle', text: `${t.f44} ${t.unit}` }),
    s('text.freq', { x, y: 83, 'text-anchor': 'middle', text: `${t.f48} ${t.unit}` }),
    t.unavailable && s('text.note', { x, y: 99, 'text-anchor': 'middle', text: 'unavailable' }),
  );
}

// One band into its group: legend, rule, ticks, needle, printing. Returns the needle and the tier printings.
function drawBand(g, b, { tiers, scale }, span) {
  const { x1, x2 } = bandEdges(scale, span, INSET);

  // Legend: engraved name over a bracket spanning the band.
  g.append(s('path.bl', { d: `M${x1},20 V14 H${x2} V20` }));
  g.append(s('text.legend', { x: (x1 + x2) / 2, y: 18, 'text-anchor': 'middle', text: b.legend }));

  // Rule + quarter-step minor ticks, within the band
  g.append(s('line.rule', { x1, y1: RULE_Y, x2, y2: RULE_Y }));
  for (const x of minorTicks(scale, span, { x1, x2 })) g.append(s('line.minor', { x1: x, y1: RULE_Y - 5, x2: x, y2: RULE_Y }));

  // Needle (behind the scale printing, like a real tuner glass)
  const needle = s('g.ndl', {}, s('rect.needle', { x: -1.25, y: 26, width: 2.5, height: 64, rx: 1 }));
  g.append(needle);

  // Tier printing
  const marks = [];
  for (let i = span.lo; i <= span.hi; i++) marks.push(printTier(tiers[i], i, scale.xs[i]));
  g.append(...marks);
  return { needle, marks };
}

// The band's slider: a transparent region over its half of the glass.
function bandSlider(b, { lo, hi }, seam) {
  const left = b.id === 'pcm' ? 0 : seam / W * 100;
  const width = b.id === 'pcm' ? seam / W * 100 : 100 - seam / W * 100;
  return h('div.bandsl', {
    role: 'slider', tabindex: 0, style: `left:${left}%;width:${width}%`,
    'aria-label': `${b.legend} rate`, 'aria-valuemin': lo, 'aria-valuemax': hi,
  });
}

// Pointer and keys on one band's slider; `move` sends its needle to a tier.
function wireBand(dial, st, move, tierAt) {
  let dragging = false;
  st.el.addEventListener('pointerdown', (e) => {
    dragging = true;
    dial.classList.add('drag');
    st.el.setPointerCapture(e.pointerId);
    move(tierAt(e));
  });
  st.el.addEventListener('pointermove', (e) => { if (dragging) move(tierAt(e)); });
  const up = () => { dragging = false; dial.classList.remove('drag'); };
  st.el.addEventListener('pointerup', up);
  st.el.addEventListener('pointercancel', up);
  st.el.addEventListener('keydown', (e) => {
    if (!KEYS[e.key]) return;
    e.preventDefault();
    move(KEYS[e.key](st.cur, st));
  });
}

// A band's needle, selected printing and slider value on tier `i`.
function showTier(st, i, t, x) {
  st.needle.style.transform = `translateX(${x}px)`;
  st.marks.forEach((m) => m.classList.toggle('sel', Number(m.dataset.i) === i));
  st.el.setAttribute('aria-valuenow', i);
  st.el.setAttribute('aria-valuetext', t.name + (t.unavailable ? ', unavailable' : ''));
}

/**
 * @param {HTMLElement} dial  empty .dial
 * @param {{tiers:object[], limits:{pcm:number,sdm:number}, playing:number}} cfg
 * @param {() => void} onChange
 */
export function mountRateDial(dial, { tiers, limits, playing }, onChange) {
  const scale = dialScale(tiers.length, W, X0);
  const { xs, dx } = scale;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, 'aria-hidden': 'true' });
  dial.append(svg);
  const seam = seamX(scale, tiers);

  // Layer 1: hatch behind unavailable tiers
  svg.append(hatchDefs('hatch', { pattern: 'hatch' }));
  tiers.forEach((t, i) => t.unavailable && svg.append(s('rect', { x: xs[i] - dx / 2, y: 0, width: dx, height: H, fill: 'url(#hatch)' })));

  // Layer 2: bezel seam between the bands
  svg.append(s('g.seam', {}, s('line.sd', { x1: seam, y1: 0, x2: seam, y2: H }), s('line.sl', { x1: seam + 1.5, y1: 0, x2: seam + 1.5, y2: H })));

  // Per band: legend, rule, ticks, needle, printing, then its slider.
  const state = {};
  for (const b of BANDS) {
    const span = bandSpan(tiers, b.id);
    const g = s('g.band', { data: { band: b.id } });
    svg.append(g);
    const { needle, marks } = drawBand(g, b, { tiers, scale }, span);
    const el = bandSlider(b, span, seam);
    dial.append(el);
    state[b.id] = { ...span, cur: limits[b.id], needle, marks, el };
  }

  // Playing lamp (above the bands; the running rate is one tier, whichever band it is in)
  const lamp = s('circle.playing', { cx: xs[playing], cy: 96, r: 3.5 });
  svg.append(lamp);
  // Mock scenario: the lamp moves to the tier playing now, and goes out when nothing plays (null).
  dial._setPlaying = (i) => { lamp.style.display = i == null ? 'none' : ''; if (i != null) lamp.setAttribute('cx', xs[i]); };

  function set(b, target, fromUser) {
    const st = state[b];
    const { i, moved } = moveNeedle(st, st.cur, target);
    st.cur = i;
    showTier(st, i, tiers[i], xs[i]);
    if (moved && fromUser) onChange();
  }

  const tierAt = (e) => {
    const r = svg.getBoundingClientRect();
    return nearestTier(scale, (e.clientX - r.left) / r.width * W);
  };

  for (const b of Object.keys(state)) wireBand(dial, state[b], (i) => set(b, i, true), tierAt);

  for (const b of Object.keys(state)) set(b, state[b].cur, false);
  // Discard (mock): the drawer reads both limits as one value and puts them back.
  return {
    value: () => `${state.pcm.cur}|${state.sdm.cur}`,
    setValue: (v) => { const [p, q] = String(v).split('|').map(Number); set('pcm', p, false); set('sdm', q, false); },
  };
}
