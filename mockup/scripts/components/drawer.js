// Stage drawer, rendered from a schema (see data/output.js for the shape).
// Opens only from its rail stage. Tabs = the parts of that stage. A change marks its tab dirty (it stages)
// unless its row is `live` (applies at once, never stages). The head's top-right corner, clear of the close button, carries
// the apply group (no restart marks anywhere in drawers): Discard + Apply. Apply writes the station and restarts the engine:
// one act, as the daemon has it (a config file holds startup defaults; writing it is the restart). There is no
// applied-but-unsaved state, so no Apply & save, no Auto-save. It shows while the open tab holds a restart-lane setting
// (schema.restart = every row; else row.restart, or tab.restart for a block) or while the drawer holds staged edits; its
// buttons work only with staged edits.
// Apply clears the dirty dots (mock); Discard puts every staged value back to the last applied one and clears them. The Backend segment decides which backend
// groups show; Combo shows all of them, each under its own subhead.
// A {block} item mounts a bespoke part from deps.blocks[name](host, ctx). An instrument (Source meter) ignores ctx and never
// stages; a setting block (Volume range bar) stages through ctx: set(id, v) records + marks dirty, init(id, v) records
// its start value, watch(fn) hears the drawer's values after every change (gray reasons).
// One drawer open at a time: opening one closes the others.
// deps.on[controlId](value) hears every change to that control (mock cross-effects, e.g. rail readouts).
// row.man is a string or [{k, text}] paragraphs (k = the sub-setting's label, bolded ahead of its copy).
// control.gray(values) → reason ('' = enabled): the control disables and the reason shows under the row's controls;
// values are the drawer's current (staged) control values by id, re-read on every change.
// control type 'group' {items:[control]} lays several controls in one row; an item's `label` sits above it.
// control type 'choice' {options:[{v, label, sub?, control?, man?}]}: vertical radio lines spanning the row, each with its
// own detail control (enabled only while its line is picked, never hidden) and its manual paragraph on the right.
// row.optMan [{v, man}] lists every option with its manual copy across the full row, under control and copy; the selected one is lit and
// follows the selection; tapping an option selects it (same path as the control).

import { h } from '../lib/dom.js';
import { anyOpen } from '../lib/popover.js';
import { seg, select } from './seg.js';
import { mountDevicePicker } from './device-picker.js';
import { mountRateDial } from './rate-dial.js';
import { withXref, hasXref, xref } from '../lib/xref.js';

const DRAWERS = [];
// Drawer families: drawers that edit one shared object (the Matrix engine family edits the matrix profile in focus:
// Matrix engine, Crossfeed, Loudness, DAC correction). Members share one value store (control ids unique across the
// family), so a gray reason in one can read a setting in another; staging is family-wide: an edit staged in any
// member lights the apply group in every member, and Apply there applies them all (one profile write).
const FAMILIES = new Map();
const family = (name) => {
  if (!FAMILIES.has(name)) FAMILIES.set(name, { vals: {}, base: {}, members: [] });
  return FAMILIES.get(name);
};
/** A family's shared store: {vals, base, members} (the Profile builder reads the chain's applied matrix for New). */
export const familyOf = (name) => family(name);

/**
 * Head apply group, top right: Discard + Apply. Apply writes the staged edits into the station and restarts the
 * engine; there is nothing to save afterwards (the thread with Jussi, 2026-10-03: config is for settled values, so a
 * restart that the station won't remember has no job; experiments live in the live rows, snapshots and matrix
 * profiles). Discard drops the staged edits. Closing the drawer never discards: edits stay staged so complex changes can
 * be built before applying. paint(shown, staged): the group shows when `shown`; both buttons are live only with
 * staged edits.
 */
const appliedFns = [];
/** Hear every Apply from any drawer (main.js: the connection knob reads Applying… while the engine restarts). */
export function onApplied(fn) { appliedFns.push(fn); }
export function applyGroup(onApply, onDiscard) {
  const discard = h('button.btn.sm', { type: 'button', text: 'Discard', on: { click: () => onDiscard?.() } });
  const apply = h('button.btn.sm.aapply', { type: 'button', text: 'Apply', on: { click: () => { onApply(); for (const fn of appliedFns) fn(); } } });
  const el = h('div.apply', { hidden: true }, discard, apply);
  return {
    el,
    paint(shown, staged) {
      el.hidden = !shown;
      discard.disabled = apply.disabled = !staged;
      el.classList.toggle('staged', staged);
    },
  };
}

/** Bespoke drawers (Resampling · Shaping) join the one-open-at-a-time rule through these. api = {setOpen(open, snap)}. */
export function registerDrawer(api) { DRAWERS.push(api); }
/** Close every other drawer at once, no wipe: only the drawer being opened animates (two wipes at
 * once compete). Settings' swap passes null (closes all). */
export function closeOthers(api) { for (const d of DRAWERS) if (d !== api) d.setOpen(false, true); }
/** Toggle a drawer's closed state; snap = no wipe (it closes because another opens, or the body swaps). */
export function wipe(el, closed, snap) {
  if (closed === el.hasAttribute('data-closed')) return;
  if (snap) el.classList.add('snap');
  el.toggleAttribute('data-closed', closed);
  if (snap) { void el.offsetWidth; el.classList.remove('snap'); }   // flush with no transition, then restore it
}

/**
 * @param {HTMLElement} body       .body grid the drawer overlays
 * @param {HTMLButtonElement} stage rail stage button that toggles it
 * @param {object} schema          drawer schema
 * @param {object} deps            {groupNames?, devices?, rateTiers?, blocks?: {name: (host) => void}, on?: {id: (v) => void},
 *                                  }  (row.band: 'pcm'|'sdm' tags a family-only row; never grays by mode)
 *   A second mount of a schema (Profile builder) passes: prefix (every DOM id inside gets it, so the two copies never
 *   share an id; CSS keys on both), family (its own store instead of the schema's), head (an element for the head's
 *   top-right corner in place of the apply group: the builder's own Discard / Save), onValues(vals) (hears the family's
 *   values after every change, once the blocks have followed them).
 */
export function mountDrawer(body, stage, schema, { groupNames = {}, devices, rateTiers, blocks = {}, on = {}, onApply, prefix = '', family: famName, head, onValues }) {
  const id = `drawer-${schema.id}`;
  const tabId = (t) => `${schema.id}-tab-${t}`;
  const panelId = (t) => `${schema.id}-p-${t}`;
  let backend = schema.backend;
  const segs = new Map();   // seg control id → {el, c, r, paintOpt}
  const fam = (famName ?? schema.family) ? family(famName ?? schema.family) : null;
  const vals = fam ? fam.vals : {};   // control id → current value (seg + number); a family shares one store
  const base = fam ? fam.base : {};   // control id → the value Discard returns to: the last applied (live rows: the current)
  const ui = new Map();      // control id → (v) => repaint that control (Discard)
  const discards = [];       // block ctx.onDiscard listeners
  const blockIds = new Set(); // value ids a block keeps (it repaints them itself on Discard)
  const blockEl = new Map();  // block value id → its block element (remark: dirty dots after a buffer is put back)
  const grays = [];         // {ctls: [{c, el}], reason: el} per row with gray-able controls
  let rowGray = null;       // collects the row being built
  const watchers = [];      // block ctx.watch listeners

  const tabs = schema.tabs.map((t, i) => h('button', {
    type: 'button', role: 'tab', id: tabId(t.id), aria: { controls: panelId(t.id), selected: i === 0 }, data: { tab: t.id },
    on: { click: () => showTab(t.id) },
  }, t.label));

  const close = h('button.round.dx', { type: 'button', 'aria-label': 'Close drawer', text: '×', on: { click: () => setOpen(false) } });

  const panels = schema.tabs.map((t, i) => h('div.dpanel', {
    role: tabs.length === 1 ? null : 'tabpanel', id: panelId(t.id), aria: { labelledby: tabs.length === 1 ? null : tabId(t.id) }, data: { tab: t.id }, hidden: i > 0,
  }, t.body.map(item)));

  // A single-part stage gets no tab strip; its dirty dot moves to the title.
  const single = tabs.length === 1;
  const applyGrp = applyGroup(
    () => { for (const d of fam ? fam.members : [api]) d.applied(); },
    // Family: every member puts its values back first, then all repaint (a gray reason or block may read another's).
    () => { const ms = fam ? fam.members : [api]; for (const d of ms) d.discarded(); for (const d of ms) d.settle(); },
  );
  let curTab = schema.tabs[0];
  const restarts = (t) => schema.restart || t.restart ||
    t.body.some((it) => it.row?.restart || it.rows?.some((r) => r.restart));
  const title = h('span.t', { text: schema.title });
  // Born closed: nothing wipes at page load.
  const drawer = h(`aside.drawer#${id}`, { 'aria-label': schema.aria, class: backend === 'combo' && 'combo', 'data-closed': '' },
    h('div.dhead', {},
      title,
      !single && h('div.seg.dtabs', { role: 'tablist', 'aria-label': schema.aria }, tabs),
      h('span.grow'),
      head ?? applyGrp.el,
      close,
    ),
    panels,
  );
  if (prefix) {   // second mount: every id (and every reference to one) gets the prefix
    for (const el of [drawer, ...drawer.querySelectorAll('[id]')]) el.id = prefix + el.id;
    for (const a of ['aria-controls', 'aria-labelledby']) for (const el of drawer.querySelectorAll(`[${a}]`)) el.setAttribute(a, prefix + el.getAttribute(a));
  }
  body.append(drawer);

  for (const [k, v] of Object.entries(vals)) if (!(k in base)) base[k] = v;   // start values (a family: each member adds its own)
  regray();
  paintApply();

  stage.setAttribute('aria-controls', drawer.id);
  stage.addEventListener('click', () => setOpen(drawer.hasAttribute('data-closed')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !anyOpen()) setOpen(false); });

  function setOpen(open, snap) {
    if (open) { closeOthers(api); regray(); paintApply(); }
    wipe(drawer, !open, snap);
    stage.classList.toggle('open', open);
    stage.setAttribute('aria-expanded', String(open));
  }

  function showTab(t) {
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    panels.forEach((p) => { p.hidden = p.dataset.tab !== t; });
    curTab = schema.tabs.find((x) => x.id === t);
    paintApply();
  }

  function paintApply() {
    const staged = drawer.querySelector('.dirty') !== null || (fam ? fam.members : []).some((d) => d.hasDirty());
    applyGrp.paint(restarts(curTab) || staged, staged);
  }

  function clearDirty() {
    for (const el of drawer.querySelectorAll('.dirty')) el.classList.remove('dirty');
    paintApply();
  }

  function changed(el, c, r, v, paintOpt) {
    vals[c.id] = v;
    if (r.live) base[c.id] = v;   // live rows apply at once: nothing to discard
    paintOpt(v);
    regray();
    if (!r.live) markDirty(el);
    if (c.switchesBackend) setBackend(v);
    on[c.id]?.(v);
  }

  /** Move a seg control from outside (mock cross-effects). Runs the same path as a tap. */
  function set(id, v) {
    const it = segs.get(id);
    if (!it || it.el.querySelector('button.on')?.dataset.v === String(v)) return;
    select(it.el, v);
    changed(it.el, it.c, it.r, v, it.paintOpt);
  }

  /** Re-read every gray reason from the current values: disable those controls, print the row's reasons. A reason that
   *  names its fix elsewhere links there (lib/xref.js), once per drawer (the first row showing it); a second mount
   *  (Profile builder, `prefix`) never links: its targets are the chain's drawers, under another body. */
  function regray() {
    const linked = new Set();
    for (const g of grays) {
      const reasons = [];
      for (const { c, el } of g.ctls) {
        const why = c.gray(vals);
        el.classList.toggle('grayed', !!why);
        for (const x of el.matches('select,input') ? [el] : el.querySelectorAll('button,input,select')) x.disabled = !!why;
        if (why.trim() && !reasons.includes(why)) reasons.push(why);   // blank reason = gray with no line (v1 had no copy)
      }
      g.reason.replaceChildren(...reasons.flatMap((r, i) => {
        const link = !prefix && !linked.has(r);
        if (link && hasXref(r)) linked.add(r);
        return [i ? ' ' : '', ...withXref(r, link)];
      }));
      g.reason.hidden = !reasons.length;
    }
    for (const fn of watchers) fn(vals);
    onValues?.(vals);
  }

  function markDirty(el) {
    const p = el.closest('.dpanel');
    if (!p) return;
    (single ? title : tabs.find((b) => b.dataset.tab === p.dataset.tab)).classList.add('dirty');
    paintApply();
  }

  function setBackend(v) {
    backend = v;
    drawer.classList.toggle('combo', v === 'combo');
    for (const g of drawer.querySelectorAll('.begrp')) g.hidden = !groupVisible(g.dataset.be);
  }

  function groupVisible(be) { return backend === 'combo' || backend === be; }

  function item(it) {
    if (it.row) return row(it.row);
    // Intro: a lead paragraph over the rows; {to, label} parts are links to other drawers (`Name ›`). A second mount
    // (Profile builder, `prefix`) prints the names plain: its targets are the chain's drawers, under another body.
    if (it.intro) return h('p.dintro', {}, it.intro.map((x) => (typeof x === 'string' ? x : prefix ? x.label : xref(x.to, x.label))));
    if (it.block) {
      const el = h('div.dblock', { data: { block: it.block } });
      blocks[it.block](el, {
        init: (id, v) => { vals[id] = String(v); blockIds.add(id); blockEl.set(id, el); },
        onDiscard: (fn) => discards.push(fn),   // fn(base): put the block's own state back to these values
        set: (id, v) => { vals[id] = String(v); blockIds.add(id); blockEl.set(id, el); markDirty(el); regray(); },
        watch: (fn) => watchers.push(fn),
      });
      return el;
    }
    return group(it);
  }

  function group({ group: be, rows }) {
    return h('div.begrp', { data: { be }, hidden: !groupVisible(be) },
      h('div.dsec', {}, h('span.t', { text: groupNames[be] }), h('span.ln')),
      rows.map(row),
    );
  }

  function row(r) {
    const opt = r.optMan && h('div.optlist', { role: 'list', 'aria-label': r.label + ' options' },
      r.optMan.map((o) => h('button.optrow', {
        type: 'button', role: 'listitem', data: { v: o.v },
        on: { click: () => set(r.control.id, o.v) },
      }, h('code', { text: o.label ?? o.v }), h('span', { text: o.man }))));
    const paintOpt = (v) => {
      if (!opt) return;
      for (const b of opt.children) {
        const cur = b.dataset.v === String(v);
        b.classList.toggle('cur', cur);
        b.setAttribute('aria-current', String(cur));
      }
    };
    paintOpt(r.control.value);
    rowGray = [];
    const ctlEl = control(r.control, r, paintOpt);
    const reason = rowGray.length ? h('span.gr', { hidden: true }) : null;
    if (reason) grays.push({ ctls: rowGray, reason });
    rowGray = null;
    const paras = typeof r.man === 'string' ? [{ text: r.man }] : r.man;
    const spans = r.control.type === 'choice';
    const ctl = h('div.ctl', {},
      h('div.fh', {}, h('b', { text: r.label }), r.sub && h('span.s', { text: r.sub }),
        r.band && h('span.band', { text: r.band.toUpperCase() })),
      !spans && ctlEl,
      reason,
      r.action && h('div.act', {},
        h('button.btn.xs', { type: 'button', text: r.action.label }),
        h('span.cap', { text: r.action.caption }),
      ),
      r.advisory && h('span.adv', { text: r.advisory }),
    );
    return h('div.drow', { class: r.full && 'drow-full' }, ctl,
      h('div.man', {}, paras.map((m) => h('p', {}, m.k && h('b', { text: m.k }), m.k && ' — ', m.text))), opt, spans && ctlEl);
  }

  function control(c, r = {}, paintOpt = () => {}) {
    const el = build(c, r, paintOpt);
    const set = el._setValue;
    if (c.id && set) ui.set(c.id, { set, c, r, paintOpt, el });
    if ('value' in c) vals[c.id] = String(c.value);
    if (c.gray && rowGray) rowGray.push({ c, el });
    return el;
  }

  function build(c, r, paintOpt) {
    switch (c.type) {
      case 'choice': return choice(c, r);
      case 'group':
        return h('div.cgrp', {}, c.items.map((it) => {
          const el = control(it, r, paintOpt);
          return it.label ? h('label.ci', {}, h('span.cl', { text: it.label }), el) : el;
        }));
      case 'seg': {
        const el = seg({
          aria: c.aria, options: c.options, value: c.value, cls: c.cls, attrs: { id: c.id },
          onChange: (v) => changed(el, c, r, v, paintOpt),
        });
        segs.set(c.id, { el, c, r, paintOpt });
        el._setValue = (v) => select(el, v);
        return el;
      }
      case 'select': {
        const el = h('select.vfd', { id: c.id, 'aria-label': c.aria },
          c.options.map((o) => h('option', { value: o.v, selected: String(o.v) === String(c.value), text: o.label })));
        el.addEventListener('change', () => changed(el, c, r, el.value, paintOpt));
        el._setValue = (v) => { el.value = v; };
        return el;
      }
      case 'number': {
        const input = h('input.vfd', { type: 'number', id: c.id, value: c.value, min: c.min, max: c.max, step: c.step, 'aria-label': c.aria });
        const el = h('div.num', {}, input, c.unit && h('span.u', { text: c.unit }), c.hint && h('span.h', { text: c.hint }));
        input.addEventListener('change', () => changed(el, c, r, input.value, paintOpt));
        el._setValue = (v) => { input.value = v; };
        return el;
      }
      case 'text': {
        const input = h('input.vfd.txt', { type: 'text', id: c.id, value: c.value, maxlength: c.maxlength, spellcheck: 'false', 'aria-label': c.aria });
        input.addEventListener('change', () => changed(input, c, r, input.value, paintOpt));
        input._setValue = (v) => { input.value = v; };
        return input;
      }
      case 'slider': {
        // Slider + box, one value (crossfeed's .xsl grammar). With `auto`, a `Set manually` box gates it (v1 Blocks per
        // cycle): off = auto.v (the daemon decides) and auto.note under it; on = the slider, starting at auto.manual.
        const a = c.auto;
        const range = h('input', { type: 'range', min: c.min, max: c.max, step: c.step, 'aria-label': c.aria });
        const box = h('input.vfd', { type: 'number', min: c.min, max: c.max, step: c.step, 'aria-label': c.aria });
        const chk = a && h('input', { type: 'checkbox' });
        const note = a && h('span.cap', { text: a.note });
        const sl = h('div.xsl.slx', {}, range, h('div.num', {}, box));
        const el = h('div.slctl', { id: c.id }, a && h('label.chk', {}, chk, a.label), sl, note);
        const paint = (v) => {
          const manual = !a || String(v) !== String(a.v);
          if (chk) chk.checked = manual;
          range.value = box.value = manual ? v : a.manual;
          sl.classList.toggle('grayed', !manual);
          range.disabled = box.disabled = !manual;
          if (note) note.hidden = manual;
        };
        const commit = (v) => { paint(v); changed(el, c, r, String(v), paintOpt); };
        const clamp = (v) => Math.max(c.min, Math.min(c.max, Math.round(Number(v))));
        range.addEventListener('input', () => { box.value = range.value; });
        range.addEventListener('change', () => commit(clamp(range.value)));
        box.addEventListener('change', () => commit(clamp(box.value)));
        chk?.addEventListener('change', () => commit(chk.checked ? a.manual : a.v));
        paint(c.value);
        el._setValue = paint;
        return el;
      }
      case 'toggles': {
        // Independent toggles in seg dress: each button lights on its own (aria-pressed). Value = comma list of lit ones.
        let cur = new Set(String(c.value || '').split(',').filter(Boolean));
        const el = h('div.seg.tgl', { role: 'group', 'aria-label': c.aria, id: c.id },
          c.options.map((o) => h('button', { type: 'button', data: { v: o.v }, text: o.label, on: { click: () => {
            if (cur.has(o.v)) cur.delete(o.v); else cur.add(o.v);
            paint(); changed(el, c, r, [...cur].join(','), paintOpt);
          } } })));
        const paint = () => { for (const b of el.children) { const on = cur.has(b.dataset.v); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
        paint();
        el._setValue = (v) => { cur = new Set(String(v || '').split(',').filter(Boolean)); paint(); };
        return el;
      }
      case 'accent': {
        // v1 AccentPicker: swatches pick a preset; the hex box holds that preset's value and takes any custom #rrggbb.
        const hex = h('input.vfd.hex', { type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Custom accent hex' });
        const sw = c.options.map((o) => h('button.swatch', { type: 'button', title: o.label, 'aria-label': o.label, data: { v: o.v },
          style: `--sw:${o.hex}`, on: { click: () => pickAcc(o.v) } }));
        const el = h('div.accpick', { role: 'group', 'aria-label': c.aria, id: c.id }, sw, hex);
        const paintAcc = (v) => {
          const p = c.options.find((o) => o.v === v);
          for (const b of sw) b.setAttribute('aria-pressed', String(b.dataset.v === v));
          hex.value = p ? p.hex : v;
        };
        function pickAcc(v) { paintAcc(v); changed(el, c, r, v, paintOpt); }
        hex.addEventListener('change', () => {
          const v = hex.value.trim().toLowerCase();
          if (/^#[0-9a-f]{6}$/.test(v)) pickAcc(c.options.find((o) => o.hex === v)?.v ?? v);
          else paintAcc(vals[c.id]);
        });
        paintAcc(c.value);
        el._setValue = paintAcc;
        return el;
      }
      case 'device': {
        const el = h('div.devpick', { id: c.id, data: { kind: c.kind } });
        const dp = mountDevicePicker(el, c, devices[c.kind], () => { vals[c.id] = dp.value(); markDirty(el); });
        vals[c.id] = dp.value();
        el._setValue = dp.setValue;
        return el;
      }
      case 'dial': {
        const el = h('div.dial', { id: c.id, role: 'group', 'aria-label': c.aria });   // each band is its own slider (rate-dial.js)
        const rd = mountRateDial(el, rateTiers, () => { vals[c.id] = rd.value(); markDirty(el); });
        vals[c.id] = rd.value();
        el._setValue = rd.setValue;
        return el;
      }
    }
  }

  /** Vertical radio lines; each line's detail control is live only while that line is picked. */
  function choice(c, r) {
    let cur = String(c.value);
    const lines = c.options.map((o) => {
      const radio = h('button.radio', { type: 'button', role: 'radio', aria: { checked: false, label: o.label },
        on: { click: () => pick(o.v) } });
      const detail = o.control && control(o.control, r);
      return {
        o, radio, detail,
        el: h('div.chline', { data: { v: o.v } },
          h('div.chl', {},
            radio,
            h('span.chn', { on: { click: () => pick(o.v) } }, h('b', { text: o.label }), o.sub && h('span.s', { text: o.sub })),
            detail),
          h('div.man', {}, o.man && h('p', { text: o.man }))),
      };
    });
    const el = h('div.chlist', { role: 'radiogroup', 'aria-label': c.aria, id: c.id }, lines.map((l) => l.el));
    function paint() {
      for (const l of lines) {
        const on = String(l.o.v) === cur;
        l.el.classList.toggle('cur', on);
        l.radio.setAttribute('aria-checked', String(on));
        if (l.detail) {
          l.detail.classList.toggle('grayed', !on);
          for (const x of l.detail.querySelectorAll('button,input')) x.disabled = !on;
        }
      }
    }
    function pick(v) {
      if (String(v) === cur) return;
      cur = String(v);
      paint();
      changed(el, c, r, cur, () => {});
    }
    paint();
    el._setValue = (v) => { cur = String(v); paint(); };
    return el;
  }

  /**
   * Discard (mock): every staged value goes back to the last applied one, the controls and blocks repaint, and the dots
   * clear. Hooks (deps.on) hear the restored values, as they heard the edits (backend groups, cross-effects).
   */
  function discarded() {
    for (const [id, { set, c, r, paintOpt }] of ui) {
      if (vals[id] === base[id] || !(id in base)) continue;
      vals[id] = base[id];
      set(base[id]);
      paintOpt(base[id]);
      if (c.switchesBackend) setBackend(base[id]);
      on[id]?.(base[id]);
    }
    for (const id of blockIds) if (id in base) vals[id] = base[id];   // this member's block values (not another member's)
    for (const fn of discards) fn({ ...base });
  }

  const api = {
    setOpen, showTab, set, regray,
    isOpen: () => !drawer.hasAttribute('data-closed'),
    hasDirty: () => drawer.querySelector('.dirty') !== null,
    /** Apply (mock): this member's staged values take effect (rail follows via onApply), dots clear. */
    applied: () => { onApply?.(vals); Object.assign(base, vals); clearDirty(); },
    /** Discard (mock): this member's staged values go back to the last applied ones; settle() then repaints. */
    discarded,
    settle: () => { regray(); clearDirty(); },
    /** Dirty dots for every value that differs from the base (a staged buffer put back by the Profile builder). */
    remark: () => {
      for (const [id, { el }] of ui) if (vals[id] !== base[id]) markDirty(el);
      for (const [id, el] of blockEl) if (vals[id] !== base[id]) markDirty(el);
    },
  };
  DRAWERS.push(api);
  if (fam) fam.members.push(api);
  return api;
}
