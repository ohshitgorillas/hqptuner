// The shell's record and staging: the record being edited, its staged edits, switching, discarding, the confirm line's
// ask, and Save and Delete over the record book. Every function takes the shell's state (`sh`) and the builder's spec.

import { closeOthers } from "../../components/drawers/drawer.js";
import { OVERVIEW, keyOf, dirtyAt, stashed, savePlan, savedTo, removedFrom } from "../../model/builders/builder.js";

/** @typedef {import('../../model/builders/builder.js').Ref} Ref */
/**
 * @template R, E
 * @typedef {import('./builder.js').Spec<R, E>} Spec
 */

/**
 * The shell's mutable state, over the builder's record type `R` and edit type `E`.
 *
 * @template R, E
 * @typedef {object} Shell
 * @property {import('../../model/builders/builder.js').Book<R>} book
 * @property {Ref} cur  the record being edited
 * @property {Map<string, E>} staged
 * @property {{ text: string, onConfirm: () => void } | null} ask  the confirm line's question
 * @property {boolean} refused  Save with no name
 * @property {{ discard: HTMLButtonElement, save?: HTMLButtonElement }[]} acts  the buttons that follow the state
 */

/**
 * The shell's state on opening: the spec's book and record, nothing staged, asked or refused, no buttons yet.
 *
 * @template R, E
 * @param {Pick<Spec<R, E>, 'book' | 'cur'>} spec
 * @returns {Shell<R, E>}
 */
export const shellState = (spec) => ({
  book: spec.book,
  cur: spec.cur,
  staged: new Map(),
  ask: null,
  refused: false,
  acts: [],
});

/**
 * Whether record `c` carries an edit: the one being edited by the spec's own test, any other by its staged edit.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 * @param {Ref} c
 */
export const isDirty = (sh, spec, c) => dirtyAt(keyOf(c), keyOf(sh.cur), sh.staged, spec.dirty());

/**
 * Load a record's edit (`over`, else its staged edit, else the record); its staged edit is spent.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 * @param {Ref} c
 * @param {E} [over]
 */
export function load(sh, spec, c, over) {
  if (!spec.load) return;
  spec.load(c, over ?? sh.staged.get(keyOf(c)));
  sh.staged = stashed(sh.staged, keyOf(c), null);
}

/**
 * Stage the edit being left while it differs from its record.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 */
export function stash(sh, spec) {
  if (spec.load && spec.buffer) sh.staged = stashed(sh.staged, keyOf(sh.cur), spec.dirty() ? spec.buffer() : null);
}

/**
 * Stage `buf` as the edit of the record being edited (null: it matches the record again).
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {E | null} buf
 */
export function stage(sh, buf) {
  sh.staged = stashed(sh.staged, keyOf(sh.cur), buf);
}

/**
 * Switch to record `c`: the edit being left is staged, the confirm line and refusal clear, `c` loads, the overview
 * repaints.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 * @param {Ref} c
 */
export function go(sh, spec, c) {
  stash(sh, spec);
  closeOthers(null);
  sh.cur = c;
  sh.ask = null;
  sh.refused = false;
  load(sh, spec, c);
  spec.went?.(c);
  spec.view(OVERVIEW);
}

/**
 * Drop the edit of the record being edited and load it back from its record; the same view repaints.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 */
export function discard(sh, spec) {
  sh.staged = stashed(sh.staged, keyOf(sh.cur), null);
  sh.ask = null;
  sh.refused = false;
  load(sh, spec, sh.cur);
  spec.view("here");
}

/**
 * Put a question on the confirm line.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Pick<Spec<R, E>, 'view'>} spec
 * @param {string} text
 * @param {() => void} onConfirm
 */
export function confirm(sh, spec, text, onConfirm) {
  closeOthers(null);
  sh.ask = { text, onConfirm };
  spec.view(OVERVIEW);
}

/**
 * Write the record Save planned.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 * @param {{ taken: E | undefined, name: string, to: string[] }} o
 */
function write(sh, spec, { taken, name, to }) {
  const from = sh.cur;
  const rec = spec.record(taken);
  const out = savedTo(sh.book, sh.cur, { name, to, rec, keep: !!spec.keeps?.(sh.cur) });
  sh.book = out.book;
  sh.staged = stashed(sh.staged, keyOf(from), null);
  sh.cur = out.cur;
  if (!spec.load) sh.staged = stashed(sh.staged, keyOf(sh.cur), null); // an edit kept in staged is the saved record now
  spec.saved({ from, name, to, rec });
}

/**
 * Save: refuse with no name, do nothing with nowhere to write, ask before overwriting, else write.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 */
export function save(sh, spec) {
  const taken = spec.take?.();
  const name = spec.name().trim();
  const to = spec.to();
  const plan = savePlan(sh.book, sh.cur, name, to);
  if (plan === "refuse") {
    closeOthers(null);
    sh.refused = true;
    spec.refuse();
    return;
  }
  if (plan === "idle") return;
  if (plan === "ask") confirm(sh, spec, spec.copy.overwrite(name), () => write(sh, spec, { taken, name, to }));
  else write(sh, spec, { taken, name, to });
}

/**
 * Delete the record being edited and its staged edit; the shell lands on the record the book picks.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 */
export function remove(sh, spec) {
  const from = sh.cur;
  const out = removedFrom(sh.book, sh.cur, spec.land?.());
  sh.book = out.book;
  sh.staged = stashed(sh.staged, keyOf(from), null);
  sh.cur = out.cur;
  spec.removed(from);
}
