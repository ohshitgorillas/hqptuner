// Stage drawer with output-mode tabs: DSD Processing, Resampling, Shaping (data/conversion.js MODE_DRAWERS). Replaces the
// combined Resampling · Shaping drawer: one rail stage, one drawer, in signal order.
//   Head   title, then PCM out | SDM out tabs (the output modes; the engine keeps a chain per mode). It opens on the
//          running mode; the other mode's tab reads `idle`, and while it shows the head is hatched and the plate darker
//          (what can't run now), as the idle chain was.
//   Rows   the drawer row grammar: control column (label, control) | the setting's manual paragraph, then the picked
//          option's line full width under the row. Live rows (filters, shapers) apply at once and reach the page + rail
//          (`on`); restart rows stage (dirty dot on their tab), Apply / Discard in the head. FFT length shows only while
//          that mode picks an FFT-family filter.
// Page-held fields (the running mode's filters and shaper) show here too: two homes, one state (set(id, v) moves a pick in).

import { h } from '../lib/dom.js';
import { anyOpen } from '../lib/popover.js';
import { registerDrawer, closeOthers, applyGroup, wipe } from './drawer.js';
import { seg, select } from './seg.js';
import { vselect, optCopy } from './vselect.js';
import { xref } from '../lib/xref.js';
import { isFft, MODE_TABS } from '../data/conversion.js';

/**
 * @param {HTMLElement} body
 * @param {HTMLButtonElement[]} stages  rail stages that open it
 * @param {object} spec                 MODE_DRAWERS entry
 * @param {object} values               CONV.values (initial)
 * @param {{running: string, on?: (id: string, v: string) => void, onApplied?: (vals: object) => void}} o
 */
export function mountModeDrawer(body, stages, spec, values, { running, on, onApplied }) {
  const vals = {};
  for (const m of ['pcm', 'sdm']) for (const r of spec.modes[m]) if (!r.head) vals[r.id] = values[r.id];
  let base = { ...vals };
  let run = running, shown = running;
  const ctls = new Map();    // id → [{ui, copy, list}]
  const rowsOf = { pcm: [], sdm: [] };   // [{node, r}]
  const dirty = new Set();   // modes holding staged edits

  function row(r, m) {
    const c = r.control;
    let el, copy = null;
    const id = `${spec.id}-${m}-${r.id}`;
    if (c.type === 'select') {
      el = vselect({ id, aria: c.aria, options: c.options, value: vals[r.id], onChange: (v) => pick(r, m, v) });
      if (c.options.some((x) => x.man)) copy = h('p.optman', {}, optCopy(c.options, vals[r.id]));
    } else if (c.type === 'number') {
      const input = h('input.vfd', { type: 'number', id, value: vals[r.id], min: c.min, max: c.max, 'aria-label': c.aria });
      input.addEventListener('change', () => pick(r, m, input.value));
      el = h('div.num', {}, input, c.hint && h('span.h', { text: c.hint }));
      el._ui = (v) => { input.value = v; };
    } else {
      el = seg({ aria: c.aria, options: c.options, value: vals[r.id], attrs: { id }, onChange: (v) => pick(r, m, v) });
    }
    const ui = c.type === 'select' ? (v) => { el.value = v; } : c.type === 'number' ? el._ui : (v) => select(el, v);
    if (!ctls.has(r.id)) ctls.set(r.id, []);
    ctls.get(r.id).push({ ui, copy, list: c.options });
    const node = h('div.drow.cvrow', { data: { id: r.id } },
      h('div.ctl', {}, h('div.fh', {}, h('b', { text: r.label }), r.sub && h('span.s', { text: r.sub })), el),
      h('div.man', {}, [].concat(r.man).map((t) => h('p', { text: t }))),
      copy && h('div.optfull', {}, copy));
    rowsOf[m].push({ node, r });
    return node;
  }

  function pick(r, m, v) {
    apply(r.id, v);
    if (r.restart) { dirty.add(m); paintDirty(); }
    if (r.live) { base[r.id] = v; on?.(r.id, v); }
  }

  function apply(id, v) {
    vals[id] = v;
    for (const it of ctls.get(id) || []) {
      it.ui(v);
      if (it.copy) it.copy.replaceChildren(...optCopy(it.list, v).filter(Boolean));
    }
    paintRows();
  }

  function discard() {
    for (const [id, v] of Object.entries(base)) if (vals[id] !== v) apply(id, v);
    dirty.clear(); paintDirty();
  }

  /** FFT length: only while its mode picks an FFT-family filter. */
  function paintRows() {
    for (const m of ['pcm', 'sdm']) for (const { node, r } of rowsOf[m]) {
      if (r.fft) node.hidden = !(isFft(vals[m + '1x']) || isFft(vals[m + 'nx']));
    }
  }

  // Notes: a read-only line under the rows naming a value that lives elsewhere, with a link there (Shaping: DAC bits).
  const notes = new Map();   // id → text span
  const noteEl = (n) => { const t = h('span'); notes.set(n.id, t); return h('p.mnote', {}, t, ' ', xref(n.link.to, n.link.label)); };
  const panels = {};
  for (const m of ['pcm', 'sdm']) {
    panels[m] = h('div.dpanel.cvpanel', { role: 'tabpanel', 'aria-label': `${MODE_TABS[m].split(' ')[0]} ${spec.title}`, hidden: true },
      spec.modes[m].map((r) => (r.head ? h('div.msec', {}, h('span.t', { text: r.head }), h('span.ln')) : row(r, m))), (spec.notes?.[m] || []).map(noteEl));
  }
  const tabs = ['pcm', 'sdm'].map((m) => h('button', { type: 'button', role: 'tab', data: { tab: m },
    on: { click: () => { shown = m; paint(); } } }, h('span', { text: MODE_TABS[m] }), h('span.cst')));

  const title = h('span.t', { text: spec.title });
  const tabHost = h('div.seg.dtabs.mtabs', { role: 'tablist', 'aria-label': `${spec.title}: output mode` }, tabs);
  const close = h('button.round.dx', { type: 'button', 'aria-label': 'Close drawer', text: '×', on: { click: () => setOpen(false) } });
  const grp = applyGroup(() => { base = { ...vals }; dirty.clear(); paintDirty(); onApplied?.({ ...vals }); }, () => discard());
  const head = h('div.dhead.cvhead', {}, title, tabHost, h('span.grow'), grp.el, close);
  const frame = h('div.cvbody', {}, panels.pcm, panels.sdm);
  const drawer = h(`aside.drawer.cvdrawer.mdrawer#drawer-${spec.id}`, { 'aria-label': spec.aria, 'data-closed': '' }, head, frame);
  body.append(drawer);

  function paint() {
    drawer.classList.toggle('idle', shown !== run);
    for (const b of tabs) {
      const m = b.dataset.tab;
      b.setAttribute('aria-selected', String(m === shown));
      b.querySelector('.cst').textContent = m === run ? '' : 'idle';
    }
    for (const m of ['pcm', 'sdm']) panels[m].hidden = m !== shown;
    paintRows();
    paintDirty();
  }

  function paintDirty() {
    for (const b of tabs) b.classList.toggle('dirty', dirty.has(b.dataset.tab));
    const restarts = rowsOf[shown].some(({ node, r }) => !node.hidden && r.restart);
    grp.paint(restarts || dirty.size > 0, dirty.size > 0);
  }

  function setOpen(open, snap) {
    if (open) closeOthers(api);
    wipe(drawer, !open, snap);
    for (const st of stages) {
      st.classList.toggle('open', open && !st.hidden);
      st.setAttribute('aria-expanded', String(open));
    }
  }

  for (const st of stages) {
    st.setAttribute('aria-controls', drawer.id);
    st.addEventListener('click', () => {
      if (!drawer.hasAttribute('data-closed')) setOpen(false);
      else { shown = run; paint(); setOpen(true); }
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !anyOpen()) setOpen(false); });

  paint();
  const api = {
    setOpen,
    has: (id) => id in vals,
    /** A pick made on the page (its other home). */
    set: (id, v) => { if (!(id in vals)) return; base[id] = v; if (vals[id] !== v) apply(id, v); },
    /** Output mode moved: the running mode changes; a closed drawer will open on it. */
    setRunning: (m) => { run = m; shown = m; paint(); },
    /** A cross-reference lands here: open on that mode's tab, running or idle. */
    openAt: (m) => { shown = m; paint(); setOpen(true); },
    values: () => ({ ...vals }),
    /** A note's text (its link stays). */
    note: (id, text) => { const t = notes.get(id); if (t) t.textContent = text; },
  };
  registerDrawer(api);
  return api;
}
