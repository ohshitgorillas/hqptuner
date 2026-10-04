// VFD select over an option catalog (data/conversion-catalog.js): plain short title shown, engine name as the value.
// Options carrying a `group` (plain-name family) sit under optgroups, families in first-appearance order, engine order
// kept inside each family. Shared by the page sections and the stage drawer so both homes list the same thing.

import { h } from '../lib/dom.js';
import { TWO_STAGE, CATALOG } from '../data/conversion-catalog.js';
import { popover } from '../lib/popover.js';
import { placeBy } from '../lib/plate.js';
import { optionOf } from '../model/options.js';

/**
 * @param {object} o
 * @param {{v:string,label:string,group?:string}[]} o.options
 * @param {string} o.value
 * @param {string} o.aria
 * @param {string} [o.id]
 * @param {string} [o.cls]   extra classes (e.g. 'dim' for an idle field)
 * @param {(v:string)=>void} [o.onChange]
 */
// Visual settings → Option style (v1 plainNames): Simplified (the mock's state) prints the plain titles, Standard the engine
// names. One switch for every chain select, page and drawer, including those built later.
let style = 'simplified';
const optText = (plain, engine) => (style === 'standard' ? engine : plain);
/** @param {import('../lib/bus.js').Bus} bus */
export function setOptionStyle(s, bus) {
  style = s;
  for (const o of document.querySelectorAll('select option[data-plain], button.vpick[data-plain]')) o.textContent = optText(o.dataset.plain, o.value);
  bus.emit('optstyle', s);   // the page's chain pickers re-render (conversion.js)
}
export const optionStyle = () => style;

// The chain lists (filters, dithers, modulators) open their whole list in a bottom sheet (components/option-list.js)
// rather than a native dropdown: the picker is a button wearing the select's VFD skin. main.js hands in the opener.
const LIST_OF = new Map([[CATALOG.pcmFilters, 'pcmFilters'], [CATALOG.sdmFilters, 'sdmFilters'], [CATALOG.modulators, 'modulators'], [CATALOG.dithers, 'dithers']]);
let openList = null;
export const setListOpener = (fn) => { openList = fn; };
/** Open a chain list from any trigger (the page's chain pickers, components/chain-pick.js). */
export const openPicker = (o) => openList?.(o);

const labelOf = (options, v) => optionOf(options, v)?.label ?? String(v);
/** The picker's face: the plain title kept for the style switch, the title the style prints. */
const showPick = (el, options, cur) => { el.dataset.plain = labelOf(options, cur); el.textContent = optText(labelOf(options, cur), cur); };

function picker({ options, value, aria, id, cls, onChange, list }) {
  const el = h('button.vfd.vpick', { type: 'button', id, class: cls, 'aria-label': aria, aria: { haspopup: 'dialog' } });
  let cur = String(value);
  Object.defineProperty(el, 'value', { get: () => cur, set: (v) => { cur = String(v); showPick(el, options, cur); }, configurable: true });
  el.value = cur; showPick(el, options, cur);
  // Which chain, stage and field: from the id (page `pg-sdm1x`, drawer `cv-sdm-sdm1x`).
  const m = String(id).match(/(pcm|sdm)(1x|nx|sh)$/);
  el.addEventListener('click', () => openList?.({
    trigger: el, list, stage: m?.[2] === 'nx' ? 'nx' : '1x', chain: m?.[1], field: m ? m[1] + m[2] : '', value: cur,
    onPick: (v) => { el.value = v; onChange?.(v); },
  }));
  return el;
}

/** One option of a native select, selected when it is `value`. */
const optionEl = (o, value) => h('option', { value: o.v, text: optText(o.label, String(o.v)), data: { plain: o.label }, selected: String(o.v) === String(value) });

export function vselect({ options, value, aria, id, cls, onChange }) {
  if (LIST_OF.has(options)) return picker({ options, value, aria, id, cls, onChange, list: LIST_OF.get(options) });
  const groups = new Map();
  const loose = [];
  for (const o of options) {
    if (!o.group) { loose.push(o); continue; }
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group).push(o);
  }
  const el = h('select.vfd', { id, class: cls, 'aria-label': aria },
    loose.map((o) => optionEl(o, value)),
    [...groups].map(([g, list]) => h('optgroup', { label: g }, list.map((o) => optionEl(o, value)))),
  );
  el.value = String(value);
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  return el;
}

/**
 * The option's manual line: `<code>engine name</code> — prose`, or the name alone when the overlay has none. A two-stage
 * ('-2s') option's shared note follows collapsed to its lead-in, `Two stage oversampling: … see more` (the full note pushed the page past the plate). `see more` opens the whole note in a popover under the link, so the page
 * never reflows (standard popover rules: one open, outside tap / Escape closes).
 */
export function optCopy(options, v) {
  const o = optionOf(options, v);
  const out = [h('code', { text: String(v) }), o?.man ? ' — ' + o.man : ''];
  if (o?.twoStage) {
    const cut = TWO_STAGE.indexOf(':') + 1;
    out.push(' ', h('span.twostage', {}, TWO_STAGE.slice(0, cut), ' ', seeMore('Two stage oversampling', [TWO_STAGE])));
  }
  return out;
}

/** `… see more`: opens `paras` in a popover under the link (built on first tap; popover() toggles after). */
export function seeMore(label, paras) {
  const more = h('button.seemore', { type: 'button', text: '… see more', aria: { haspopup: 'dialog' } });
  more.addEventListener('click', () => notePop(more, label, paras), { once: true });
  return more;
}

/**
 * Page copy that would push a section off the page (copy never moves Output off the plate): the option
 * line keeps its token and as much prose as fits in `maxH`, then `… see more` (the two-stage note's grammar) opens it whole.
 */
export function fitCopy(host, options, v, maxH) {
  host.replaceChildren(...optCopy(options, v).filter(Boolean));
  if (host.offsetHeight <= maxH) return;
  const o = optionOf(options, v);
  const fit = { v, o, words: [o?.man || '', o?.twoStage ? TWO_STAGE : ''].join(' ').trim().split(/\s+/) };
  let lo = 0, hi = fit.words.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); fitAt(host, fit, mid); if (host.offsetHeight <= maxH) lo = mid; else hi = mid - 1; }
  fitAt(host, fit, lo);
}

/** The option line cut to its first `n` words of prose, then `… see more` opening the whole of it. */
function fitAt(host, { v, o, words }, n) {
  host.replaceChildren(h('code', { text: String(v) }), n ? ' — ' + words.slice(0, n).join(' ') + ' ' : ' ',
    seeMore(String(v), [o?.man, o?.twoStage && TWO_STAGE].filter(Boolean)));
}

/** Any button that opens `paras` in a note popover under it (built on first tap; popover() toggles after). */
export function noteOn(btn, label, paras) {
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.addEventListener('click', () => notePop(btn, label, paras), { once: true });
  return btn;
}

/** Plate-level popover holding a full note, parked under its link and clamped inside the plate. */
function notePop(trigger, label, paras) {
  const plate = document.getElementById('plate');
  const panel = h('div.pop.notepop', { role: 'dialog', 'aria-label': label }, paras.map((t) => h('p', { text: t })));
  plate.append(panel);
  const pop = popover({ trigger, panel, onToggle: (open) => {
    if (!open) return;
    // No room below: open above the link.
    const { left, top } = placeBy(panel, trigger, { side: 22, foot: 14, at: { x: 'start', y: 'flip', gap: 6 } });
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  } });
  pop.open();
}
