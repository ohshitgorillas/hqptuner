// The record builders' shared shell: the record being edited, its staged edits, switching, discarding, the confirm
// line's ask, and Save and Remove over the live-snapshot book. Decisions are model/builders/builder.js's; this store
// executes them and holds the result in signals.
import { signal } from "@preact/signals";
import {
  NEW,
  keyOf,
  dirtyAt,
  stashed,
  stateOf,
  savePlan,
  savedTo,
  removedFrom,
} from "../../../model/builders/builder.js";
import { api } from "../../../lib/api.js";
import { errText } from "../../../lib/errtext.js";
import { refreshLivePresets, livePresetError } from "../../live/presets.js";

/** @typedef {import("../../../model/builders/builder.js").Ref} Ref */
/**
 * @template T
 * @typedef {import("../../../model/builders/builder.js").Book<T>} Book
 */
/** @typedef {import("../../../model/builders/builder.js").State} State */
/** @typedef {{ text: string, onConfirm: () => void }} Ask  the confirm line's question */

/** The record being edited. */
export const cur = signal(/** @type {Ref} */ ({ st: "", name: NEW }));
/** Each record's unsaved edit, by `keyOf` its record. */
export const staged = signal(/** @type {Map<string, unknown>} */ (new Map()));
/** The confirm line's question, or null. */
export const ask = signal(/** @type {Ask | null} */ (null));
/** Save was refused for want of a name. */
export const refused = signal(false);

/**
 * Open on the loaded station: its first record, else its New entry.
 *
 * @param {Book<unknown>} book
 * @param {string} home  the loaded station
 * @returns {void}
 */
export function openOn(book, home) {
  cur.value = { st: home, name: Object.keys(book[home] ?? {})[0] ?? NEW };
}

/**
 * Switch to record `ref`; the confirm line and the refusal clear, and every staged edit stays.
 *
 * @param {Ref} ref
 * @returns {void}
 */
export function go(ref) {
  cur.value = ref;
  ask.value = null;
  refused.value = false;
}

/**
 * Stage `buf` as the edit of the record being edited (null: it matches its record again).
 *
 * @param {unknown} buf
 * @returns {void}
 */
export function stage(buf) {
  staged.value = stashed(staged.value, keyOf(cur.value), buf);
}

/**
 * Drop the edit of the record being edited; the confirm line and the refusal clear.
 *
 * @returns {void}
 */
export function discard() {
  staged.value = stashed(staged.value, keyOf(cur.value), null);
  ask.value = null;
  refused.value = false;
}

/**
 * Put a question on the confirm line.
 *
 * @param {string} text
 * @param {() => void} onConfirm
 * @returns {void}
 */
export function confirm(text, onConfirm) {
  ask.value = { text, onConfirm };
}

/**
 * Take the question off the confirm line without running it.
 *
 * @returns {void}
 */
export function cancelAsk() {
  ask.value = null;
}

/**
 * Take the question off the confirm line and run it.
 *
 * @returns {void}
 */
export function answerAsk() {
  const q = ask.value;
  ask.value = null;
  q?.onConfirm();
}

/**
 * Whether record `ref` holds unsaved edits: the one being edited by `dirtyNow`, any other by its staged edit.
 *
 * @param {Ref} ref
 * @param {boolean} dirtyNow  the edited record's live comparison
 * @returns {boolean | null}
 */
export function isDirty(ref, dirtyNow) {
  return dirtyAt(keyOf(ref), keyOf(cur.value), staged.value, dirtyNow);
}

/**
 * Write the record Save planned: one PUT, the old record's DELETE where it moved or was renamed, a re-read of the
 * book, then the record edited moves to where it landed and both its old and new staged edits are spent.
 *
 * @param {{ book: Book<unknown>, name: string, to: string[], fields: string[], values: Record<string, string> }} o
 * @returns {Promise<void>}
 */
async function write({ book, name, to, fields, values }) {
  const from = cur.value;
  const landed = savedTo(book, from, { name, to, rec: /** @type {unknown} */ (null), keep: false }).cur;
  const gone = from.name !== NEW && (from.name !== name || !to.includes(from.st));
  try {
    await api.saveLivePreset(name, fields, to, values);
    if (gone) await api.deleteLivePreset(from.name, from.st);
  } catch (e) {
    livePresetError.value = errText(e);
    return;
  }
  await refreshLivePresets();
  staged.value = stashed(stashed(staged.value, keyOf(from), null), keyOf(landed), null);
  cur.value = landed;
}

/**
 * Save the record being edited as `name` to every station in `to`: refuse with no name, nothing with no station, ask
 * before overwriting, else one PUT, the old record's DELETE where it moved or was renamed, and a re-read of the book.
 *
 * @param {{
 *   book: Book<unknown>,
 *   name: string,
 *   to: string[],
 *   fields: string[],
 *   values: Record<string, string>,
 *   copy: { overwrite: (name: string) => string },
 * }} o
 * @returns {Promise<void>}
 */
export async function save(o) {
  const name = o.name.trim();
  const plan = savePlan(o.book, cur.value, name, o.to);
  if (plan === "refuse") refused.value = true;
  else if (plan === "ask") confirm(o.copy.overwrite(name), () => void write({ ...o, name }));
  else if (plan === "write") await write({ ...o, name });
}

/**
 * Remove the record being edited and its staged edit, re-read the book, and land on `land`, else the first record left
 * in its station, else that station's New entry.
 *
 * @param {{ book: Book<unknown>, land?: Ref }} o
 * @returns {Promise<void>}
 */
export async function remove(o) {
  const from = cur.value;
  const landed = removedFrom(o.book, from, o.land).cur;
  try {
    await api.deleteLivePreset(from.name, from.st);
  } catch (e) {
    livePresetError.value = errText(e);
    return;
  }
  await refreshLivePresets();
  staged.value = stashed(staged.value, keyOf(from), null);
  cur.value = landed;
}

/**
 * The state line and the Discard / Save buttons for the record being edited.
 *
 * @param {{ dirty: boolean, ticked: boolean }} facts
 * @returns {State | null}
 */
export function stateNow(facts) {
  return stateOf({ ...facts, isNew: cur.value.name === NEW, restarts: false, live: false });
}
