// Snapshot builder: the header's Snapshot builder button swaps the chain body for this one, as the gear does for Settings.
// Header, engine row and bottom bar stay (the Setting Switcher stays live).
//   Rail  every station as a fold (▸ name, count; the loaded one amber), one open at a time (the station tree's fold),
//         its snapshots under it one line each, then New snapshot. No scroll: the open station's list pages to the lines the
//         rail has room for (the DSP pipelines list's numbered page buttons), so 12 × 4 or 1 × 25 both fit. The one
//         being edited: amber name + left-hand selection bar (rail grammar). A
//         snapshot holding unsaved edits keeps a dirty dot (edits stay staged per snapshot until Save or Discard; leaving
//         the builder never discards, the drawers' rule).
//   Page  name window + Stations window (the stations Save writes to: a new snapshot to several at once, an edit to the
//         same-named snapshot in each; unticking its own moves it) +
//         Delete / Discard / Save, then one row per setting a snapshot can hold, in chain order:
//         include box | stage + setting | the snapshot's value | ← | the engine's live value.
//         Excluded rows gray (never hidden): recall leaves that setting where the engine has it (v1).
//         `Use live settings` (head of the Live column) fills every included row from the engine; ← takes one row's, and
//         is live only where the two differ. Editing a row is specifying it. Nothing here writes to the engine.
//         The chain rows follow the snapshot's Output mode (one chain per snapshot) and need it: Mode excluded grays them
//         (their include state is kept and comes back with Mode, as the matrix bypass keeps its dependents' settings).
// Exit: × on the title, the button again, Escape with nothing open, or the gear (straight to Settings).
// The shell (switching, staging, Save / Delete, the stations menu, the swap) is lib/builder.js; every edit lives staged.

import { h } from '../lib/dom.js';
import { seg } from './seg.js';
import { vselect, optionStyle } from './vselect.js';
import { mountBuilder, nameInput } from '../lib/builder.js';
import { NEW, homeOf } from '../model/builder.js';
import { SNAP_ROWS, SNAP_COPY } from '../data/snapshots.js';
import { CHAIN_NAMES } from '../data/conversion.js';
import { classNames } from '../model/format.js';

const CHAIN_IDS = ['1x', 'nx', 'sh'];
const isChain = (id) => CHAIN_IDS.includes(id);

/**
 * @param {object} el     {btn: header button, chain: #body, body: #bbody, rail, page, settings: {setOn}, bus: lib/bus.js}
 * @param {{name: string, active?: boolean}[]} stations  in the tree's order
 * @param {object} records  station → name → fields (absent = not held)
 * @param {() => object} live  engine now: {autopilot, adaptive, profile, mode, run, pcm: {1x,nx,sh}, sdm: {...}}
 */
export function mountSnapshotBuilder({ btn, chain, body, rail, page, settings, bus }, stations, records, live) {
  records = Object.fromEntries(stations.map((st) => [st.name, structuredClone(records[st.name] ?? {})]));
  const home = homeOf(stations);   // the loaded station; New lands here
  // B.cur = {st, name}: the snapshot being edited (name NEW = New snapshot). Opens on the loaded station's first.
  let openSt = home;   // the station fold that is open (the edited snapshot's; it opens on the loaded station's)
  const B = mountBuilder({ btn, chain, body, bus }, {
    title: 'Snapshot builder', closeLabel: 'Close Snapshot builder', noun: 'Snapshot',   // the other builders' close
    stations: stations.map((st) => st.name), book: records, cur: { st: home, name: Object.keys(records[home])[0] ?? NEW },
    copy: { remove: (n) => SNAP_COPY.remove(n), overwrite: (n) => SNAP_COPY.overwrite(n), noName: SNAP_COPY.noName },
    name: () => edit().name,
    to: () => edit().stations,
    take: () => edit(),
    /** What the snapshot stores: the rows it holds, at the edit's values. */
    record: (e) => {
      const r = {};
      for (const id of SNAP_ROWS.map((x) => x.id)) if (held(e).has(id)) r[id] = valOf(e, id);
      return r;
    },
    dirty: () => dirtyOf(B.cur),
    ticked: () => edit().stations.length > 0,
    view: () => render(),
    went: (c) => { if (c.name !== NEW) openSt = c.st; },
    refuse: () => { render(); page.querySelector('.bhead input')?.focus(); },
    saved: () => { openSt = B.cur.st; reveal = true; render(); },
    removed: () => render(),
    leave: () => settings.setOn(false),
    opened: () => render(),
    painted: () => { stationPaint?.(); paintRail(); },
    toggles: true,
  });

  // ── Edit buffers ────────────────────────────────────────────────────────
  /** A record as an edit: every row has a value (the engine's where the record holds none); inc = what it holds. */
  function fromRecord(r) {
    const L = live();
    const mode = r?.mode ?? (L.run);
    const vals = { autopilot: L.autopilot, adaptive: L.adaptive, profile: L.profile, mode, pcm: { ...L.pcm }, sdm: { ...L.sdm } };
    const inc = new Set();
    if (!r) {   // New: what the engine runs now, everything attached (v1: every row checked)
      for (const row of SNAP_ROWS) inc.add(row.id);
      vals.mode = L.run;
      return { name: '', stations: [home], inc, vals };
    }
    for (const [k, v] of Object.entries(r)) {
      inc.add(k);
      if (isChain(k)) vals[mode][k] = v; else vals[k] = v;
    }
    return { name: B.cur.name, stations: [B.cur.st], inc, vals };
  }
  const saved = (c) => (c.name === NEW ? fromRecord(null) : fromRecord(B.book[c.st][c.name]));
  const edit = () => B.staged.get(B.K(B.cur)) ?? saved(B.cur);
  const key = (e) => JSON.stringify([e.name, [...e.stations].sort(), [...held(e)].sort(), ...[...held(e)].sort().map((id) => valOf(e, id))]);
  /** What the snapshot would store: chain rows only with Mode (they index its chain). */
  const held = (e) => new Set([...e.inc].filter((id) => !isChain(id) || e.inc.has('mode')));
  const valOf = (e, id) => (isChain(id) ? e.vals[e.vals.mode][id] : e.vals[id]);
  const dirtyOf = (c) => B.staged.has(B.K(c));

  /** Change the edit; stage it while it differs from what is saved, drop it once it matches again. soft = no re-render
   *  (the name box: typing must not rebuild the page under the caret, or under a Save tap that blurs it). */
  function change(fn, soft) {
    const e = structuredClone(edit());
    e.inc = new Set(edit().inc);
    fn(e);
    B.stage(key(e) === key(saved(B.cur)) && (B.cur.name !== NEW || !e.name) ? null : e);
    if (soft) { B.paintState(); return; }
    B.refused = false;
    render();
  }
  const acts = B.buttons('button.btn.sm.bsave');   // Delete / Discard / Save, on the title

  // ── Live values ─────────────────────────────────────────────────────────
  function liveOf(e, id) {
    const L = live();
    if (isChain(id)) return { v: L[e.vals.mode][id], idle: e.vals.mode !== L.run };
    if (id === 'mode') return { v: L.mode, idle: false };
    return { v: L[id], idle: false };
  }
  /** The live value in the words the snapshot's control uses: the same Option style as the pickers (Visual settings). */
  const labelOf = (row, e, v) => {
    if (row.kind === 'seg') return row.options.find((o) => o.v === v)?.label ?? (v === 'auto' ? 'Auto' : v);
    if (row.kind === 'list' && optionStyle() !== 'standard') return row.list(e.vals.mode).find((o) => o.v === v)?.label ?? v;
    return v;
  };

  // ── Rail ────────────────────────────────────────────────────────────────
  /** Rail at the most lines that fit: the open station's page shrinks until nothing runs past the rail (no scroll). */
  function paintRail() {
    // Measured on the fullest page (the first), so every page holds the same number of lines.
    let per = 40;
    for (; per > 3; per--) { paintRailAt(per, true); if (!rail.clientHeight || rail.scrollHeight <= rail.clientHeight) break; }
    // After a save (or a station opened on its snapshot), its page is the one shown.
    const { cur } = B;
    if (reveal && cur.name !== NEW) { const i = Object.keys(B.book[cur.st]).indexOf(cur.name); if (i >= 0) pageOf.set(cur.st, Math.floor(i / per)); }
    reveal = false;
    paintRailAt(per);
  }
  function paintRailAt(per, first) {
    const e = edit();
    const { cur, book } = B;
    // The snapshot edited, plus the same-named snapshot in every other ticked station (Save writes there too): lit
    // together, as Resampling and Shaping light together for their one drawer.
    const isCur = (c) => B.K(c) === B.K(cur) || (cur.name !== NEW && c.name === (e.name || cur.name) && e.stations.includes(c.st));
    const entry = (st, name) => {
      const c = { st, name };
      return h('button.st.bst', { type: 'button', class: classNames(isCur(c) && 'open', dirtyOf(c) && 'dirty'),
        aria: { current: isCur(c) }, title: name, on: { click: () => B.go(c) } },
        h('span.n', { text: name }));
    };
    const nw = { st: home, name: NEW };
    const pager = (st, n) => {
      const pages = Math.ceil(n / per);
      if (pages < 2) return [];
      const pg = Math.min(pageOf.get(st) ?? 0, pages - 1);
      const goPg = (k) => { pageOf.set(st, (k + pages) % pages); paintRail(); };
      return [h('div.opg.bpg', {},
        h('button.round.pbn', { type: 'button', text: '‹', 'aria-label': 'Previous page', on: { click: () => goPg(pg - 1) } }),
        Array.from({ length: pages }, (_, k) => h('button.opb', { type: 'button', class: k === pg && 'on', text: String(k + 1),
          'aria-label': `Page ${k + 1}`, 'aria-current': String(k === pg), on: { click: () => goPg(k) } })),
        h('button.round.pbn', { type: 'button', text: '›', 'aria-label': 'Next page', on: { click: () => goPg(pg + 1) } }))];
    };
    const pageItems = (st, names) => {
      const pages = Math.max(1, Math.ceil(names.length / per));
      const pg = first ? 0 : Math.min(pageOf.get(st) ?? 0, pages - 1);
      return names.slice(pg * per, (pg + 1) * per);
    };
    rail.replaceChildren(
      // Each station a fold, one open at a time; its snapshots under it. The loaded station's name amber.
      ...stations.flatMap((st) => {
        const n = Object.keys(book[st.name]).length;
        const isOpen = st.name === openSt;
        const lit = [...B.staged.keys()].some((k) => k.startsWith(st.name + '\u0001'));   // holds unsaved edits
        return [
          h('button.brh', { type: 'button', class: classNames(st.name === home && 'cur', lit && 'dirty'),
            aria: { expanded: isOpen }, on: { click: () => { openSt = isOpen ? null : st.name; paintRail(); } } },
            h('span.chv', { text: isOpen ? '▾' : '▸' }), h('span.sn', { text: st.name }), h('span.ln'), h('span.cnt', { text: String(n) })),
          ...(isOpen ? pageItems(st.name, Object.keys(book[st.name])).map((name) => entry(st.name, name)) : []),
          // A short last page keeps its full height (the pipelines list's fixed page), so nothing under it moves.
          ...(isOpen && n > per ? Array.from({ length: per - pageItems(st.name, Object.keys(book[st.name])).length }, () => h('div.bfill')) : []),
          ...(isOpen ? pager(st.name, n) : []),
        ];
      }),
      h('button.st.bst.bnew', { type: 'button', class: classNames(isCur(nw) && 'open', dirtyOf(nw) && 'dirty'),
        on: { click: () => B.go(nw) } }, h('span.n', {}, h('span.plus', { text: '+' }), 'New snapshot')),
    );
  }
  const pageOf = new Map();   // station → its list's page
  let reveal = false;          // next rail paint turns to the edited snapshot's page

  // ── Page ────────────────────────────────────────────────────────────────
  function render() {
    const e = edit();
    const isNew = B.cur.name === NEW;

    const nameBox = nameInput({ type: 'text', 'aria-label': 'Snapshot name', value: e.name, maxlength: 40, spellcheck: 'false' },
      (name) => change((x) => { x.name = name; }, true));
    nameBox.value = e.name;
    // Page title in the section header grammar (engraved + rule), carrying the snapshot's actions.
    const title = B.title('Snapshot builder', null, [!isNew && acts.del, acts.discard, acts.save]);
    B.paintActs();
    const head = h('div.bhead', {},
      h('label.vfd.bname', {}, h('span.l', { text: 'Name' }), nameBox),
      stationPick(),
      h('div.bcap', {},
        B.refused ? h('span.bref', { text: SNAP_COPY.noName }) : isNew ? SNAP_COPY.select : ''),
    );

    const L = live();
    const cols = h('div.brow.bcols', {},
      h('span'), h('span'),
      h('span.bct', { text: 'Snapshot' }),
      h('span'),
      h('span.bct.blh', {}, h('span', { text: 'Live' }),
        h('button.btn.sm', { type: 'button', text: 'Use live settings', on: { click: () => change((x) => takeAll(x, L)) } })),
    );

    // The rows share the height left under the head (each row grows alike; nothing pools at the bottom).
    page.replaceChildren(title, head, (B.ask && B.askLine()) || '', cols, h('div.brows', {}, SNAP_ROWS.map((row) => rowEl(row, e))));
    paintRail();
  }

  /**
   * Stations window: the stations Save writes to (the shell's menu). Ticking stays open: several can be picked in one go.
   */
  function stationPick() {
    const m = B.stationsMenu({ ticked: () => edit().stations, name: () => edit().name, now: true,
      pick: (list) => change((y) => { y.stations = list; }, true) });
    stationPaint = m.paint;
    return m.el;
  }
  let stationPaint = null;

  function takeAll(x, L) {
    if (x.inc.has('mode')) x.vals.mode = L.run;
    for (const row of SNAP_ROWS) {
      if (!x.inc.has(row.id) || row.id === 'mode') continue;
      if (isChain(row.id)) x.vals[x.vals.mode][row.id] = L[x.vals.mode][row.id];
      else x.vals[row.id] = L[row.id];
    }
  }

  function rowEl(row, e) {
    const ch = e.vals.mode;
    const gated = isChain(row.id) && !e.inc.has('mode');
    const on = e.inc.has(row.id) && !gated;
    const v = valOf(e, row.id);
    const lv = liveOf(e, row.id);
    const differs = String(lv.v) !== String(v) && !(row.id === 'mode' && lv.v === 'auto');
    const label = typeof row.label === 'function' ? row.label(ch) : row.label;

    const box = h('button.binc', { type: 'button', role: 'checkbox', aria: { checked: on, label: `Attach ${label}` },
      disabled: gated, on: { click: () => change((x) => { if (x.inc.has(row.id)) x.inc.delete(row.id); else x.inc.add(row.id); }) } });

    let ctl;
    const set = (nv) => change((x) => { if (isChain(row.id)) x.vals[x.vals.mode][row.id] = nv; else x.vals[row.id] = nv; });
    if (row.kind === 'seg') ctl = seg({ aria: label, options: row.options, value: v, onChange: set });
    else if (row.kind === 'select') ctl = vselect({ aria: label, options: row.options, value: v, onChange: set });
    else ctl = vselect({ id: `bd-${ch}${row.id}`, aria: `${CHAIN_NAMES[ch]} ${label}`, options: row.list(ch), value: v, onChange: set });
    const ctlWrap = h('div.bval', { class: !on && 'grayed' }, ctl);
    if (!on) for (const b of ctlWrap.querySelectorAll('button,select')) b.disabled = true;

    const take = h('button.round.btake', { type: 'button', 'aria-label': `${label}: use the live value`, text: '←',
      disabled: !on || !differs || (row.id === 'mode' && lv.v === 'auto'),
      on: { click: () => set(row.id === 'mode' ? live().run : lv.v) } });

    const liveTxt = labelOf(row, e, lv.v);
    return h('div.brow', { class: classNames(!row.stage && 'cont', !on && 'off'), data: { id: row.id } },
      box,
      h('div.bset', {},
        row.stage && h('span.bst2', { text: row.stage }),
        h('span.bl', {}, h('b', { text: label }))),
      ctlWrap,
      take,
      // Differences mark only on attached rows (an excluded row is left as is on recall, so it can't differ).
      h('div.vfd.blive', { class: differs && on && 'diff', title: lv.idle ? `${liveTxt} · idle` : liveTxt },
        h('span.v', {}, h('span.bt', { text: liveTxt }), lv.idle && h('span.bidle', { text: '· idle' }))),
    );
  }

  btn.setAttribute('aria-pressed', 'false');
  const api = B.start();
  bus.on('relayout', () => { if (!body.hidden) paintRail(); });   // lines per page follow the rail's height
  render();
  return { ...api, refresh: () => { if (!body.hidden) render(); } };
}
