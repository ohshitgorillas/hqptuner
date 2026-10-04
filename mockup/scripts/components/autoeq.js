// EQ / Correction parts (Profile builder's EQ step): Headphone Auto EQ (find one) and correction files (have one), what the
// stereo pair holds, and a plot. Parts are returned separately; the step lays them out in the drawer row grammar.
//   search  v1 Library.js: search, hits (model | measurement source), `…N more — refine the search`, the picked hit's
//           selection strip (`N band(s) · preamp x dB`, `Clear`, `Load profile`: onto the pair, both ears, preamp as gain)
//   files   `Load AutoEq / REW .txt…` (v1), `Upload convolution filters` (owner), `mirror to stereo pair` (v1)
//   holds   where the pair's EQ came from (amber) + `L 9 bands −3.5 dB  R …`
//   plot    the pair (L amber, R ink-2) and the picked hit dashed (`preview`, v1). A visual check: nothing is heard
//           until Save.

import { h } from '../lib/dom.js';
import { mountRespPlot } from './resp-plot.js';
import { pipeH, cplx, toDb } from '../lib/xdsp.js';
import { AUTOEQ } from '../data/pipelines.js';
import { AEQ_COPY } from '../data/profiles.js';
import { signed } from '../model/format.js';

const HITS = 3;
const PEQ = new Set(['peak', 'lshelf', 'hshelf']);
const TYPE = { PK: 'peak', PEQ: 'peak', LS: 'lshelf', LSC: 'lshelf', HS: 'hshelf', HSC: 'hshelf' };

/** ParametricEQ.txt (AutoEq / REW): `Preamp: -6.4 dB`, `Filter 1: ON PK Fc 105 Hz Gain 5.5 dB Q 0.71`. */
function parseEq(text) {
  const pre = text.match(/Preamp:\s*(-?[\d.]+)\s*dB/i);
  const bands = [];
  for (const m of text.matchAll(/Filter\s*\d*:\s*ON\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/gi)) {
    const type = TYPE[m[1].toUpperCase()];
    if (type) bands.push([+m[2], +m[3], +(m[4] ?? 0.71), type]);
  }
  return { bands, pre: pre ? +pre[1] : null };
}

/**
 * @param {{core: object, name: () => string, land: (name: string) => void}} o
 *   core = createPipelines api (importEq, ears, rate); land(name) = the EQ came from `name` (stages it)
 */
export function mountAutoEq({ core, name, land }) {
  let sel = null;   // the picked hit (previewing)
  const q = h('input.vfd.pq.peqq', { type: 'search', placeholder: AUTOEQ.placeholder, 'aria-label': 'Search headphone model' });
  q.addEventListener('input', () => { sel = null; paint(); });
  const hits = h('div.peqhits', { role: 'listbox', 'aria-label': 'AutoEq profiles' });
  const selLine = h('div.peqsel');
  const search = h('div.peqsearch', {}, q,
    h('div.aeqcred', {}, AEQ_COPY.credit + ' ', h('a', { href: 'https://github.com/jaakkopasanen/AutoEq', target: '_blank', rel: 'noreferrer', text: 'AutoEq' }), ' (MIT)'),
    hits, selLine);

  const mirror = h('input', { type: 'checkbox', checked: true });
  const txt = h('input', { type: 'file', accept: '.txt', hidden: true });
  const wav = h('input', { type: 'file', accept: '.wav', hidden: true });
  txt.addEventListener('change', () => {
    const f = txt.files[0];
    if (f) f.text().then((t) => { const eq = parseEq(t); if (eq.bands.length) put({ bands: eq.bands, pre: eq.pre ?? 0 }, mirror.checked, f.name); });
    txt.value = '';   // the same file re-fires (v1)
  });
  wav.addEventListener('change', () => { const f = wav.files[0]; if (f) put({ conv: f.name }, mirror.checked, f.name); wav.value = ''; });
  const files = h('div.peqfiles', {},
    h('div.peqf', {},
      h('button.btn.xs', { type: 'button', text: AEQ_COPY.file, on: { click: () => txt.click() } }), txt,
      h('button.btn.xs', { type: 'button', text: AEQ_COPY.conv, on: { click: () => wav.click() } }), wav),
    h('label.chk', {}, mirror, AUTOEQ.mirror));

  const holds = h('div.peqhold');
  const plot = h('div.eq.peqplot');
  const rp = mountRespPlot(plot, { lo: -21, hi: 9, step: 6, minor: 3, aria: 'EQ response' });

  function put(eq, both, from) {
    core.importEq(eq, both);
    q.value = ''; sel = null;
    land(from);
  }
  const side = (p, k) => {
    if (!p) return '';
    const n = p.stages.filter((st) => st.kind === 'iir' && PEQ.has(st.type)).length;
    const conv = p.stages.find((st) => st.kind === 'conv');
    return `${k} ${n} bands${conv ? ' + ' + conv.file.split('/').pop() : ''} ${p.unit === 'Lin' ? 'Lin ' + p.gain : signed(+p.gain, 1) + ' dB'}`;
  };

  function paint() {
    const t = q.value.trim().toLowerCase();
    const all = t ? AUTOEQ.hits.filter((x) => x.name.toLowerCase().includes(t)) : [];   // hits only while searching
    hits.hidden = !all.length;
    hits.replaceChildren(...all.slice(0, HITS).map((x) => h('div.peqhit', { role: 'option', class: sel === x && 'on', aria: { selected: sel === x } },
      h('button.peqpick', { type: 'button', on: { click: () => { sel = sel === x ? null : x; paint(); } } },
        h('span', { text: x.name }), h('span.src', { text: x.src })))),
    ...(all.length > HITS ? [h('div.peqmore', { text: AEQ_COPY.more(all.length - HITS) })] : []));
    selLine.hidden = !sel;
    selLine.replaceChildren(...(sel ? [h('span.cap', { text: AEQ_COPY.bands(sel.bands.length, sel.pre) }), h('span.grow'),
      h('button.btn.xs', { type: 'button', text: AEQ_COPY.clear, on: { click: () => { sel = null; paint(); } } }),
      h('button.btn.xs.peqload', { type: 'button', text: AEQ_COPY.load, on: { click: () => put({ bands: sel.bands, pre: sel.pre }, true, `${sel.name} · ${sel.src}`) } })] : []));
    const [l, r] = core.ears();
    holds.replaceChildren(h('b', { text: name() || (summary(l) ? '' : 'None') }), h('span', { text: [side(l, 'L'), side(r, 'R')].filter(Boolean).join('   ') }));
    const fs = core.rate, traces = [];
    if (sel) {
      const p = { stages: sel.bands.map(([f, g, qq, type = 'peak']) => ({ kind: 'iir', type, f, g, q: qq })), gain: sel.pre, unit: 'dB' };
      traces.push({ cls: 'ghost', label: AEQ_COPY.preview, fn: (f) => toDb(cplx.mag(pipeH(p, f, fs))) });
    }
    if (l) traces.push({ label: 'L', fn: (f) => toDb(cplx.mag(pipeH(l, f, fs))) });
    if (r) traces.push({ cls: 'side', label: 'R', fn: (f) => toDb(cplx.mag(pipeH(r, f, fs))) });
    rp.draw(traces);
  }
  const summary = (p) => p && p.stages.some((st) => (st.kind === 'iir' && PEQ.has(st.type)) || st.kind === 'conv');
  return { search, files, holds, plot, paint, reset: () => { q.value = ''; sel = null; paint(); },
    /** The pair's EQ in one line: where it came from, else its band count, else None (rail / overview). */
    answer: () => name() || (() => { const l = core.ears()[0]; const n = l ? l.stages.filter((st) => st.kind === 'iir' && PEQ.has(st.type)).length : 0; return n ? `${n} bands` : 'None'; })() };
}
