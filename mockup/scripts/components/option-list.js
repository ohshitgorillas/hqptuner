// Option lists: the whole filter / modulator / dither list, instead of a native dropdown. Filters fill a bottom sheet
// (lib/sheet.js) over the body; modulators and dithers open as a panel parked at the picker that opened them (PANEL: sized
// to its list, below the picker or above it, inside the plate; an outside tap, ×, Escape or a pick closes it). Same head,
// rows and narrowing in both forms. One sheet, re-filled for whichever list a picker opens. Narrowing is built in: the facet
// bar along its head (narrow-filters.js mountFacetBar).
//
// Placement is custom per list, not a general packing rule: PLACE below. Filters: Polyphase sinc over
// two columns when it needs them (split in list order at the balance point, variants whole), Pure sinc its own column
// (PCM's Misc family under it, then Analog-style under its own `Other` title), then Conventional and Interpolation together
// under `Other`.
// Option style Standard (Visual settings) drops the outline: one flat list in the engine's own order (v1: options 1:1),
// filled down a fixed number of columns (STD_COLS) and reflowed as narrowing thins it; no headers, blurbs, folds or
// column titles. Rows, marks, legend, facet bar and hover tip are the same in both styles.
// The outline is v1's Simplified dropdown: family header (`<Family> family`, the page's section grammar) and its blurb under
// it, variant subheader and its blurb under it, then the rows. Variants fold (v1: the header is the toggle); families don't
//.
// Rows: name (one line) | apodizing mark (v1's circled A / ½) | quality stars (v1: one ★ per point) | heart (♡ / ♥, v1).
// Filters: a key to those marks sits under the Polyphase sinc family (legend()).
// Modulators: name | rate floor badge | heart. Dithers: name.

import { h } from '../lib/dom.js';
import { sheet } from '../lib/sheet.js';
import { closeBtn } from '../lib/controls.js';
import { LISTS, GROUPS } from '../data/option-lists.js';
import { narrowed, subscribe, isFav, toggleFav, kindOf } from '../lib/narrow.js';
import { mountFacetBar } from './narrow-filters.js';
import { optionStyle } from './vselect.js';
import { apodMark } from '../lib/apod.js';
import { toPlate, PLATE_W, PLATE_H } from '../lib/plate.js';
import { BAR } from '../data/narrow-facets.js';
import { ENGINE_ORDER } from '../data/engine-order.js';
import { dacType } from '../lib/dactype.js';
import { PLATFORM } from '../lib/clock.js';


/**
 * Custom placement per list kind: columns left to right. A column holds families top to bottom; `split` gives its one
 * family two columns of named variants when it is taller than one; `title` heads a column of several families (`Other`);
 * `then` adds a titled block under a column's families. A family a list doesn't have (PCM-only Misc) or that narrowing
 * empties just drops.
 */
const PLACE = {
  filters: [
    // Polyphase sinc's two columns, by lineage rather than list order (custom over general): the base,
    // extended and steepest forms | the Gaussian and half-band forms, then the lossy-source pair.
    { fams: ['Polyphase sinc'], split: [
      ['Base', 'Extended frequency response', 'Extended frequency response v2', 'Extreme roll-off and attenuation'],
      ['Gaussian', 'Gaussian half-band', 'Half-band', 'MQA and MP3'],
    ] },
    // Pure sinc (PCM's Misc under it), then Analog-style under its own `Other` title; Conventional and Interpolation
    // under the last column's.
    { fams: ['Pure sinc', 'Misc'], then: { title: 'Other', fams: ['Analog-style'] } },
    { title: 'Other', fams: ['Conventional', 'Interpolation'] },
  ],
  // Modulators: Hybrid over Fixed in the first column, then Adaptive over two.
  modulators: [
    { fams: ['Hybrid', 'Fixed'] },
    { fams: ['Adaptive'], split: [['Fifth order'], ['Seventh order']] },
  ],
  dithers: [{ fams: ['Noise shaping', 'Additive', 'None'] }],   // one column, families stacked (a panel, not a sheet)
};

/**
 * Standard: columns per list kind. Each column holds ceil(full list / columns) rows, so the full list fills them evenly and
 * a narrowed one reflows from the top of the first column (fewer columns, never gaps).
 */
/** List kinds that open as a panel at their picker rather than a sheet over the body. */
const PANEL = new Set(['modulators', 'dithers']);

const STD_COLS = { filters: 3, modulators: 2, dithers: 1 };   // filters: the longest engine name + marks won't fit four across at 10.2″
const engIdx = (list, v) => { const i = ENGINE_ORDER[list].indexOf(String(v)); return i < 0 ? Infinity : i; };

// ── Hover tip (v1 components/controls/Combobox.js TipPop + narrowbar/facettip.js) ─────────────────────────────────
// The card beside a hovered row: the raw engine name while Simplified display hides it, the option's manual prose (v1
// prose.js: Simplified keeps description + notes; Standard adds the two-stage notes), then the facet rows in the narrowing
// bar's own words and the boolean chips. Modulators add their Generation row. Labels come from the facet bar so the tip and
// the chips never disagree on a spelling (v1 rule).
const FACET = Object.fromEntries(BAR.flat().filter((f) => f.options).map((f) => [f.key, Object.fromEntries(f.options.map((o) => [o.v, o.label]))]));
const RATIO = { integer: 'Integer', '2x': '2x', '1:1': '1:1', any: 'Any' };   // v1 facet-data.js RATIOS + "Any" (facettip.js)
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];       // v1 options.js GENERATION_ORDINALS
function tipRows(o) {
  const f = o.f, rows = [];
  if (!f) return o.gen && ORD[o.gen] ? [['Generation', ORD[o.gen]]] : [];
  if (f.q != null) rows.push(['Quality', `${f.q}/5`]);
  if (f.genre.length) rows.push(['Genre', f.genre.map((g) => FACET.genre[g] ?? g).join(', ')]);
  if (f.focus.length) rows.push(['Focus', f.focus.map((g) => FACET.focus[g] ?? g).join(', ')]);
  if (f.phase) rows.push(['Phase', FACET.phase[f.phase] ?? f.phase]);
  if (f.len || f.adaptive) rows.push(['Length', f.adaptive ? (f.len ? `${FACET.length[f.len]}, adaptive` : FACET.length.adaptive) : FACET.length[f.len]]);
  const ratio = f.ratio != null ? RATIO[f.ratio] ?? f.ratio
    : [f.ratioPcm != null && `PCM ${RATIO[f.ratioPcm] ?? f.ratioPcm}`, f.ratioSdm != null && `SDM ${RATIO[f.ratioSdm] ?? f.ratioSdm}`].filter(Boolean).join(' · ');
  if (ratio) rows.push(['Ratio', ratio]);
  return rows;
}
const tipChips = (o) => (o.f ? [o.f.apod === 'half' ? 'Half apodizing' : o.f.apod === 'full' ? 'Apodizing' : '', o.f.up ? 'Upsample only' : ''].filter(Boolean) : []);

const folded = new Set();   // collapsed groups, keyed per kind (v1: the two chains' filter lists share one fold)
// DAC type (lib/dactype.js) collapses the groups the manual calls the wrong fit; a tap still opens them. `byDac` = the keys
// it folded.
const byDac = new Set();
function dacFolds({ r2r, ess }) {
  for (const k of byDac) folded.delete(k);
  byDac.clear();
  const keys = [...(r2r === '1' ? ['dithers|Additive|*'] : []),
    ...(ess === '1' ? ['Fixed', 'Adaptive', 'Hybrid'].map((f) => `modulators|${f}|Seventh order`) : [])];
  for (const k of keys) { folded.add(k); byDac.add(k); }
}
dacFolds(dacType());

/**
 * @param {HTMLElement} plate
 * @param {import('../lib/bus.js').Bus} bus   folds follow `dactype`; the open list re-renders on `relayout`
 * @param {import('../lib/clock.js').Clock} [clock]
 */
export function mountOptionList(plate, bus, clock = PLATFORM) {
  bus.on('dactype', (d) => { dacFolds(d); render(); });
  const sh = sheet(plate, { id: 'osheet', aria: 'Options', cls: 'osheet' });
  const t = h('span.t'), n = h('span.ocount');
  const bar = mountFacetBar(plate);
  // Title over its count (two lines: the facet bar gets the width). No chain tag: the list is the running chain's.
  sh.head.append(h('span.ttl', {}, t, h('span.tsub', {}, n)), bar.el, closeBtn(() => sh.close(), 'Close list'));
  const cols = h('div.ocols');
  sh.body.append(cols);
  const tip = h('div.otip', { role: 'tooltip', hidden: true });
  plate.append(tip);
  let tipRow = null, tipOpt = null;
  function showTip(o, rowEl) {
    tipOpt = o;
    const std = optionStyle() === 'standard';
    const text = std ? o.d2 || o.d : o.d;
    const rows = tipRows(o), chips = tipChips(o);
    tip.replaceChildren(...[
      !std && h('div.tn', { text: o.v }),
      text && h('div.td', { text }),
      rows.length && h('div.tr', {}, rows.map(([k, v]) => [h('span.tk', { text: k }), h('span.tv', { text: v })])),
      chips.length && h('div.tc', {}, chips.map((c) => h('span', { text: c }))),
    ].filter(Boolean));
    tip.hidden = false;
    tipRow = rowEl;
    // Beside the row's column: right of it when there's room, else left; top on the row, clamped inside the plate.
    const col = rowEl.closest('.ocol') || rowEl;
    const c = toPlate(col.getBoundingClientRect()), r = toPlate(rowEl.getBoundingClientRect());
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    const right = c.x + col.offsetWidth + 10;
    const x = right + w <= PLATE_W - 12 ? right : Math.max(12, c.x - w - 10);
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(Math.max(12, Math.min(r.y - 4, PLATE_H - 12 - hgt)))}px`;
  }
  const hideTip = (rowEl) => { if (!rowEl || rowEl === tipRow) { tip.hidden = true; tipRow = null; tipOpt = null; } };
  sh.onClose = () => hideTip();

  let cur = null;   // {list, stage, value, onPick, title}

  function open(o) {
    const kind0 = kindOf(o.list);
    // A panel's picker toggles it: a second tap on the same picker closes it.
    if (sh.isOpen && PANEL.has(kind0) && cur?.trigger && cur.trigger === o.trigger) { sh.close(); return; }
    cur = o;
    t.textContent = o.title;
    t.title = o.sub || '';
    const kind = kindOf(o.list);
    bar.show(kind, o.stage);
    sh.el.dataset.kind = kind;
    sh.el.dataset.style = optionStyle();
    sh.el.classList.toggle('opanel', PANEL.has(kind));
    sh.open();
    if (PANEL.has(kind)) sh.el.style.height = 'auto'; else sh.el.style.left = '';   // the sheet: sheet.js sets top / height
    bar.fit();
    render();
  }

  /**
   * Park the panel at its picker: left edges aligned (clamped inside the plate), below it when it fits, else above, else
   * as low as the plate allows (the picker may sit under it then; the list is what's needed).
   */
  function park() {
    const el = sh.el, tr = cur?.trigger;
    const w = el.offsetWidth, hh = el.offsetHeight;
    let x = (PLATE_W - w) / 2, y = (PLATE_H - hh) / 2;
    if (tr?.isConnected && tr.offsetParent) {
      const r = toPlate(tr.getBoundingClientRect()), th = tr.offsetHeight;
      x = r.x;
      const below = r.y + th + 6, above = r.y - hh - 6;
      y = below + hh <= PLATE_H - 12 ? below : above >= 12 ? above : PLATE_H - 12 - hh;
    }
    el.style.left = `${Math.round(Math.max(12, Math.min(x, PLATE_W - 12 - w)))}px`;
    el.style.top = `${Math.round(Math.max(12, y))}px`;
  }

  // A panel closes on a tap outside it (its picker toggles it; facet popovers and notes opened from it count as inside).
  document.addEventListener('click', (e) => {
    if (!sh.isOpen || !sh.el.classList.contains('opanel') || !e.target.isConnected) return;
    if (sh.el.contains(e.target) || cur?.trigger?.contains(e.target) || e.target.closest('.pop')) return;
    hideTip();
    sh.close();
  });

  // ── Parts ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const gr = () => GROUPS[kindOf(cur.list)];
  const vkey = (f, v) => `${kindOf(cur.list)}|${f}|${v}`;
  function toggle(k) { folded.has(k) ? folded.delete(k) : folded.add(k); render(); }

  /**
   * Family header: `<Family> family`, engraved, its rule running to the column's (band's) right edge and turning down there,
   * so the header visibly covers every column it heads; its blurb under it (v1). Families don't fold.
   */
  function famHead(f, sub) {
    // A family without variants (dithers) folds at its header when DAC type collapses it (or the user taps it).
    const bare = kindOf(cur.list) === 'dithers';
    const k = vkey(f, '*');
    const shut = bare && folded.has(k);
    const name = bare
      ? h('button.ohd.ofold', { type: 'button', aria: { expanded: !shut }, on: { click: () => toggle(k) } }, `${f} family`)
      : h('span.ohd', { text: `${f} family` });
    return h('div.ofam', { class: sub && 'sub' },
      h('div.ofh', {}, name, !sub && h('span.ln')),
      !shut && gr().families[f] && h('div.oblurb', { text: gr().families[f] }));
  }
  /** Variant: subheader + its blurb (v1), then its rows; or bare rows for a family without variants. */
  function group(f, v, rows) {
    const k = vkey(f, v || '*');
    const shut = folded.has(k);
    const b = v && gr().variants[`${f}|${v}`];
    return h('div.ogrp', { class: v ? 'var' : 'bare' },
      v && h('button.osub', { type: 'button', aria: { expanded: !shut }, on: { click: () => toggle(k) } }, v),
      v && !shut && b && h('div.oblurb', { text: b }),
      !shut && rows.map(row));
  }
  function row(o) {
    const on = String(o.v) === String(cur.value);
    const kind = kindOf(cur.list);
    const q = o.f?.q;
    const fav = isFav(cur.list, o.v);
    return h('div.orow', { role: 'option', tabindex: -1, data: { v: o.v }, aria: { selected: on }, on: {
      click: () => pick(o.v),
      pointerenter: (e) => e.pointerType !== 'touch' && showTip(o, e.currentTarget),
      pointerleave: (e) => hideTip(e.currentTarget),
      focus: (e) => showTip(o, e.currentTarget),
      blur: (e) => hideTip(e.currentTarget),
    } },
      h('span.nm', { text: optionStyle() === 'standard' ? o.v : o.leaf }),   // Visual settings → Option style
      kind === 'filters' && h('span.mk', {}, apodMark(o.f?.apod)),
      kind === 'filters' && h('span.qst', { aria: { label: q ? `Quality ${q}/5` : null }, text: q ? '★'.repeat(q) : '' }),
      kind === 'modulators' && h('span.mk', {}, o.tier && h('span.otier', { role: 'img', aria: { label: `Needs DSD${o.tier.slice(0, -1)} or higher` }, text: o.tier })),
      kind !== 'dithers' && h('button.fav', { type: 'button', class: fav && 'on', aria: { pressed: fav, label: `${fav ? 'Unfavorite' : 'Favorite'} ${o.v}` },
        text: fav ? '♥' : '♡', on: { click: (e) => { e.stopPropagation(); toggleFav(cur.list, o.v); } } }),
    );
  }

  /**
   * Key to the filter rows' marks, under the Polyphase sinc family: v1's `glyph = word` legend grammar (Combobox
   * `✓ = recommended`), words from v1's own labels for each mark (apod.js APOD_LABEL, the Quality facet, Favorite).
   */
  const legend = () => h('div.olegend', { role: 'presentation' },
    h('span', {}, apodMark('full'), ' = Apodizing'),
    h('span', {}, apodMark('half'), ' = Half apodizing'),
    h('span', {}, h('span.lq', { text: '★' }), ' = Quality'),
    h('span', {}, h('span.lf', { text: '♥' }), ' = Favorite'));

  /** The list as families → groups (variant or bare) → options, after narrowing, in overlay order. */
  function tree() {
    const opts = narrowed(cur.list, cur.stage, cur.value);
    const fams = new Map();
    for (const o of opts) {
      if (!fams.has(o.fam)) fams.set(o.fam, new Map());
      const g = fams.get(o.fam);
      const v = o.var ?? '';
      if (!g.has(v)) g.set(v, []);
      g.get(v).push(o);
    }
    return { opts, fams };
  }

  // ── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────
  function render() {
    if (!cur || !sh.isOpen) return;
    const keepTip = tipOpt;   // the rows are rebuilt (narrowing, favorites, folds, a late font): the tip follows its option
    const { opts, fams } = tree();
    n.textContent = `${opts.length} of ${LISTS[cur.list].length}`;
    sh.el.dataset.style = optionStyle();
    if (optionStyle() === 'standard') { cols.replaceChildren(...flat(opts)); placed(keepTip); return; }
    const H = cols.clientHeight;
    cols.replaceChildren();
    const out = [];
    const titled = (title, fs) => [h('div.ofam.ctitle', {}, h('div.ofh', {}, h('span.ohd.static', { text: title }), h('span.ln'))),
      fs.map((f) => h('div.ostack', {}, parts(f, true)))];
    const parts = (f, sub) => [famHead(f, sub), ...[...fams.get(f)].map(([v, rows]) => group(f, v, rows))];
    for (const c of PLACE[kindOf(cur.list)]) {
      const fs = c.fams.filter((f) => fams.has(f));
      const more = c.then ? c.then.fams.filter((f) => fams.has(f)) : [];
      if (!fs.length && !more.length) continue;
      if (c.split) {
        // Two columns in the given variant order.
        const f = fs[0];
        const head = famHead(f);
        const vs = fams.get(f);
        const colOf = (names) => names.filter((v) => vs.has(v)).map((v) => group(f, v, vs.get(v)));
        const [a, b] = c.split.map(colOf);
        // Always two columns while both halves have rows, so the columns keep their places as narrowing thins the list.
        const key = kindOf(cur.list) === 'filters' && legend();   // the row marks' key, under Polyphase sinc
        out.push(a.length && b.length
          ? h('div.oband', {}, head, h('div.osubs', {}, h('div.ocol', {}, a), h('div.ocol', {}, b)), key)
          : h('div.ocol', {}, head, a, b, key));
        continue;
      }
      out.push(h('div.ocol', { class: c.title && 'titled' },
        c.title ? titled(c.title, fs) : fs.map((f) => h('div.ostack', {}, parts(f, false))),
        more.length > 0 && h('div.othen', {}, titled(c.then.title, more))));
    }
    cols.replaceChildren(...out);
    placed(keepTip);
  }

  /** After a render: a panel re-parks (its size follows the list), then the tip follows its option. */
  function placed(keepTip) {
    if (sh.el.classList.contains('opanel')) park();
    keep(keepTip);
  }

  function keep(keepTip) {
    if (!keepTip) return;
    const again = [...cols.querySelectorAll('.orow')].find((r) => r.dataset.v === String(keepTip.v));
    again ? showTip(keepTip, again) : hideTip();
  }

  /** Standard: the narrowed list in engine order, down column after column; the filter marks' key along the foot. */
  function flat(opts) {
    const kind = kindOf(cur.list);
    const per = Math.ceil(LISTS[cur.list].length / STD_COLS[kind]);
    const list = [...opts].sort((a, b) => engIdx(cur.list, a.v) - engIdx(cur.list, b.v));
    const out = [];
    for (let i = 0; i < list.length; i += per) out.push(h('div.ocol.flat', {}, list.slice(i, i + per).map(row)));
    if (kind === 'filters') out.push(legend());
    return out;
  }

  function pick(v) {
    hideTip();
    cur.value = v;
    cur.onPick?.(v);
    sh.close();
  }

  subscribe(() => render());
  bus.on('relayout', () => clock.requestAnimationFrame(render));
  return { open, close: () => sh.close(), sheet: sh };
}
