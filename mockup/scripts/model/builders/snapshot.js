// DOM-free decisions the Snapshot builder (components/snapshot-builder.js) makes: how many lines a rail page holds from
// the heights measured at each size, which page a save reveals, which station folds are open and what each lists, which
// rail entries light with the edit, and each row's value, live value and whether the two differ. Each returns a value
// and leaves its arguments as they were.

import { NEW, keyOf } from "./builder.js";
import { paging } from "./pager.js";

/** @typedef {import('./builder.js').Ref} Ref */
/** @typedef {import('../../data/stages/conversion.js').Chain} Chain */
/**
 * Per-row values: the chain rows under the chain `mode` names, each chain's kept apart; every other row's by its id.
 *
 * @typedef {{
 *   mode: Chain,
 *   pcm: Record<string, string>,
 *   sdm: Record<string, string>,
 *   [id: string]: string | Record<string, string>,
 * }} Vals
 */
/**
 * A snapshot as edited: every row has a value; inc = the rows it holds.
 *
 * @typedef {object} Edit
 * @property {string} name
 * @property {string[]} stations  the stations Save writes to
 * @property {Set<string>} inc
 * @property {Vals} vals  per-row values; the chain rows under vals[vals.mode]
 */
/**
 * The engine now: the chain it runs, each chain's rows, and every other row's value, Output mode's included (`V`; the
 * app's are strings).
 *
 * @template {string | number} [V=string]
 * @typedef {{
 *   mode: V,
 *   run: Chain,
 *   pcm: Record<string, string>,
 *   sdm: Record<string, string>,
 *   [id: string]: V | Chain | Record<string, string>,
 * }} Engine
 */
/**
 * One station's fold on the rail.
 *
 * @typedef {object} Fold
 * @property {string} name
 * @property {number} count    snapshots the station holds
 * @property {boolean} open
 * @property {boolean} loaded  the loaded station
 * @property {boolean} dirty   holds a staged edit
 * @property {string[]} items  the names its shown page lists (none while shut)
 * @property {number} fill     blank lines that keep a short last page full height
 */
/**
 * One row of the page, derived, against an engine whose row values are `V`.
 *
 * @template {string | number} [V=string]
 * @typedef {object} RowView
 * @property {boolean} gated  a chain row whose snapshot leaves out Mode
 * @property {boolean} on     held and not gated
 * @property {string} value   the snapshot's value
 * @property {string | V} live  the engine's value
 * @property {boolean} idle   the engine's value is on a chain it is not running
 * @property {boolean} differs
 * @property {boolean} take   ← is live
 */

const CHAIN_IDS = ["1x", "nx", "sh"];

/**
 * A row whose value lives under the snapshot's Output mode.
 *
 * @param {string} id
 * @returns {boolean}
 */
export const isChain = (id) => CHAIN_IDS.includes(id);

/**
 * An edit's value for one row.
 *
 * @param {Edit} e
 * @param {string} id
 * @returns {string}
 */
export const valOf = (e, id) => (isChain(id) ? e.vals[e.vals.mode][id] : /** @type {string} */ (e.vals[id]));

/**
 * Lines a rail page holds: the most, from `most` down, whose measured content fits the rail; `least` when none above
 * it does (never measured). An unmeasured rail (no height) holds `most`.
 *
 * @param {(per: number) => { client: number, scroll: number }} measure  the rail painted at `per`, measured
 * @param {number} [most]
 * @param {number} [least]
 * @returns {number}
 */
export function railPer(measure, most = 40, least = 3) {
  for (let per = most; per > least; per--) {
    const { client, scroll } = measure(per);
    if (!client || scroll <= client) return per;
  }
  return least;
}

/**
 * The page of its station's list that holds `cur`, or null for New or a name the station does not hold.
 *
 * @param {Record<string, Record<string, unknown>>} book
 * @param {Ref} cur
 * @param {number} per
 * @returns {number | null}
 */
export function revealPage(book, cur, per) {
  if (cur.name === NEW) return null;
  const i = Object.keys(book[cur.st]).indexOf(cur.name);
  return i >= 0 ? Math.floor(i / per) : null;
}

/**
 * Every station's fold. One open at most; its list shows the page asked for (the first on a measuring pass).
 *
 * @param {object} rail
 * @param {string[]} rail.stations  in the tree's order
 * @param {Record<string, Record<string, unknown>>} rail.book
 * @param {string | null} rail.open  the open station
 * @param {string} rail.home         the loaded station
 * @param {string[]} rail.staged     keys of the staged edits
 * @param {number} rail.per
 * @param {Map<string, number>} rail.pages  station → the page asked for
 * @param {boolean} [rail.first]     a measuring pass
 * @returns {Fold[]}
 */
export function railFolds({ stations, book, open, home, staged, per, pages, first }) {
  return stations.map((name) => {
    const names = Object.keys(book[name]);
    const isOpen = name === open;
    const pg = paging(names.length, per, first ? 0 : (pages.get(name) ?? 0));
    const items = isOpen ? names.slice(pg.start, pg.end) : [];
    return {
      name,
      count: names.length,
      open: isOpen,
      loaded: name === home,
      dirty: staged.some((k) => k.startsWith(name + "\u0001")),
      items,
      fill: isOpen && names.length > per ? per - items.length : 0,
    };
  });
}

/**
 * A rail entry lit with the edit: the one edited, plus the same-named snapshot in every other ticked station (Save
 * writes there too).
 *
 * @param {Ref} c    the entry
 * @param {Ref} cur  the one edited
 * @param {Edit} e
 * @returns {boolean}
 */
export function litEntry(c, cur, e) {
  return keyOf(c) === keyOf(cur) || (cur.name !== NEW && c.name === (e.name || cur.name) && e.stations.includes(c.st));
}

/**
 * The engine's value for a row: a chain row's from the snapshot's chain, idle when the engine runs the other.
 *
 * @template {string | number} V
 * @param {Edit} e
 * @param {string} id
 * @param {Engine<V>} L  the engine now
 * @returns {{ v: string | V, idle: boolean }}
 */
function liveOf(e, id, L) {
  if (isChain(id)) return { v: L[e.vals.mode][id], idle: e.vals.mode !== L.run };
  if (id === "mode") return { v: L.mode, idle: false };
  return { v: /** @type {V} */ (L[id]), idle: false };
}

/**
 * One row against the engine. Mode never differs from an engine on auto.
 *
 * @template {string | number} V
 * @param {{ id: string }} row
 * @param {Edit} e
 * @param {Engine<V>} L  the engine now
 * @returns {RowView<V>}
 */
export function snapRow(row, e, L) {
  const gated = isChain(row.id) && !e.inc.has("mode");
  const on = e.inc.has(row.id) && !gated;
  const value = valOf(e, row.id);
  const { v: live, idle } = liveOf(e, row.id, L);
  const auto = row.id === "mode" && live === "auto";
  const differs = String(live) !== String(value) && !auto;
  return { gated, on, value, live, idle, differs, take: on && differs && !auto };
}
