// The Station builder's spec for the shared shell (lib/builder.js): one record book holding every station under one key,
// the edit it loads and stages, what Save and Delete leave behind, and the walk's rail.

import { NEW, OVERVIEW, namesAfterSave } from '../../model/builder.js';
import { deadListings } from '../../model/station.js';
import { STB_COPY, STB_STEPS, STB_SCRATCH } from '../../data/station-builder.js';
import { ONE } from './parts.js';
import { answerOf, skipText } from './answers.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A record's edit as saved: New is a scratch record; either carries the machine's hardware. */
const savedOf = (sb, c) => (c.name === NEW ? { name: '', rec: structuredClone(STB_SCRATCH), hw: structuredClone(sb.hw) }
  : { name: c.name, rec: structuredClone(sb.B.book[ONE][c.name]), hw: structuredClone(sb.hw) });
const hwDirty = (sb) => !same(sb.e.hw, sb.hw);
const dirty = (sb) => { const s0 = savedOf(sb, sb.B.cur); return sb.e.name !== s0.name || !same(sb.e.rec, s0.rec) || hwDirty(sb); };

/** After Save: a rename keeps its place, a resolved pair hides its dead listing, the hardware goes to every station. */
function onSaved(sb, { from, name }) {
  const restart = from.name === sb.loaded || hwDirty(sb);
  let renamed = null;
  if (from.name !== NEW && name !== from.name) {   // renamed in place: keeps its place in the list
    renamed = { from: from.name, to: name };
    if (sb.loaded === from.name) sb.loaded = name;
  }
  sb.order = namesAfterSave(sb.order, from.name, name);
  for (const l of deadListings([sb.e.rec])) sb.hidden.add(l);
  sb.hw = structuredClone(sb.e.hw);                  // the machine's: written to every station
  sb.B.load(sb.B.cur);
  sb.show('overview');
  sb.o.onSaved?.({ names: [...sb.order], loaded: sb.loaded, renamed, restart });
}

/** After Delete: the station leaves the list. */
function onRemoved(sb, from) {
  sb.order = sb.order.filter((n) => n !== from.name);
  sb.o.onSaved?.({ names: [...sb.order], loaded: sb.loaded, renamed: null, restart: false });
  sb.B.load(sb.B.cur); sb.show('overview');
}

/** The shell's copy: the Ask lines and the state line. */
const shellCopy = () => ({ remove: (n) => STB_COPY.remove(n), overwrite: (n) => STB_COPY.overwrite(n), noName: STB_COPY.noName,
  state: { restarts: STB_COPY.state.dirtyLoaded, dirty: STB_COPY.state.dirty, live: STB_COPY.state.loaded, saved: STB_COPY.state.saved } });

/** The walk: its rail, its steps and their answers, Start from scratch and the name box. */
const walkSpec = (sb, rail) => ({ rail, steps: STB_STEPS, copy: STB_COPY, skipOf: (id) => skipText(sb, id), answer: (id) => answerOf(sb, id),
  at: () => sb.at, show: (id) => sb.show(id),
  newLabel: STB_COPY.newStation,
  scratch: () => { sb.e.rec = structuredClone(STB_SCRATCH); sb.runs = {}; sb.show(STB_STEPS[0].id); },
  nameBox: { type: 'text', 'aria-label': 'Station name', maxlength: 40, spellcheck: 'false', placeholder: STB_COPY.name },
  setName: (n) => { sb.e.name = n; } });

/** The shell's spec for the Station builder. */
export function shellSpec(sb, { rail, others }) {
  return {
    title: 'Station builder', closeLabel: 'Close Station builder', noun: 'Station',
    stations: [ONE], book: { [ONE]: sb.records }, cur: { st: ONE, name: sb.loaded },
    copy: shellCopy(),
    name: () => sb.e.name,
    to: () => [ONE],
    record: () => structuredClone(sb.e.rec),
    dirty: () => dirty(sb),
    load: (c, buf) => { sb.e = structuredClone(buf ?? savedOf(sb, c)); sb.runs = {}; sb.bringUp = false; sb.pitch = false; },
    buffer: () => structuredClone(sb.e),
    restarts: () => sb.B.cur.name === sb.loaded || hwDirty(sb),
    live: () => sb.B.cur.name === sb.loaded,
    view: (where) => sb.show(where === 'here' ? sb.at : OVERVIEW),
    refuse: () => { sb.show('overview'); sb.B.nameBox.focus(); },
    saved: (x) => onSaved(sb, x),
    land: () => ({ st: ONE, name: sb.loaded }),   // the loaded station stays (it can't be deleted)
    removed: (from) => onRemoved(sb, from),
    leave: () => { others.settings.setOn(false); others.snapshot()?.setOn(false, false); others.profiles()?.setOn(false, false); },
    opened: () => sb.show(sb.at),
    toggles: true,
    walk: walkSpec(sb, rail),
  };
}
