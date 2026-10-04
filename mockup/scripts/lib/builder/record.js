// The shell's record and staging: the record being edited, its staged edits, switching, discarding, the confirm line's
// ask, and Save and Delete over the record book. Every function takes the shell's state (`sh`) and the builder's spec.

import { closeOthers } from '../../components/drawer.js';
import { OVERVIEW, keyOf, dirtyAt, stashed, savePlan, savedTo, removedFrom } from '../../model/builder.js';

/** @typedef {import('../../model/builder.js').Ref} Ref */

/**
 * @typedef {object} Shell  the shell's mutable state
 * @property {import('../../model/builder.js').Book<any>} book
 * @property {Ref} cur  the record being edited
 * @property {Map<string, any>} staged
 * @property {{ text: string, onConfirm: () => void } | null} ask  the confirm line's question
 * @property {boolean} refused  Save with no name
 * @property {{ discard: HTMLButtonElement, save?: HTMLButtonElement }[]} acts  the buttons that follow the state
 */

/**
 * @param {{ book: any, cur: Ref }} spec
 * @returns {Shell}
 */
export const shellState = (spec) => ({ book: spec.book, cur: spec.cur, staged: new Map(), ask: null, refused: false, acts: [] });

/**
 * @param {Shell} sh
 * @param {any} spec
 * @param {Ref} c
 */
export const isDirty = (sh, spec, c) => dirtyAt(keyOf(c), keyOf(sh.cur), sh.staged, spec.dirty());

/**
 * Load a record's edit (`over`, else its staged edit, else the record); its staged edit is spent.
 *
 * @param {Shell} sh
 * @param {any} spec
 * @param {Ref} c
 * @param {any} [over]
 */
export function load(sh, spec, c, over) {
  if (!spec.load) return;
  spec.load(c, over ?? sh.staged.get(keyOf(c)));
  sh.staged = stashed(sh.staged, keyOf(c), null);
}

/**
 * Stage the edit being left while it differs from its record.
 *
 * @param {Shell} sh
 * @param {any} spec
 */
export function stash(sh, spec) {
  if (spec.load && spec.buffer) sh.staged = stashed(sh.staged, keyOf(sh.cur), spec.dirty() ? spec.buffer() : null);
}

/**
 * Stage `buf` as the edit of the record being edited (null: it matches the record again).
 *
 * @param {Shell} sh
 * @param {any} buf
 */
export function stage(sh, buf) { sh.staged = stashed(sh.staged, keyOf(sh.cur), buf); }

/**
 * @param {Shell} sh
 * @param {any} spec
 * @param {Ref} c
 */
export function go(sh, spec, c) {
  stash(sh, spec); closeOthers(null);
  sh.cur = c; sh.ask = null; sh.refused = false;
  load(sh, spec, c);
  spec.went?.(c);
  spec.view(OVERVIEW);
}

/**
 * @param {Shell} sh
 * @param {any} spec
 */
export function discard(sh, spec) {
  sh.staged = stashed(sh.staged, keyOf(sh.cur), null); sh.ask = null; sh.refused = false;
  load(sh, spec, sh.cur);
  spec.view('here');
}

/**
 * Put a question on the confirm line.
 *
 * @param {Shell} sh
 * @param {any} spec
 * @param {string} text
 * @param {() => void} onConfirm
 */
export function confirm(sh, spec, text, onConfirm) { closeOthers(null); sh.ask = { text, onConfirm }; spec.view(OVERVIEW); }

/**
 * Write the record Save planned.
 *
 * @param {Shell} sh
 * @param {any} spec
 * @param {{ taken: any, name: string, to: string[] }} o
 */
function write(sh, spec, { taken, name, to }) {
  const from = sh.cur;
  const rec = spec.record(taken);
  const out = savedTo(sh.book, sh.cur, name, to, rec, !!spec.keeps?.(sh.cur));
  sh.book = out.book;
  sh.staged = stashed(sh.staged, keyOf(from), null);
  sh.cur = out.cur;
  if (!spec.load) sh.staged = stashed(sh.staged, keyOf(sh.cur), null);   // an edit kept in staged is the saved record now
  spec.saved({ from, name, to, rec });
}

/**
 * @param {Shell} sh
 * @param {any} spec
 */
export function save(sh, spec) {
  const taken = spec.take?.();
  const name = spec.name().trim();
  const to = spec.to();
  const plan = savePlan(sh.book, sh.cur, name, to);
  if (plan === 'refuse') { closeOthers(null); sh.refused = true; spec.refuse(); return; }
  if (plan === 'idle') return;
  if (plan === 'ask') confirm(sh, spec, spec.copy.overwrite(name), () => write(sh, spec, { taken, name, to }));
  else write(sh, spec, { taken, name, to });
}

/**
 * @param {Shell} sh
 * @param {any} spec
 */
export function remove(sh, spec) {
  const from = sh.cur;
  const out = removedFrom(sh.book, sh.cur, spec.land?.());
  sh.book = out.book;
  sh.staged = stashed(sh.staged, keyOf(from), null);
  sh.cur = out.cur;
  spec.removed(from);
}
