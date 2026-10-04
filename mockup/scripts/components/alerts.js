// Alerts live where they belong (spec: Alerts; homes in data/alerts.js HOMES), never in a strip of their own:
//   - the home blinks: a rail stage's lamp, or a header / engine-row element (brand knob, gear, gauge).
//     Red = crit, amber = warn or advice. The blink overlays the lamp's own state (an unlit HF filter lamp blinks too).
//   - a stage's drawer carries the alert line pinned under its head (glyph, v1's sentence), and the row that fixes it
//     reads in the alert's colour with the glyph before its label.
//   - an alert whose fix lives on the page (the running chain's filter, modulator, ditherer: the drawer drops those rows)
//     sits in that page section's header instead, the line beside the title, over the field that fixes it.
//   - a header element with no drawer opens the alert in a popover on tap (knob, gauge). The gear's alert blinks the Settings rail category too, whose drawer carries the line.
//   - an SDM modulator below its rate floor (no output): every stage after Shaping goes dark (.dead: unlit, no wire tap).
// set(list) repaints everything from scratch; list = [{kind, sev, text, chain?, rows?}] (chain: 'pcm' | 'sdm', whose rows it lights; rows: overrides the
// home's fixing rows, e.g. the filter actually running).

import { h } from '../lib/dom.js';
import { popover } from '../lib/popover.js';
import { toPlate, scale, PLATE_W, PLATE_H } from '../lib/plate.js';
import { HOMES } from '../data/alerts.js';

const GLYPH = { crit: '⚠', warn: '⚠', advice: '♪' };
const RANK = { crit: 2, warn: 1, advice: 0 };
const blink = (sev) => (sev === 'crit' ? 'crit' : 'warn');   // advice blinks amber, like a warning

const line = (a, tag = 'p') => h(`${tag}.aline`, { data: { sev: a.sev } },
  h('span.ag', { 'aria-hidden': 'true', text: GLYPH[a.sev] }), h('span', { text: a.text }));

/**
 * @param {{plate: HTMLElement, stages: Map<string, HTMLElement>, srail: HTMLElement}} o
 */
export function mountAlerts({ plate, stages, srail }) {
  let list = [];

  // Tap popovers for the header homes without a drawer (knob, gauge). The knob's own tap (connection settings) still
  // happens; with an alert up, the alert opens over it.
  const notes = new Map();   // selector → {panel, pop}
  function noteFor(sel) {
    if (notes.has(sel)) return notes.get(sel);
    const trigger = plate.querySelector(sel);
    const panel = h('div.pop.notepop.alnote', { role: 'dialog', 'aria-label': 'Alert' });
    plate.append(panel);
    const pop = popover({ trigger, panel, onToggle: (open) => {
      if (!open) return;
      const mine = list.filter((a) => HOMES[a.kind].el === sel);
      if (!mine.length) { pop.close(); return; }
      panel.replaceChildren(...mine.map((a) => line(a)));
      const r = trigger.getBoundingClientRect(), at = toPlate(r);
      panel.style.left = `${Math.max(22, Math.min(at.x, PLATE_W - 22 - panel.offsetWidth))}px`;
      panel.style.top = `${Math.min(at.y + r.height / scale() + 8, PLATE_H - 14 - panel.offsetHeight)}px`;
    } });
    const n = { panel, pop };
    notes.set(sel, n);
    return n;
  }
  for (const sel of new Set(Object.values(HOMES).filter((x) => x.el && !x.set).map((x) => x.el))) noteFor(sel);

  function clear() {
    for (const el of plate.querySelectorAll('[data-alert]')) el.removeAttribute('data-alert');
    for (const el of plate.querySelectorAll('.dalert, .salert')) el.remove();
    for (const el of plate.querySelectorAll('.st.dead')) el.classList.remove('dead');
    for (const el of plate.querySelectorAll('.gauge[role="button"]')) { el.removeAttribute('role'); el.removeAttribute('tabindex'); }
  }

  /** Worst severity wins on a shared home. */
  function mark(el, sev) {
    if (!el) return;
    const cur = el.dataset.alert;
    if (!cur || RANK[sev] > RANK[cur === 'crit' ? 'crit' : 'warn']) el.dataset.alert = blink(sev);
  }

  function paint() {
    clear();
    const byDrawer = new Map(), bySection = new Map();
    for (const a of list) {
      const home = HOMES[a.kind];
      if (!home) continue;
      if (home.stage) mark(stages.get(home.stage), a.sev);
      if (home.el) mark(plate.querySelector(home.el), a.sev);
      if (home.set) mark(srail.querySelector(`.sst[data-stage="${home.set}"]`), a.sev);
      if (home.drawer) { if (!byDrawer.has(home.drawer)) byDrawer.set(home.drawer, []); byDrawer.get(home.drawer).push(a); }
      if (home.section) { if (!bySection.has(home.section)) bySection.set(home.section, []); bySection.get(home.section).push(a); }
      for (const id of home.dark || []) stages.get(id)?.classList.add('dead');
      if (home.el === '.gauge') { const g = plate.querySelector('.gauge'); g.setAttribute('role', 'button'); g.tabIndex = 0; }
    }
    // Drawer: the alert lines under the head; the fixing rows in the alert's colour.
    for (const [id, as] of byDrawer) {
      const d = plate.querySelector(`#drawer-${id}`);
      if (!d) continue;
      d.querySelector(':scope > .dhead').after(h('div.dalert', { role: 'status' }, as.map((a) => line(a))));
      for (const a of as) for (const label of a.rows || HOMES[a.kind].row || []) {
        // a.chain: a chain alert lights its own chain's rows only (the Resampling · Shaping drawer holds both chains).
        const scope = a.chain ? `.dpanel[aria-label^="${a.chain === 'sdm' ? 'SDM' : 'PCM'}"] ` : '';
        for (const b of d.querySelectorAll(`${scope}.drow .ctl > .fh > b`)) if (b.textContent === label) mark(b.closest('.drow'), a.sev);
      }
    }
    // Page: the section header carries the lines, beside the title (the hairline gives way).
    for (const [name, as] of bySection) {
      const t = plate.querySelector(`#body > main.page > section[aria-label="${name}"] .sh .t`);
      if (!t) continue;
      t.after(h('div.salert', { role: 'status' }, as.map((a) => line(a))));
    }
    window.dispatchEvent(new Event('resize'));   // rail wire: dark stages drop their taps; drawers refit
  }

  // The gauge isn't a button: with an alert up it takes taps and Enter like one.
  plate.querySelector('.gauge')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.currentTarget.dataset.alert) noteFor('.gauge').pop.open();
  });

  return {
    /** @param {{kind: string, sev: 'crit'|'warn'|'advice', text: string}[]} next */
    set(next) {
      list = next;
      for (const { pop } of notes.values()) pop.close();
      paint();
    },
    /** Re-pin after something rebuilt a home (a page section re-rendered). */
    repaint: () => paint(),
  };
}
