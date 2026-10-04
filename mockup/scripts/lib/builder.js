// The builders' shared shell (Profile, Snapshot and Station builders): the record being edited and its staged edits,
// switching, discarding, the confirm line, Save and Delete over the record book, the state line and its buttons, the
// stations menu, the body swap and Escape; and for a walk (Profile, Station) the rail, the step pages and the overview.
// Every decision it makes lives in model/builder.js; this module executes them. A builder brings its own steps, records
// and copy through the spec.
//
// Two edit modes. A builder with `load` keeps the edit it is on outside `staged` (its own store), stashing it when it
// leaves and loading it back; one without (Snapshot) keeps every edit in `staged` itself.

import { h } from './dom.js';
import { anyOpen, popover } from './popover.js';
import { closeSheets, sheetOpen } from './sheet.js';
import { closeOthers } from '../components/drawer.js';
import { CHAIN } from '../data/chain.js';
import {
  NEW, OVERVIEW, keyOf, shownName, nextStep, prevStep, dirtyAt, stashed, stateOf, toggleStation, heldAt, savePlan,
  savedTo, removedFrom,
} from '../model/builder.js';
import { classNames } from '../model/format.js';

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
export function mountBuilder({ btn, chain, body, bus }, spec) {
  let book = spec.book;
  let cur = spec.cur;
  /** @type {Map<string, any>} */
  let staged = new Map();
  /** @type {{ text: string, onConfirm: () => void } | null} */
  let ask = null;
  let refused = false;   // Save with no name
  /** @type {{ discard: HTMLButtonElement, save?: HTMLButtonElement }[]} */
  const acts = [];

  const K = keyOf;
  const isDirty = (/** @type {Ref} */ c) => dirtyAt(K(c), K(cur), staged, spec.dirty());

  // ── Edit state ──────────────────────────────────────────────────────────
  /** Load a record's edit (`over`, else its staged edit, else the record); its staged edit is spent. */
  function load(/** @type {Ref} */ c, /** @type {any} */ over) {
    if (!spec.load) return;
    spec.load(c, over ?? staged.get(K(c)));
    staged = stashed(staged, K(c), null);
  }
  /** Stage the edit being left while it differs from its record. */
  function stash() { if (spec.load && spec.buffer) staged = stashed(staged, K(cur), spec.dirty() ? spec.buffer() : null); }
  /** Stage `buf` as the edit of the record being edited (null: it matches the record again). */
  function stage(/** @type {any} */ buf) { staged = stashed(staged, K(cur), buf); }
  function go(/** @type {Ref} */ c) {
    stash(); closeOthers(null);
    cur = c; ask = null; refused = false;
    load(c);
    spec.went?.(c);
    spec.view(OVERVIEW);
  }
  function discard() { staged = stashed(staged, K(cur), null); ask = null; refused = false; load(cur); spec.view('here'); }

  // ── Confirm line ────────────────────────────────────────────────────────
  function confirm(/** @type {string} */ text, /** @type {() => void} */ onConfirm) { closeOthers(null); ask = { text, onConfirm }; spec.view(OVERVIEW); }
  const askLine = () => h('div.bask', { role: 'alert' },
    h('span', { text: ask?.text }),
    h('button.btn.sm', { type: 'button', text: 'Confirm', on: { click: () => { const f = ask?.onConfirm; ask = null; f?.(); } } }),
    h('button.btn.sm', { type: 'button', text: 'Cancel', on: { click: () => { ask = null; spec.view(null); } } }));

  // ── State ───────────────────────────────────────────────────────────────
  const stateLine = h('div.pbstate', { role: 'status' });
  const cap = h('span.pbcap');
  const stateNow = (/** @type {boolean} */ d) => stateOf({ dirty: d, isNew: cur.name === NEW, ticked: spec.ticked?.() ?? true,
    restarts: !!spec.restarts?.(), live: !!spec.live?.() });
  function paintActs(s = stateNow(spec.dirty())) {
    for (const a of acts) {
      a.discard.disabled = s.discardOff;
      if (a.save) a.save.disabled = s.saveOff;
    }
  }
  function paintState() {
    const d = spec.dirty();
    const s = stateNow(d);
    paintActs(s);
    if (spec.copy.state) {
      stateLine.textContent = spec.copy.state[s.line];
      stateLine.classList.toggle('dirty', s.pending);
      cap.replaceChildren(refused ? h('span.bref', { text: spec.copy.noName }) : '');
    }
    spec.painted?.(d);
  }
  const discardEl = () => /** @type {HTMLButtonElement} */ (h('button.btn.sm', { type: 'button', text: 'Discard', on: { click: () => discard() } }));
  /** A Discard on its own (a drawer's head); it follows the state. */
  function discardButton() {
    const el = discardEl();
    acts.push({ discard: el });
    return el;
  }
  /** Delete / Discard / Save; Discard and Save follow the state. */
  function buttons(saveTag = 'button.btn.sm.pbsave') {
    const del = h('button.btn.sm', { type: 'button', text: 'Delete', on: { click: () => confirm(spec.copy.remove(cur.name), remove) } });
    const discardBtn = discardEl();
    const saveBtn = /** @type {HTMLButtonElement} */ (h(saveTag, { type: 'button', text: 'Save', on: { click: () => save() } }));
    acts.push({ discard: discardBtn, save: saveBtn });
    return { del, discard: discardBtn, save: saveBtn };
  }

  // ── Save / delete ───────────────────────────────────────────────────────
  function save() {
    const taken = spec.take?.();
    const name = spec.name().trim();
    const to = spec.to();
    const plan = savePlan(book, cur, name, to);
    if (plan === 'refuse') { closeOthers(null); refused = true; spec.refuse(); return; }
    if (plan === 'idle') return;
    const write = () => {
      const from = cur;
      const rec = spec.record(taken);
      const out = savedTo(book, cur, name, to, rec, !!spec.keeps?.(cur));
      book = out.book;
      staged = stashed(staged, K(from), null);
      cur = out.cur;
      if (!spec.load) staged = stashed(staged, K(cur), null);   // an edit kept in staged is the saved record now
      spec.saved({ from, name, to, rec });
    };
    if (plan === 'ask') confirm(spec.copy.overwrite(name), write);
    else write();
  }
  function remove() {
    const from = cur;
    const out = removedFrom(book, cur, spec.land?.());
    book = out.book;
    staged = stashed(staged, K(from), null);
    cur = out.cur;
    spec.removed(from);
  }

  // ── Stations menu ───────────────────────────────────────────────────────
  /**
   * The stations Save writes to, picked from a menu of every station (✓ = ticked). A station already holding a record
   * of this name shows it at the right (Save overwrites it, after asking). Ticking stays open.
   *
   * @param {{ ticked: () => string[], pick: (list: string[]) => void, name: () => string, now?: boolean }} o
   *   now: paint before the popover arms
   */
  function stationsMenu({ ticked, pick, name, now = false }) {
    const txt = h('span.v');
    const trigger = h('button.vfd.bstn', { type: 'button', aria: { haspopup: 'menu' } }, h('span.l', { text: 'Stations' }), txt);
    const menu = h('div.pop.pmenu.amenu.bstmenu', { role: 'menu', 'aria-label': 'Stations' });
    const paint = () => {
      const list = ticked();
      txt.textContent = list.join(' · ') || '—';
      trigger.title = list.join(' · ');
      const nm = shownName(name(), cur);
      menu.replaceChildren(...spec.stations.map((st) => h('button.pmrow', { type: 'button', role: 'menuitemcheckbox',
        aria: { checked: list.includes(st) },
        on: { click: () => pick(toggleStation(spec.stations, ticked(), st)) } },
        h('b', { text: st }), heldAt(book, cur, nm, st) && h('span', { text: nm }))));
    };
    if (now) paint();
    popover({ trigger, panel: menu });
    return { el: h('div.bstw', {}, trigger, menu), paint };
  }

  // ── Page parts ──────────────────────────────────────────────────────────
  const close = () => h('button.round.dx.pbx', { type: 'button', 'aria-label': spec.closeLabel, text: '×', on: { click: () => setOn(false) } });
  /** A page title in the section header grammar (engraved + rule), × at its end. */
  const title = (/** @type {string} */ text, /** @type {any} */ n, /** @type {any[]} */ mid = []) =>
    h('div.sh.btitle', {}, h('span.t', { text }), n, h('span.ln'), mid, close());

  // ── Walk: rail, steps, overview ─────────────────────────────────────────
  const walk = spec.walk;
  const ids = walk ? walk.steps.map((x) => x.id) : [];
  const skipped = (/** @type {string} */ id) => !!walk?.skipOf(id);
  const nextOf = (/** @type {number} */ i) => nextStep(ids, i, skipped);
  const prevOf = (/** @type {number} */ i) => prevStep(ids, i, skipped);
  const entry = (/** @type {string} */ id, /** @type {string} */ name) => h('button.st', { type: 'button', data: { stage: id }, on: { click: () => walk?.show(id) } },
    h('span.n', { text: name }), h('span.v'));
  /** @type {Map<string, HTMLElement>} */
  const railEls = new Map(walk ? [[OVERVIEW, entry(OVERVIEW, walk.copy.overview)], ...walk.steps.map((x) => /** @type {[string, HTMLElement]} */ ([x.id, entry(x.id, x.title)]))] : []);
  walk?.rail.replaceChildren(...railEls.values());
  /** The rail: the page showing lit (Overview for a page off the walk), each step's answer, `Skipped` where it doesn't apply. */
  function paintRail() {
    if (!walk) return;
    const at = walk.at();
    for (const [id, el] of railEls) {
      el.classList.toggle('open', id === at || (id === OVERVIEW && !railEls.has(at)));
      el.setAttribute('aria-current', String(id === at));
      /** @type {HTMLElement} */ (el.querySelector('.v')).textContent = id === OVERVIEW ? (shownName(spec.name(), cur) || walk.newLabel) : walk.answer(id);
      el.classList.toggle('skip', id !== OVERVIEW && skipped(id));
    }
  }
  const pick = h('select', { 'aria-label': spec.noun });
  const nameBox = walk ? nameInput(walk.nameBox, (v) => { walk.setName(v); refused = false; paintState(); paintRail(); }) : null;

  /**
   * A step's page: header (title, step n of t, ×), guide or skip line, rows, Back / Next.
   *
   * @param {string} id
   * @param {{ tag?: string, attrs?: object, guide: (skip: string, st: any) => any, rows: (id: string) => any }} o
   */
  function stepPage(id, { tag = 'div.pbstepp', attrs = {}, guide, rows }) {
    if (!walk) return null;
    const i = walk.steps.findIndex((x) => x.id === id);
    const st = walk.steps[i];
    const skip = walk.skipOf(id);
    const last = nextOf(i) === OVERVIEW;
    return h(tag, attrs,
      title(st.title, h('span.pbn', { text: walk.copy.stepOf(i + 1, walk.steps.length) })),
      guide(skip, st),
      h('div.pbsrows', {}, skip ? [] : rows(id)),
      h('div.pbnav', {}, h('span.grow'),
        h('button.btn.sm', { type: 'button', text: walk.copy.back, on: { click: () => walk.show(prevOf(i)) } }),
        h('button.btn.sm.pbnext', { type: 'button', text: last ? walk.copy.review : walk.copy.next, on: { click: () => walk.show(nextOf(i)) } })));
  }

  /**
   * The overview: intro and holds beside the signal chain, then which record (picker · Name · extras), its extras, the
   * confirm line, the state line and the ways on.
   *
   * @param {{ tags?: { ov?: string, save?: string, id?: string }, intro: any, holds: any[], chain: any, ids?: any[],
   *   mid?: any[], ask: any, acts: { del: any, discard: any, save: any }, after?: any }} o
   */
  function overview({ tags = {}, intro, holds, chain: pic, ids: more = [], mid = [], ask: askEl, acts: a, after }) {
    if (!walk) return null;
    return h(tags.ov ?? 'div.pbov', {},
      title(spec.title),
      h('div.pbovtop', {},
        h('div.pbovl', {}, intro, h('div.pbholds', {}, h('div.pbhh', { text: walk.copy.holds }), holds)),
        pic),
      h(tags.save ?? 'div.pbsavebox', {},
        h(tags.id ?? 'div.pbid', {},
          h('label.vfd.pbpick', {}, h('span.l', { text: spec.noun }), pick),
          h('label.vfd.bname.pbname', {}, h('span.l', { text: 'Name' }), nameBox),
          more),
        mid,
        askEl,
        h('div.pbfoot', {}, h('div.pbstw', {}, stateLine, cap), h('span.grow'),
          h('button.btn.sm', { type: 'button', text: walk.copy.scratch, on: { click: () => walk.scratch() } }),
          h('button.btn.sm', { type: 'button', text: walk.copy.change, on: { click: () => walk.show(walk.steps[0].id) } }),
          a.del, a.discard, a.save)),
      after);
  }

  // ── Swap ────────────────────────────────────────────────────────────────
  function setOn(/** @type {boolean} */ on, toChain = true) {
    closeOthers(null);
    closeSheets();
    if (on) spec.leave();
    body.hidden = !on;
    if (on) chain.hidden = true; else if (toChain) chain.hidden = false;
    btn.setAttribute('aria-pressed', String(on));
    if (on) { ask = null; spec.opened(); }
    bus.emit('relayout');
  }
  /** Arm the builder's button and Escape; the builder's public face. */
  function start() {
    btn.addEventListener('click', () => setOn(spec.toggles ? body.hidden : true));
    // Capture: an open drawer, popover or sheet hears Escape first; with nothing open it leaves the builder.
    body.ownerDocument.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || body.hidden || anyOpen() || sheetOpen() || body.querySelector('.drawer:not([data-closed])')) return;
      if (ask) { ask = null; spec.view(null); return; }
      setOn(false);
    }, true);
    return { setOn, isOn: () => !body.hidden };
  }

  return {
    get cur() { return cur; },
    get book() { return book; },
    get staged() { return /** @type {ReadonlyMap<string, any>} */ (staged); },
    get ask() { return ask; },
    get refused() { return refused; },
    set refused(v) { refused = v; },
    K, isDirty, load, stash, stage, go, discard, confirm, askLine, save, remove,
    paintState, paintActs, buttons, discardButton, stationsMenu, title, close, setOn, start,
    pick, nameBox, stateLine, cap, paintRail, inWalk: (/** @type {string} */ id) => railEls.has(id), nextOf, prevOf, stepPage, overview,
  };
}

/**
 * The manual's paragraphs: strings, or {k, text} (a keyed paragraph). `inline` renders a paragraph's text.
 *
 * @param {any} m
 * @param {(t: any) => any} [inline]
 */
export const paras = (m, inline = (t) => t) => (Array.isArray(m) ? m : [m]).filter(Boolean)
  .map((t) => (typeof t === 'string' ? h('p', {}, inline(t)) : h('p', {}, h('b', { text: t.k }), ' — ', inline(t.text))));

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
