// The Station builder's spec for the shared shell (lib/builder.js): one record book holding every station under one key,
// the edit it loads and stages, what Save and Delete leave behind, and the walk's rail.

import { NEW, OVERVIEW, namesAfterSave } from "../../../../../../hqptuner/static/model/builders/builder.js";
import { deadListings } from "../../../../model/builders/station.js";
import { STB_COPY, STB_STEPS, STB_SCRATCH } from "../../../../data/builders/station-builder.js";
import { ONE } from "./parts.js";
import { answerOf, skipText } from "./answers.js";

/** @typedef {import('../../station-builder.js').StationState} StationState */
/** @typedef {import('../../station-builder.js').Edit} Edit */
/** @typedef {import('../../station-builder.js').Others} Others */
/** @typedef {import('../../../../model/builders/station.js').Rec} Rec */
/** @typedef {import('../../../../../../hqptuner/static/model/builders/builder.js').Ref} Ref */
/** @typedef {import('../../../../lib/builder/builder.js').Spec<Rec, Edit>} Spec */
/** @typedef {import('../../../../lib/builder/builder.js').Walk} Walk */

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A record's edit as saved: New is a scratch record; either carries the machine's hardware.
 *
 * @param {StationState} sb
 * @param {Ref} c
 * @returns {Edit}
 */
const savedOf = (sb, c) =>
  c.name === NEW
    ? { name: "", rec: structuredClone(STB_SCRATCH), hw: structuredClone(sb.hw) }
    : { name: c.name, rec: structuredClone(/** @type {Rec} */ (sb.B.book[ONE][c.name])), hw: structuredClone(sb.hw) };
const hwDirty = (/** @type {StationState} */ sb) => !same(sb.e.hw, sb.hw);
const dirty = (/** @type {StationState} */ sb) => {
  const s0 = savedOf(sb, sb.B.cur);
  return sb.e.name !== s0.name || !same(sb.e.rec, s0.rec) || hwDirty(sb);
};

/**
 * After Save: a rename keeps its place, a resolved pair hides its dead listing, the hardware goes to every station.
 *
 * @param {StationState} sb
 * @param {{ from: Ref, name: string }} saved
 */
function onSaved(sb, { from, name }) {
  const restart = from.name === sb.loaded || hwDirty(sb);
  let renamed = null;
  if (from.name !== NEW && name !== from.name) {
    // renamed in place: keeps its place in the list
    renamed = { from: from.name, to: name };
    if (sb.loaded === from.name) sb.loaded = name;
  }
  sb.order = namesAfterSave(sb.order, from.name, name);
  for (const l of deadListings([sb.e.rec])) sb.hidden.add(l);
  sb.hw = structuredClone(sb.e.hw); // the machine's: written to every station
  sb.B.load(sb.B.cur, undefined);
  sb.show("overview");
  sb.o.onSaved?.({ names: [...sb.order], loaded: sb.loaded, renamed, restart });
}

/**
 * After Delete: the station leaves the list.
 *
 * @param {StationState} sb
 * @param {Ref} from
 */
function onRemoved(sb, from) {
  sb.order = sb.order.filter((n) => n !== from.name);
  sb.o.onSaved?.({ names: [...sb.order], loaded: sb.loaded, renamed: null, restart: false });
  sb.B.load(sb.B.cur, undefined);
  sb.show("overview");
}

/** The shell's copy: the Ask lines and the state line. */
const shellCopy = () => ({
  remove: (/** @type {string} */ n) => STB_COPY.remove(n),
  overwrite: (/** @type {string} */ n) => STB_COPY.overwrite(n),
  noName: STB_COPY.noName,
  state: {
    restarts: STB_COPY.state.dirtyLoaded,
    dirty: STB_COPY.state.dirty,
    live: STB_COPY.state.loaded,
    saved: STB_COPY.state.saved,
  },
});

/**
 * The walk: its rail, its steps and their answers, Start from scratch and the name box.
 *
 * @param {StationState} sb
 * @param {HTMLElement} rail
 * @returns {Walk}
 */
const walkSpec = (sb, rail) => ({
  rail,
  steps: STB_STEPS,
  copy: STB_COPY,
  skipOf: (id) => skipText(sb, id),
  answer: (id) => answerOf(sb, id),
  at: () => sb.at,
  show: (id) => sb.show(id),
  newLabel: STB_COPY.newStation,
  scratch: () => {
    sb.e.rec = structuredClone(STB_SCRATCH);
    sb.runs = {};
    sb.show(STB_STEPS[0].id);
  },
  nameBox: {
    type: "text",
    "aria-label": "Station name",
    maxlength: 40,
    spellcheck: "false",
    placeholder: STB_COPY.name,
  },
  setName: (n) => {
    sb.e.name = n;
  },
});

/**
 * The shell's spec for the Station builder.
 *
 * @param {StationState} sb
 * @param {{ rail: HTMLElement, others: Others }} els
 * @returns {Spec}
 */
export function shellSpec(sb, { rail, others }) {
  return {
    title: "Station builder",
    closeLabel: "Close Station builder",
    noun: "Station",
    stations: [ONE],
    book: { [ONE]: sb.records },
    cur: { st: ONE, name: sb.loaded },
    copy: shellCopy(),
    name: () => sb.e.name,
    to: () => [ONE],
    record: () => structuredClone(sb.e.rec),
    dirty: () => dirty(sb),
    load: (c, buf) => {
      sb.e = structuredClone(buf ?? savedOf(sb, c));
      sb.runs = {};
      sb.bringUp = false;
      sb.pitch = false;
    },
    buffer: () => structuredClone(sb.e),
    restarts: () => sb.B.cur.name === sb.loaded || hwDirty(sb),
    live: () => sb.B.cur.name === sb.loaded,
    view: (where) => sb.show(where === "here" ? sb.at : OVERVIEW),
    refuse: () => {
      sb.show("overview");
      /** @type {HTMLInputElement} */ (sb.B.nameBox).focus();
    },
    saved: (x) => onSaved(sb, x),
    land: () => ({ st: ONE, name: sb.loaded }), // the loaded station stays (it can't be deleted)
    removed: (from) => onRemoved(sb, from),
    leave: () => {
      others.settings.setOn(false);
      others.snapshot()?.setOn(false, false);
      others.profiles()?.setOn(false, false);
    },
    opened: () => sb.show(sb.at),
    toggles: true,
    walk: walkSpec(sb, rail),
  };
}
