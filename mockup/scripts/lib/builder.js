// The builders' shared shell (Profile, Snapshot and Station builders): the record being edited and its staged edits,
// switching, discarding, the confirm line, Save and Delete over the record book, the state line and its buttons, the
// stations menu, the body swap and Escape; and for a walk (Profile, Station) the rail, the step pages and the overview.
// Every decision it makes lives in model/builder.js; this module executes them. A builder brings its own steps, records
// and copy through the spec. The parts live under builder/: record.js (record and staging), state.js (state line and
// action buttons), stations.js (name box and stations menu), walk.js (rail and walk), swap.js (body swap and Escape).
//
// Two edit modes. A builder with `load` keeps the edit it is on outside `staged` (its own store), stashing it when it
// leaves and loading it back; one without (Snapshot) keeps every edit in `staged` itself.

import { h } from './dom.js';
import { manPara } from './controls.js';
import { CHAIN } from '../data/chain.js';
import { keyOf } from '../model/builder.js';
import { classNames } from '../model/format.js';
import { shellState, isDirty, load, stash, stage, go, discard, confirm, save, remove } from './builder/record.js';
import {
  stateParts, stateNow, paintActs, paintState, discardButton, buttons, askLine,
} from './builder/state.js';
import { stationsMenu, walkNameBox } from './builder/stations.js';
import { closeButton, pageTitle, walkNav, railOf, paintRail, stepPage, overview } from './builder/walk.js';
import { setOnOf, start } from './builder/swap.js';

export { swapBody, escapeLeaves } from './builder/swap.js';
export { nameInput } from './builder/stations.js';

/** @typedef {import('../model/builder.js').Ref} Ref */
/** @typedef {'overview' | 'here' | null} View  where a repaint lands: the overview, the page showing, or the same view */

/**
 * @typedef {object} Walk  a builder laid out as a walk: Overview, then one page per step
 * @property {HTMLElement} rail
 * @property {{ id: string, title: string }[]} steps
 * @property {object} copy  {overview, holds, scratch, change, back, next, review, stepOf(n, t)}
 * @property {(id: string) => string} skipOf  why a step doesn't apply ('' = it does)
 * @property {(id: string) => string} answer  a step's rail answer
 * @property {() => string} at  the page showing
 * @property {(id: string) => void} show
 * @property {string} newLabel  the New entry's rail name
 * @property {() => void} scratch  Start from scratch
 * @property {object} nameBox  the name box's attributes
 * @property {(name: string) => void} setName
 */

/**
 * @typedef {object} Spec
 * @property {string} title  the page title
 * @property {string} closeLabel  the × button's label
 * @property {string} noun  the record picker's label
 * @property {string[]} stations  every station, in the tree's order
 * @property {import('../model/builder.js').Book<any>} book  station → name → record
 * @property {Ref} cur  the record opened on
 * @property {object} copy  {remove(name), overwrite(name), noName, state?: {restarts, dirty, live, saved}}
 * @property {() => string} name  the name typed
 * @property {() => string[]} to  the stations Save writes to
 * @property {() => any} [take]  the edit as Save is tapped, handed to `record` (else `record` reads the edit as it writes)
 * @property {(taken: any) => any} record  the record Save writes
 * @property {() => boolean} dirty  the edit differs from its record
 * @property {(c: Ref, buf: any) => void} [load]  load a record's edit: its staged buffer, else its record
 * @property {() => any} [buffer]  the edit as a staged buffer
 * @property {(c: Ref) => boolean} [keeps]  a record Save leaves in its own station when unticked
 * @property {() => boolean} [ticked]  Save has somewhere to write (default: yes)
 * @property {() => boolean} [restarts]  saving restarts the engine
 * @property {() => boolean} [live]  the engine runs this record
 * @property {(where: View) => void} view  repaint
 * @property {(c: Ref) => void} [went]  after switching to a record, before the repaint
 * @property {() => void} refuse  Save with no name: show why
 * @property {(o: { from: Ref, name: string, to: string[], rec: any }) => void} saved  after Save writes
 * @property {(from: Ref) => void} removed  after Delete
 * @property {() => Ref} [land]  the record Delete lands on (default: the first left in its station)
 * @property {() => void} leave  turn the other bodies off as this one swaps in
 * @property {() => void} opened  after the body swaps in
 * @property {(dirty: boolean) => void} [painted]  after the state paints
 * @property {boolean} [toggles]  the builder's button toggles it (else it only opens it)
 * @property {Walk} [walk]
 */

/**
 * The shell over one builder's body.
 *
 * @param {{ btn: HTMLElement, chain: HTMLElement, body: HTMLElement, bus: { emit: (t: string) => void } }} el
 * @param {Spec} spec
 */
export function mountBuilder(el, spec) {
  const sh = shellState(spec);
  const walk = spec.walk;
  const { stateLine, cap } = stateParts();
  const nav = walkNav(walk);
  const railEls = railOf(walk);
  const pick = h('select', { 'aria-label': spec.noun });
  const setOn = setOnOf(el, sh, spec);
  const close = () => closeButton(spec, setOn);
  const title = (/** @type {string} */ text, /** @type {any} */ n, /** @type {any[]} */ mid = []) => pageTitle(close, text, n, mid);
  const paintStateNow = () => paintState(sh, spec, { stateLine, cap });
  const paintRailNow = () => paintRail(walk, spec, sh, railEls);
  const nameBox = walkNameBox(walk, sh, () => { paintStateNow(); paintRailNow(); });

  return {
    get cur() { return sh.cur; },
    get book() { return sh.book; },
    get staged() { return /** @type {ReadonlyMap<string, any>} */ (sh.staged); },
    get ask() { return sh.ask; },
    get refused() { return sh.refused; },
    set refused(v) { sh.refused = v; },
    K: keyOf,
    isDirty: (/** @type {Ref} */ c) => isDirty(sh, spec, c),
    load: (/** @type {Ref} */ c, /** @type {any} */ over) => load(sh, spec, c, over),
    stash: () => stash(sh, spec),
    stage: (/** @type {any} */ buf) => stage(sh, buf),
    go: (/** @type {Ref} */ c) => go(sh, spec, c),
    discard: () => discard(sh, spec),
    confirm: (/** @type {string} */ text, /** @type {() => void} */ onConfirm) => confirm(sh, spec, text, onConfirm),
    askLine: () => askLine(sh, spec),
    save: () => save(sh, spec),
    remove: () => remove(sh, spec),
    paintState: paintStateNow,
    paintActs: (s = stateNow(sh, spec, spec.dirty())) => paintActs(sh, s),
    buttons: (saveTag = 'button.btn.sm.pbsave') => buttons(sh, spec, saveTag),
    discardButton: () => discardButton(sh, spec),
    stationsMenu: (/** @type {Parameters<typeof stationsMenu>[2]} */ o) => stationsMenu(sh, spec, o),
    title, close, setOn,
    start: () => start(el, sh, spec, setOn),
    pick, nameBox, stateLine, cap,
    paintRail: paintRailNow,
    inWalk: (/** @type {string} */ id) => railEls.has(id),
    nextOf: nav.nextOf, prevOf: nav.prevOf,
    stepPage: (/** @type {string} */ id, /** @type {Parameters<typeof stepPage>[3]} */ o) => stepPage(walk, { title, ...nav }, id, o),
    overview: (/** @type {Parameters<typeof overview>[3]} */ o) => overview(walk, spec, { title, pick, nameBox, stateLine, cap }, o),
  };
}

/**
 * The manual's paragraphs: strings, or {k, text} (a keyed paragraph). `inline` renders a paragraph's text.
 *
 * @param {any} m
 * @param {(t: any) => any} [inline]
 */
export const paras = (m, inline = (t) => t) => (Array.isArray(m) ? m : [m]).filter(Boolean)
  .map((t) => manPara(typeof t === 'string' ? { text: inline(t) } : { k: t.k, text: inline(t.text) }));

/**
 * A drawer row: label and control on the left, the manual's paragraphs on the right.
 *
 * @param {string} label
 * @param {any} ctl
 * @param {any} man
 * @param {{ cls?: string, extra?: any, inline?: (t: any) => any }} [o]
 */
export const drow = (label, ctl, man, { cls, extra, inline } = {}) => h('div.drow', { class: cls },
  h('div.ctl', {}, label && h('div.fh', {}, h('b', { text: label })), ctl), h('div.man', {}, paras(man, inline)), extra);

/**
 * The signal chain with the builder's part lit.
 *
 * @param {string} label
 * @param {(id: string) => boolean} lit  a stage the builder sets
 * @param {(id: string) => boolean} [out]  a stage outside it the builder still touches
 */
export const chainPic = (label, lit, out = () => false) => h('ol.pbchain', { 'aria-label': label },
  CHAIN.map((st) => h('li', { class: classNames(lit(st.id) && 'mx', out(st.id) && 'out', st.level && 'sub') },
    h('span.d'), h('span', { text: st.name }))));

/**
 * One line of what a record holds: its title, its answer (`a`, painted by the builder), › to its step.
 *
 * @param {string} title
 * @param {(() => void) | null} onClick
 * @param {string} [tag]
 */
export function holdRow(title, onClick, tag = 'button.pbhold') {
  const a = h('span.pa');
  const el = h(tag, onClick ? { type: 'button', on: { click: onClick } } : { type: 'button' },
    h('b', { text: title }), a, h('span.pgo', { 'aria-hidden': 'true', text: '›' }));
  return { el, a };
}
