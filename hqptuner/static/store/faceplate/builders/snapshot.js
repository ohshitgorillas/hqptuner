// The Snapshot builder's store half: what a snapshot can hold, the engine now, the book and its stations, the edit
// showing and how a change stages it, and the record a save sends; each row's view is ./rows.js's. Sits on the
// builders' shell (./shell.js) for the record being edited and its staged edits.

import { NEW, keyOf, homeOf } from "../../../model/builders/builder.js";
import { isChain, valOf } from "../../../model/builders/snapshot.js";
import { schema } from "../../schema.js";
import { MODES } from "../../schema/options.js";
import { runningValue } from "../../resolve.js";
import { liveBook } from "../../live/presets.js";
import { chainControls } from "../../live/chains.js";
import { CHAINS, stateOf } from "../../live/derive.js";
import { loadedChain } from "../../live/rates.js";
import { runningChain } from "../path.js";
import { stationTree } from "../stations.js";
import { profileChoices } from "../page/profile.js";
import { cur, staged, stage, refused } from "./shell.js";

/** @typedef {import('../../../model/builders/builder.js').Ref} Ref */
/** @typedef {import('../../../model/builders/snapshot.js').Chain} Chain */
/** @typedef {import('../../../model/builders/snapshot.js').Edit} Edit */
/** @typedef {import('../../../model/builders/snapshot.js').Engine} Engine */
/** @typedef {import('../../live/chains.js').ChainControl} ChainControl */
/** @typedef {import('../stations.js').SnapRecord} SnapRecord */
/** @typedef {{ v: string, label: string, disabled?: boolean }} Option  a seg's or select's option: the wire value and its label */

/**
 * One row a snapshot can hold. A chain row's `label`, `field` and `key` follow the snapshot's chain.
 *
 * @typedef {object} SnapRow
 * @property {string} id
 * @property {string} [stage]
 * @property {string | Record<Chain, string>} label
 * @property {'seg' | 'list' | 'select'} kind
 * @property {Option[]} [options]  a seg's options
 * @property {boolean} [chain]     the row's value indexes the snapshot's chain
 * @property {boolean} [gate]      the row the chain rows need (Output mode)
 * @property {string | Record<Chain, string>} field  the live lane's wire field
 * @property {string | Record<Chain, string>} key    the catalog key
 */

/**
 * What a save sends: the wire fields held, and each one's value.
 *
 * @typedef {{ fields: string[], values: Record<string, string> }} RecordOut
 */

/** The chain rows' ids, in the order each chain's controls run. */
const CHAIN_IDS = ["1x", "nx", "sh"];

const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];

/** @param {{ value: string, label: string }} m */
const toOption = (m) => ({ v: m.value, label: m.label });

/**
 * One value per chain, read off each chain's control at position `i`.
 *
 * @param {number} i
 * @param {(c: ChainControl) => string} fn
 * @returns {Record<Chain, string>}
 */
const perChain = (i, fn) => ({ pcm: fn(CHAINS.pcm[i]), sdm: fn(CHAINS.sdm[i]) });

/**
 * The chain row at position `i` of each chain's controls.
 *
 * @param {number} i
 * @param {string} [heading]  the stage it opens
 * @returns {SnapRow}
 */
const chainRow = (i, heading) => ({
  id: CHAIN_IDS[i],
  ...(heading ? { stage: heading } : {}),
  label: perChain(i, (c) => c.entry.label),
  kind: "list",
  chain: true,
  field: perChain(i, (c) => c.field),
  key: perChain(i, (c) => c.key),
});

/**
 * Rows in chain order.
 *
 * @type {SnapRow[]}
 */
export const SNAP_ROWS = [
  {
    id: "adaptive",
    stage: "Volume",
    label: schema.adaptive_volume.label,
    kind: "seg",
    options: OFF_ON,
    field: "adaptive_volume",
    key: "adaptive_volume",
  },
  {
    id: "profile",
    stage: "Matrix engine",
    label: "Matrix profile",
    kind: "select",
    field: "matrix_profile",
    key: "matrix_profile",
  },
  chainRow(0, "Resampling"),
  chainRow(1),
  chainRow(2, "Shaping"),
  {
    id: "mode",
    stage: "Output",
    label: schema.output_mode.label,
    kind: "seg",
    gate: true,
    options: MODES.filter((m) => m.value !== "auto").map(toOption),
    field: "mode",
    key: "output_mode",
  },
];

/** The builder's copy. */
export const SNAP_COPY = {
  select: "Select the settings to attach to the new snapshot.",
  noName: "Enter a name first",
  /** @param {string} n */
  overwrite: (n) => `Snapshot "${n}" already exists. Overwrite it?`,
  /** @param {string} n */
  remove: (n) => `Delete snapshot "${n}"? This cannot be undone.`,
};

/**
 * A row's chain-following value on chain `ch`.
 *
 * @param {string | Record<Chain, string>} v
 * @param {Chain} ch
 * @returns {string}
 */
export const byChain = (v, ch) => (typeof v === "string" ? v : v[ch]);

/**
 * The chain a wire value names; anything but SDM reads as PCM.
 *
 * @param {unknown} v
 * @returns {Chain}
 */
const asChain = (v) => (v === "sdm" ? "sdm" : "pcm");

/**
 * The chain a record's rows sit on: its Mode where it holds one, else the chain it was taken on.
 *
 * @param {SnapRecord} rec
 * @returns {Chain}
 */
export const recordChain = (rec) => asChain(rec.fields.mode ?? rec.chain);

/**
 * One chain's rows as enum IDs, read the way its chain card reads them.
 *
 * @param {Chain} ch
 * @param {string | null} loaded
 * @returns {Record<string, string>}
 */
const chainVals = (ch, loaded) =>
  Object.fromEntries(chainControls(ch, loaded).map((c, i) => [CHAIN_IDS[i], String(c.value)]));

/**
 * The engine now: Output mode, the chain it runs, each chain's rows as enum IDs, Adaptive volume and the matrix profile.
 *
 * @returns {Engine}
 */
export function liveNow() {
  const loaded = loadedChain() || null;
  return {
    mode: String(runningValue("output_mode") ?? ""),
    run: runningChain(),
    pcm: chainVals("pcm", loaded),
    sdm: chainVals("sdm", loaded),
    adaptive: String(stateOf("adaptive") ?? ""),
    profile: profileChoices().value,
  };
}

/**
 * Every station's snapshots, station → name → record; empty until the book is read.
 *
 * @returns {Record<string, Record<string, SnapRecord>>}
 */
export function snapshotBook() {
  return /** @type {Record<string, Record<string, SnapRecord>>} */ (liveBook.value ?? {});
}

/**
 * Every station's name, in the tree's order.
 *
 * @returns {string[]}
 */
export function stations() {
  return stationTree().map((s) => s.name);
}

/**
 * The loaded station.
 *
 * @returns {string}
 */
export function home() {
  const tree = stationTree();
  return tree.length ? homeOf(tree) : "";
}

/**
 * Set one row's value in `vals`: a chain row's under the chain `vals.mode` names.
 *
 * @param {Edit['vals']} vals
 * @param {string} id
 * @param {string} v
 */
function setVal(vals, id, v) {
  if (isChain(id)) vals[vals.mode][id] = v;
  else vals[id] = v;
}

/**
 * The rows a record holds, each set into `vals` on the record's chain.
 *
 * @param {SnapRecord} rec
 * @param {Edit['vals']} vals
 * @returns {Set<string>}
 */
function heldOf(rec, vals) {
  /** @type {Set<string>} */
  const inc = new Set();
  for (const row of SNAP_ROWS) {
    const f = byChain(row.field, vals.mode);
    if (!Object.hasOwn(rec.fields, f)) continue;
    inc.add(row.id);
    setVal(vals, row.id, rec.fields[f]);
  }
  return inc;
}

/**
 * A record as an edit: every row has a value (the engine's where the record holds none); inc = what it holds. Null =
 * New: what the engine runs now, every row held.
 *
 * @param {SnapRecord | null} rec
 * @returns {Edit}
 */
export function fromRecord(rec) {
  const L = liveNow();
  const mode = rec ? recordChain(rec) : L.run;
  /** @type {Edit['vals']} */
  const vals = { mode, adaptive: String(L.adaptive), profile: String(L.profile), pcm: { ...L.pcm }, sdm: { ...L.sdm } };
  if (!rec) return { name: "", stations: [home()], inc: new Set(SNAP_ROWS.map((r) => r.id)), vals };
  const inc = heldOf(rec, vals);
  const c = cur.value;
  return { name: c.name === NEW ? "" : c.name, stations: [c.st], inc, vals };
}

/**
 * Record `ref` as saved, as an edit.
 *
 * @param {Ref} ref
 * @returns {Edit}
 */
const saved = (ref) => fromRecord(ref.name === NEW ? null : (snapshotBook()[ref.st]?.[ref.name] ?? null));

/**
 * The edit showing: its staged buffer, else its record as saved.
 *
 * @returns {Edit}
 */
export function editNow() {
  const buf = /** @type {Edit | undefined} */ (staged.value.get(keyOf(cur.value)));
  return buf ?? saved(cur.value);
}

/**
 * What the snapshot would store: chain rows only with Mode (they index its chain).
 *
 * @param {Edit} e
 * @returns {Set<string>}
 */
const held = (e) => new Set([...e.inc].filter((id) => !isChain(id) || e.inc.has("mode")));

/**
 * What tells two edits apart: name, stations, and the rows held with their values.
 *
 * @param {Edit} e
 * @returns {string}
 */
const sig = (e) => {
  const ids = [...held(e)].sort();
  return JSON.stringify([e.name, [...e.stations].sort(), ids, ...ids.map((id) => valOf(e, id))]);
};

/**
 * Change the edit; stage it while it differs from what is saved, drop it once it matches again.
 *
 * @param {(e: Edit) => void} fn
 * @param {boolean} [soft]  typing in the name box
 */
export function change(fn, soft) {
  const e = globalThis.structuredClone(editNow());
  fn(e);
  const c = cur.value;
  stage(sig(e) === sig(saved(c)) && (c.name !== NEW || !e.name) ? null : e);
  if (!soft) refused.value = false;
}

/**
 * What a save sends: the rows held at the edit's values, in wire fields; chain rows only with Mode held.
 *
 * @param {Edit} edit
 * @returns {RecordOut}
 */
export function recordOf(edit) {
  const ids = held(edit);
  const rows = SNAP_ROWS.filter((r) => ids.has(r.id));
  const fields = rows.map((r) => byChain(r.field, edit.vals.mode));
  const values = Object.fromEntries(rows.map((r, i) => [fields[i], valOf(edit, r.id)]));
  return { fields, values };
}

/**
 * Fill every held row of `x` from the engine, Mode first (the chain rows follow it).
 *
 * @param {Edit} x
 */
export function takeAll(x) {
  const L = liveNow();
  if (x.inc.has("mode")) x.vals.mode = L.run;
  for (const row of SNAP_ROWS) {
    if (!x.inc.has(row.id) || row.id === "mode") continue;
    setVal(x.vals, row.id, isChain(row.id) ? L[x.vals.mode][row.id] : String(L[row.id]));
  }
}
