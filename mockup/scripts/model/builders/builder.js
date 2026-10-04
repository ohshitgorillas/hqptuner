// DOM-free decisions the builders' shared shell (lib/builder.js) makes: which station is home, how an edit keys its
// staged buffer, where Next and Back land, whether a record reads dirty, what the state line and its buttons say, how
// the stations menu ticks, whether Save refuses, asks or writes, and the record book after a save or a remove. Each
// returns the new state as a value and leaves its arguments as they were.

/** The New entry's name: no typed name can equal it. */
export const NEW = "\u0000new";
/** The page a walk returns to past its last step or before its first. */
export const OVERVIEW = "overview";

/** @typedef {{ st: string, name: string }} Ref  a record: the station it is in and its name (NEW = not saved yet) */
/**
 * @template T
 * @typedef {Record<string, Record<string, T>>} Book  station → name → record, each station's names in list order
 */
/** @typedef {'restarts' | 'dirty' | 'live' | 'saved'} Line  what the state line says */
/** @typedef {{ line: Line, pending: boolean, discardOff: boolean, saveOff: boolean }} State */
/** @typedef {'refuse' | 'idle' | 'ask' | 'write'} Plan  what Save does */

/**
 * The loaded station: the one the tree marks active, else the tree's first.
 *
 * @param {{ name: string, active?: boolean }[]} stations  in the tree's order
 * @returns {string}
 */
export function homeOf(stations) {
  return stations.find((st) => st.active)?.name ?? stations[0].name;
}

/**
 * The key a record's staged edit is held under. Every New entry shares one key, whichever station it would land in.
 *
 * @param {Ref} ref
 * @returns {string}
 */
export function keyOf(ref) {
  return ref.name === NEW ? NEW : ref.st + "\u0001" + ref.name;
}

/**
 * The name a record shows: the one typed, else its saved name (none for New).
 *
 * @param {string} typed
 * @param {Ref} cur
 * @returns {string}
 */
export function shownName(typed, cur) {
  return typed || (cur.name === NEW ? "" : cur.name);
}

/**
 * The step Next lands on from step `i`: the first later one not skipped, else the overview.
 *
 * @param {string[]} ids  the walk's step ids, in order
 * @param {number} i
 * @param {(id: string) => boolean} skipped
 * @returns {string}
 */
export function nextStep(ids, i, skipped) {
  return ids.slice(i + 1).find((id) => !skipped(id)) ?? OVERVIEW;
}

/**
 * The step Back lands on from step `i`: the nearest earlier one not skipped, else the overview.
 *
 * @param {string[]} ids  the walk's step ids, in order
 * @param {number} i
 * @param {(id: string) => boolean} skipped
 * @returns {string}
 */
export function prevStep(ids, i, skipped) {
  return (
    ids
      .slice(0, Math.max(i, 0))
      .reverse()
      .find((id) => !skipped(id)) ?? OVERVIEW
  );
}

/**
 * Whether a record holds unsaved edits: the one being edited by its live comparison, any other by a staged edit.
 *
 * @param {string} key  the record's key
 * @param {string} curKey  the key of the record being edited
 * @param {ReadonlyMap<string, unknown>} staged
 * @param {boolean} dirtyNow  the edited record's live comparison
 * @returns {boolean}
 */
export function dirtyAt(key, curKey, staged, dirtyNow) {
  return key === curKey ? dirtyNow : staged.has(key);
}

/**
 * The staged edits with `key` holding `buf`, or with `key` dropped when `buf` is null (the edit matches its record).
 *
 * @template B
 * @param {ReadonlyMap<string, B>} staged
 * @param {string} key
 * @param {B | null} buf
 * @returns {Map<string, B>}
 */
export function stashed(staged, key, buf) {
  const next = new Map(staged);
  if (buf === null) next.delete(key);
  else next.set(key, buf);
  return next;
}

/**
 * The state line and the Discard / Save buttons for the record being edited.
 *
 * @param {{ dirty: boolean, isNew: boolean, ticked: boolean, restarts: boolean, live: boolean }} facts
 *   dirty: unsaved edits; isNew: the New entry; ticked: Save has somewhere to write; restarts: saving restarts the
 *   engine; live: the engine runs this record
 * @returns {State}
 */
export function stateOf({ dirty, isNew, ticked, restarts, live }) {
  const pending = dirty || isNew;
  /** @type {Line} */
  let line = live ? "live" : "saved";
  if (pending) line = restarts ? "restarts" : "dirty";
  return { line, pending, discardOff: !dirty, saveOff: (!dirty && !isNew) || !ticked };
}

/**
 * The stations ticked after one is tapped in the menu: unticked if it was ticked, else added in the tree's order.
 *
 * @param {string[]} all  every station, in the tree's order
 * @param {string[]} ticked
 * @param {string} name
 * @returns {string[]}
 */
export function toggleStation(all, ticked, name) {
  return ticked.includes(name) ? ticked.filter((n) => n !== name) : all.filter((n) => n === name || ticked.includes(n));
}

/**
 * Whether station `st` already holds another record named `name` (Save there overwrites it).
 *
 * @template T
 * @param {Book<T>} book
 * @param {Ref} cur  the record being edited
 * @param {string} name
 * @param {string} st
 * @returns {boolean}
 */
export function heldAt(book, cur, name, st) {
  return Boolean(name) && Object.hasOwn(book[st], name) && !(st === cur.st && name === cur.name);
}

/**
 * What Save does: refuse with no name, nothing with no station ticked, ask before overwriting a record of that name,
 * else write.
 *
 * @template T
 * @param {Book<T>} book
 * @param {Ref} cur
 * @param {string} name  the trimmed name typed
 * @param {string[]} to  the stations Save writes to
 * @returns {Plan}
 */
export function savePlan(book, cur, name, to) {
  if (!name) return "refuse";
  if (!to.length) return "idle";
  return to.some((st) => heldAt(book, cur, name, st)) ? "ask" : "write";
}

/**
 * The book after Save writes `rec` as `name` to each station in `to`, and the record then edited. A record whose own
 * station stays ticked is edited in place (a rename keeps its place in the list); one whose own station is unticked
 * moves out of it, unless `keep` holds it there.
 *
 * @template T
 * @param {Book<T>} book
 * @param {Ref} cur
 * @param {{ name: string, to: string[], rec: T, keep: boolean }} save  to: non-empty; keep: the record stays in its
 *   own station even when unticked
 * @returns {{ book: Book<T>, cur: Ref }}
 */
export function savedTo(book, cur, { name, to, rec, keep }) {
  const own = cur.name !== NEW && to.includes(cur.st);
  /** @type {Book<T>} */
  const out = { ...book };
  if (cur.name !== NEW && !own && !keep) out[cur.st] = without(out[cur.st], cur.name);
  for (const st of to) {
    const list = out[st];
    if (own && st === cur.st && name !== cur.name) {
      out[st] = Object.fromEntries(
        renamedIn(Object.keys(list), cur.name, name).map((k) => [k, k === name ? rec : list[k]]),
      );
    } else out[st] = { ...list, [name]: globalThis.structuredClone(rec) };
  }
  return { book: out, cur: { st: own ? cur.st : to[0], name } };
}

/**
 * A list of names after Save writes `name` from `cur` (NEW: not listed yet): a rename keeps its place and drops any
 * other entry of the new name, a new name joins the end.
 *
 * @param {string[]} names
 * @param {string} cur
 * @param {string} name
 * @returns {string[]}
 */
export function namesAfterSave(names, cur, name) {
  if (cur !== NEW && name !== cur) return renamedIn(names, cur, name);
  return names.includes(name) ? [...names] : [...names, name];
}

/**
 * The book after the record `cur` is removed, and the record then edited: `land` when given, else the first left in
 * its station, else that station's New entry.
 *
 * @template T
 * @param {Book<T>} book
 * @param {Ref} cur
 * @param {Ref} [land]
 * @returns {{ book: Book<T>, cur: Ref }}
 */
export function removedFrom(book, cur, land) {
  const left = without(book[cur.st], cur.name);
  return { book: { ...book, [cur.st]: left }, cur: land ?? { st: cur.st, name: Object.keys(left)[0] ?? NEW } };
}

/**
 * Names with `from` renamed `to` in place, any other `to` dropped.
 *
 * @param {string[]} names
 * @param {string} from
 * @param {string} to
 */
const renamedIn = (names, from, to) => names.filter((n) => n !== to).map((n) => (n === from ? to : n));

/**
 * A station's records without `name`, the rest in their order.
 *
 * @template T
 * @param {Record<string, T>} list
 * @param {string} name
 * @returns {Record<string, T>}
 */
function without(list, name) {
  return Object.fromEntries(Object.entries(list).filter(([k]) => k !== name));
}
