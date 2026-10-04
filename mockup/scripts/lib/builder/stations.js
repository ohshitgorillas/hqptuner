// The shell's name box and its stations menu (the stations Save writes to).

import { h } from '../dom.js';
import { popover } from '../popover.js';
import { shownName, toggleStation, heldAt } from '../../model/builder.js';

/** @typedef {import('./record.js').Shell} Shell */

/**
 * A record's name box: `onName` hears the trimmed name as it is typed; Enter leaves the box.
 *
 * @param {object} attrs
 * @param {(name: string) => void} onName
 */
export function nameInput(attrs, onName) {
  const box = /** @type {HTMLInputElement} */ (h('input.bnin', attrs));
  box.addEventListener('input', () => onName(box.value.trim()));
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.blur(); });
  return box;
}

/**
 * A walk's name box: typing names the edit, clears the refusal and repaints.
 *
 * @param {any} walk
 * @param {Shell} sh
 * @param {() => void} repaint
 */
export const walkNameBox = (walk, sh, repaint) => (walk
  ? nameInput(walk.nameBox, (v) => { walk.setName(v); sh.refused = false; repaint(); })
  : null);

/**
 * Paint the stations trigger and menu rows.
 *
 * @param {Shell} sh
 * @param {any} spec
 * @param {{ ticked: () => string[], pick: (list: string[]) => void, name: () => string }} o
 * @param {{ txt: HTMLElement, trigger: HTMLElement, menu: HTMLElement }} els
 */
function paintStations(sh, spec, { ticked, pick, name }, { txt, trigger, menu }) {
  const list = ticked();
  txt.textContent = list.join(' · ') || '—';
  trigger.title = list.join(' · ');
  const nm = shownName(name(), sh.cur);
  menu.replaceChildren(...spec.stations.map((/** @type {string} */ st) => h('button.pmrow', { type: 'button', role: 'menuitemcheckbox',
    aria: { checked: list.includes(st) },
    on: { click: () => pick(toggleStation(spec.stations, ticked(), st)) } },
    h('b', { text: st }), heldAt(sh.book, sh.cur, nm, st) && h('span', { text: nm }))));
}

/**
 * The stations Save writes to, picked from a menu of every station (✓ = ticked). A station already holding a record
 * of this name shows it at the right (Save overwrites it, after asking). Ticking stays open.
 *
 * @param {Shell} sh
 * @param {any} spec
 * @param {{ ticked: () => string[], pick: (list: string[]) => void, name: () => string, now?: boolean }} o
 *   now: paint before the popover arms
 */
export function stationsMenu(sh, spec, { ticked, pick, name, now = false }) {
  const txt = h('span.v');
  const trigger = h('button.vfd.bstn', { type: 'button', aria: { haspopup: 'menu' } }, h('span.l', { text: 'Stations' }), txt);
  const menu = h('div.pop.pmenu.amenu.bstmenu', { role: 'menu', 'aria-label': 'Stations' });
  const paint = () => paintStations(sh, spec, { ticked, pick, name }, { txt, trigger, menu });
  if (now) paint();
  popover({ trigger, panel: menu });
  return { el: h('div.bstw', {}, trigger, menu), paint };
}
