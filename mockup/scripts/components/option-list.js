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
import { tipContent, tipAt, parkAt, groupTree, columns, flatColumns } from '../model/option-list.js';


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

// ── Hover tip (v1 components/controls/Combobox.js TipPop + narrowbar/facettip.js) ─────────────────────────────────
// The card beside a hovered row: the raw engine name while Simplified display hides it, the option's manual prose (v1
// prose.js: Simplified keeps description + notes; Standard adds the two-stage notes), then the facet rows in the narrowing
// bar's own words and the boolean chips. Modulators add their Generation row. Labels come from the facet bar so the tip and
// the chips never disagree on a spelling (v1 rule). What it says and where it lands: model/option-list.js.
const FACET = Object.fromEntries(BAR.flat().filter((f) => f.options).map((f) => [f.key, Object.fromEntries(f.options.map((o) => [o.v, o.label]))]));

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
  const ui = chrome(plate);
  bus.on('dactype', (d) => { dacFolds(d); render(ui); });
  ui.sh.onClose = () => hideTip(ui);
  // A panel closes on a tap outside it (its picker toggles it; facet popovers and notes opened from it count as inside).
  document.addEventListener('click', (e) => outside(ui, e));
  subscribe(() => render(ui));
  bus.on('relayout', () => clock.requestAnimationFrame(() => render(ui)));
  return { open: (o) => open(ui, o), close: () => ui.sh.close(), sheet: ui.sh };
}

/**
 * The one sheet, its head (title over its count, facet bar, ×), the columns' host and the plate-level tip; `cur` is the
 * open list ({list, stage, value, onPick, title}), `tipRow` / `tipOpt` the row and option the tip shows.
 */
function chrome(plate) {
  const sh = sheet(plate, { id: 'osheet', aria: 'Options', cls: 'osheet' });
  const t = h('span.t'), n = h('span.ocount');
  const bar = mountFacetBar(plate);
  // Title over its count (two lines: the facet bar gets the width). No chain tag: the list is the running chain's.
  sh.head.append(h('span.ttl', {}, t, h('span.tsub', {}, n)), bar.el, closeBtn(() => sh.close(), 'Close list'));
  const cols = h('div.ocols');
  sh.body.append(cols);
  const tip = h('div.otip', { role: 'tooltip', hidden: true });
  plate.append(tip);
  return { sh, t, n, bar, cols, tip, cur: null, tipRow: null, tipOpt: null };
}

function showTip(ui, o, rowEl) {
  const tip = ui.tip;
  ui.tipOpt = o;
  const c = tipContent(o, optionStyle() === 'standard', FACET);
  tip.replaceChildren(...[
    c.name !== null && h('div.tn', { text: c.name }),
    c.text && h('div.td', { text: c.text }),
    c.rows.length && h('div.tr', {}, c.rows.map(([k, v]) => [h('span.tk', { text: k }), h('span.tv', { text: v })])),
    c.chips.length && h('div.tc', {}, c.chips.map((x) => h('span', { text: x }))),
  ].filter(Boolean));
  tip.hidden = false;
  ui.tipRow = rowEl;
  const col = rowEl.closest('.ocol') || rowEl;
  const at = tipAt({
    col: { x: toPlate(col.getBoundingClientRect()).x, w: col.offsetWidth },
    rowY: toPlate(rowEl.getBoundingClientRect()).y,
    tip: { w: tip.offsetWidth, h: tip.offsetHeight },
    plate: { w: PLATE_W, h: PLATE_H },
  });
  tip.style.left = `${at.left}px`;
  tip.style.top = `${at.top}px`;
}

function hideTip(ui, rowEl) {
  if (!rowEl || rowEl === ui.tipRow) { ui.tip.hidden = true; ui.tipRow = null; ui.tipOpt = null; }
}

function open(ui, o) {
  const { sh, bar } = ui;
  const kind0 = kindOf(o.list);
  // A panel's picker toggles it: a second tap on the same picker closes it.
  if (sh.isOpen && PANEL.has(kind0) && ui.cur?.trigger && ui.cur.trigger === o.trigger) { sh.close(); return; }
  ui.cur = o;
  ui.t.textContent = o.title;
  ui.t.title = o.sub || '';
  const kind = kindOf(o.list);
  bar.show(kind, o.stage);
  sh.el.dataset.kind = kind;
  sh.el.dataset.style = optionStyle();
  sh.el.classList.toggle('opanel', PANEL.has(kind));
  sh.open();
  if (PANEL.has(kind)) sh.el.style.height = 'auto'; else sh.el.style.left = '';   // the sheet: sheet.js sets top / height
  bar.fit();
  render(ui);
}

/** Park the panel at its picker (model/option-list.js parkAt); centered when the picker isn't showing. */
function park(ui) {
  const el = ui.sh.el, tr = ui.cur?.trigger;
  const panel = { w: el.offsetWidth, h: el.offsetHeight };
  const shown = tr?.isConnected && tr.offsetParent;
  const trigger = shown ? { ...toPlate(tr.getBoundingClientRect()), h: tr.offsetHeight } : null;
  const at = parkAt({ panel, trigger, plate: { w: PLATE_W, h: PLATE_H } });
  el.style.left = `${at.left}px`;
  el.style.top = `${at.top}px`;
}

function outside(ui, e) {
  const { sh } = ui;
  if (!sh.isOpen || !sh.el.classList.contains('opanel') || !e.target.isConnected) return;
  if (sh.el.contains(e.target) || ui.cur?.trigger?.contains(e.target) || e.target.closest('.pop')) return;
  hideTip(ui);
  sh.close();
}

// ── Parts ─────────────────────────────────────────────────────────────────────────────────────────────────────
const gr = (ui) => GROUPS[kindOf(ui.cur.list)];
const vkey = (ui, f, v) => `${kindOf(ui.cur.list)}|${f}|${v}`;
function toggle(ui, k) { folded.has(k) ? folded.delete(k) : folded.add(k); render(ui); }

/**
 * Family header: `<Family> family`, engraved, its rule running to the column's (band's) right edge and turning down there,
 * so the header visibly covers every column it heads; its blurb under it (v1). Families don't fold.
 */
function famHead(ui, f, sub) {
  // A family without variants (dithers) folds at its header when DAC type collapses it (or the user taps it).
  const bare = kindOf(ui.cur.list) === 'dithers';
  const k = vkey(ui, f, '*');
  const shut = bare && folded.has(k);
  const name = bare
    ? h('button.ohd.ofold', { type: 'button', aria: { expanded: !shut }, on: { click: () => toggle(ui, k) } }, `${f} family`)
    : h('span.ohd', { text: `${f} family` });
  return h('div.ofam', { class: sub && 'sub' },
    h('div.ofh', {}, name, !sub && h('span.ln')),
    !shut && gr(ui).families[f] && h('div.oblurb', { text: gr(ui).families[f] }));
}
/** Variant: subheader + its blurb (v1), then its rows; or bare rows for a family without variants. */
function group(ui, f, v, rows) {
  const k = vkey(ui, f, v || '*');
  const shut = folded.has(k);
  const b = v && gr(ui).variants[`${f}|${v}`];
  return h('div.ogrp', { class: v ? 'var' : 'bare' },
    v && h('button.osub', { type: 'button', aria: { expanded: !shut }, on: { click: () => toggle(ui, k) } }, v),
    v && !shut && b && h('div.oblurb', { text: b }),
    !shut && rows.map((o) => row(ui, o)));
}
function row(ui, o) {
  const cur = ui.cur;
  const on = String(o.v) === String(cur.value);
  const kind = kindOf(cur.list);
  const q = o.f?.q;
  const fav = isFav(cur.list, o.v);
  return h('div.orow', { role: 'option', tabindex: -1, data: { v: o.v }, aria: { selected: on }, on: {
    click: () => pick(ui, o.v),
    pointerenter: (e) => e.pointerType !== 'touch' && showTip(ui, o, e.currentTarget),
    pointerleave: (e) => hideTip(ui, e.currentTarget),
    focus: (e) => showTip(ui, o, e.currentTarget),
    blur: (e) => hideTip(ui, e.currentTarget),
  } },
    h('span.nm', { text: optionStyle() === 'standard' ? o.v : o.leaf }),   // Visual settings → Option style
    kind === 'filters' && h('span.mk', {}, apodMark(o.f?.apod)),
    kind === 'filters' && h('span.qst', { aria: { label: q ? `Quality ${q}/5` : null }, text: q ? '★'.repeat(q) : '' }),
    kind === 'modulators' && h('span.mk', {}, o.tier && h('span.otier', { role: 'img', aria: { label: `Needs DSD${o.tier.slice(0, -1)} or higher` }, text: o.tier })),
    kind !== 'dithers' && h('button.fav', { type: 'button', class: fav && 'on', aria: { pressed: fav, label: `${fav ? 'Unfavorite' : 'Favorite'} ${o.v}` },
      text: fav ? '♥' : '♡', on: { click: (e) => { e.stopPropagation(); toggleFav(ui.cur.list, o.v); } } }),
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

/** A family's header, then its groups in list order. */
const parts = (ui, fams, f, sub) => [famHead(ui, f, sub), ...[...fams.get(f)].map(([v, rows]) => group(ui, f, v, rows))];
/** A column title (`Other`) over its families. */
const titled = (ui, fams, title, fs) => [h('div.ofam.ctitle', {}, h('div.ofh', {}, h('span.ohd.static', { text: title }), h('span.ln'))),
  fs.map((f) => h('div.ostack', {}, parts(ui, fams, f, true)))];

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────
function render(ui) {
  const { cur, sh, cols } = ui;
  if (!cur || !sh.isOpen) return;
  const keepTip = ui.tipOpt;   // the rows are rebuilt (narrowing, favorites, folds, a late font): the tip follows its option
  const opts = narrowed(cur.list, cur.stage, cur.value);
  ui.n.textContent = `${opts.length} of ${LISTS[cur.list].length}`;
  sh.el.dataset.style = optionStyle();
  if (optionStyle() === 'standard') { cols.replaceChildren(...flat(ui, opts)); placed(ui, keepTip); return; }
  cols.replaceChildren();
  const fams = groupTree(opts);
  cols.replaceChildren(...columns(PLACE[kindOf(cur.list)], fams).map((c) => (c.kind === 'split' ? splitCol(ui, fams, c) : stackCol(ui, fams, c))));
  placed(ui, keepTip);
}

/** A split family: two columns under one header while both halves have rows, else one; the filter marks' key under it. */
function splitCol(ui, fams, c) {
  const head = famHead(ui, c.fam);
  const vs = fams.get(c.fam);
  const [a, b] = c.halves.map((names) => names.map((v) => group(ui, c.fam, v, vs.get(v))));
  const key = kindOf(ui.cur.list) === 'filters' && legend();   // the row marks' key, under Polyphase sinc
  return c.band
    ? h('div.oband', {}, head, h('div.osubs', {}, h('div.ocol', {}, a), h('div.ocol', {}, b)), key)
    : h('div.ocol', {}, head, a, b, key);
}

/** A column of stacked families, or of titled ones; its `then` block under them. */
function stackCol(ui, fams, c) {
  return h('div.ocol', { class: c.title && 'titled' },
    c.title ? titled(ui, fams, c.title, c.fams) : c.fams.map((f) => h('div.ostack', {}, parts(ui, fams, f, false))),
    c.then && h('div.othen', {}, titled(ui, fams, c.then.title, c.then.fams)));
}

/** After a render: a panel re-parks (its size follows the list), then the tip follows its option. */
function placed(ui, keepTip) {
  if (ui.sh.el.classList.contains('opanel')) park(ui);
  keep(ui, keepTip);
}

function keep(ui, keepTip) {
  if (!keepTip) return;
  const again = [...ui.cols.querySelectorAll('.orow')].find((r) => r.dataset.v === String(keepTip.v));
  again ? showTip(ui, keepTip, again) : hideTip(ui);
}

/** Standard: the narrowed list in engine order, down column after column; the filter marks' key along the foot. */
function flat(ui, opts) {
  const kind = kindOf(ui.cur.list);
  const order = { total: LISTS[ui.cur.list].length, cols: STD_COLS[kind], order: ENGINE_ORDER[ui.cur.list] };
  const out = flatColumns(opts, order).map((rows) => h('div.ocol.flat', {}, rows.map((o) => row(ui, o))));
  if (kind === 'filters') out.push(legend());
  return out;
}

function pick(ui, v) {
  hideTip(ui);
  ui.cur.value = v;
  ui.cur.onPick?.(v);
  ui.sh.close();
}
