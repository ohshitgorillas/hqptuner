import { NEW } from "../../../../../hqptuner/static/model/builders/builder.js";
import { SNAP_ROWS } from "../../../data/builders/snapshots.js";
import { isChain, valOf } from "../../../../../hqptuner/static/model/builders/snapshot.js";
import { render } from "../snapshot-builder.js";

/** @typedef {import('../snapshot-builder.js').Snap} Snap */
/** @typedef {import('../snapshot-builder.js').Snapshot} Snapshot */
/** @typedef {import('../../../../../hqptuner/static/model/builders/builder.js').Ref} Ref */
/** @typedef {import('../../../../../hqptuner/static/model/builders/snapshot.js').Edit} Edit */
/** @typedef {import('../../../data/stages/conversion.js').Chain} Chain */

// ── Edit buffers ────────────────────────────────────────────────────────
/**
 * A record as an edit: every row has a value (the engine's where the record holds none); inc = what it holds.
 *
 * @param {Snap} S
 * @param {Snapshot | null} r  null = New
 * @returns {Edit}
 */
function fromRecord(S, r) {
  const L = S.live();
  const mode = /** @type {Chain} */ (r?.mode ?? L.run);
  /** @type {Edit['vals']} */
  const vals = {
    autopilot: L.autopilot,
    adaptive: L.adaptive,
    profile: L.profile,
    mode,
    pcm: { ...L.pcm },
    sdm: { ...L.sdm },
  };
  /** @type {Set<string>} */
  const inc = new Set();
  if (!r) {
    // New: what the engine runs now, everything attached (v1: every row checked)
    for (const row of SNAP_ROWS) inc.add(row.id);
    vals.mode = L.run;
    return { name: "", stations: [S.home], inc, vals };
  }
  for (const [k, v] of Object.entries(r)) {
    inc.add(k);
    if (isChain(k)) vals[mode][k] = v;
    else vals[k] = v;
  }
  return { name: S.B.cur.name, stations: [S.B.cur.st], inc, vals };
}
/**
 * Record `c` as saved, as an edit.
 *
 * @param {Snap} S
 * @param {Ref} c
 * @returns {Edit}
 */
const saved = (S, c) => (c.name === NEW ? fromRecord(S, null) : fromRecord(S, S.B.book[c.st][c.name]));
/**
 * The edit showing: its staged buffer, else its record as saved.
 *
 * @param {Snap} S
 * @returns {Edit}
 */
export const edit = (S) => S.B.staged.get(S.B.K(S.B.cur)) ?? saved(S, S.B.cur);
/**
 * What tells two edits apart: name, stations, and the rows held with their values.
 *
 * @param {Edit} e
 * @returns {string}
 */
const key = (e) =>
  JSON.stringify([
    e.name,
    [...e.stations].sort(),
    [...held(e)].sort(),
    ...[...held(e)].sort().map((id) => valOf(e, id)),
  ]);
/**
 * What the snapshot would store: chain rows only with Mode (they index its chain).
 *
 * @param {Edit} e
 * @returns {Set<string>}
 */
const held = (e) => new Set([...e.inc].filter((id) => !isChain(id) || e.inc.has("mode")));
/**
 * Record `c` holds a staged edit.
 *
 * @param {Snap} S
 * @param {Ref} c
 * @returns {boolean}
 */
export const dirtyOf = (S, c) => S.B.staged.has(S.B.K(c));

/**
 * What the snapshot stores: the rows it holds, at the edit's values.
 *
 * @param {Edit} e
 * @returns {Snapshot}
 */
export function recordOf(e) {
  /** @type {Snapshot} */
  const r = {};
  for (const id of SNAP_ROWS.map((x) => x.id)) if (held(e).has(id)) r[id] = valOf(e, id);
  return r;
}

/**
 * Change the edit; stage it while it differs from what is saved, drop it once it matches again. soft = no re-render
 * (the name box: typing must not rebuild the page under the caret, or under a Save tap that blurs it).
 *
 * @param {Snap} S
 * @param {(e: Edit) => void} fn
 * @param {boolean} [soft]
 */
export function change(S, fn, soft) {
  const { B } = S;
  const e = structuredClone(edit(S));
  e.inc = new Set(edit(S).inc);
  fn(e);
  B.stage(key(e) === key(saved(S, B.cur)) && (B.cur.name !== NEW || !e.name) ? null : e);
  if (soft) {
    B.paintState();
    return;
  }
  B.refused = false;
  render(S);
}
