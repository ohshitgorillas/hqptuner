// Every stage drawer on the page: the one-open-at-a-time rule, the open/close wipe, Escape, and the drawer families.

import { anyOpen } from '../../lib/popover.js';
import { commit } from '../../model/drawer.js';

const DRAWERS = [];
// Drawer families: drawers that edit one shared object (the Matrix engine family edits the matrix profile in focus:
// Matrix engine, Crossfeed, Loudness, DAC correction). Members share one value store (control ids unique across the
// family), so a gray reason in one can read a setting in another; staging is family-wide: an edit staged in any
// member lights the apply group in every member, and Apply there applies them all (one profile write).
const FAMILIES = new Map();
export const family = (name) => {
  if (!FAMILIES.has(name)) FAMILIES.set(name, { vals: {}, base: {}, members: [] });
  return FAMILIES.get(name);
};
/** A family's shared store: {vals, base, members} (the Profile builder reads the chain's applied matrix for New). */
export const familyOf = (name) => family(name);
/** Load a saved record's values into a family as applied: every member drops its staged edits and repaints on them. */
export function loadValues(name, vals) {
  const fam = family(name);
  Object.assign(fam.base, commit(vals, fam.base));   // in place: every member holds this store by reference
  for (const d of fam.members) d.discarded();
  for (const d of fam.members) { d.settle(); d.applied(); }
}

/** Bespoke drawers (Resampling · Shaping) join the one-open-at-a-time rule through these. api = {setOpen(open, snap)}. */
export function registerDrawer(api) { DRAWERS.push(api); }
/** Close every other drawer at once, no wipe: only the drawer being opened animates (two wipes at
 * once compete). Settings' swap passes null (closes all). */
export function closeOthers(api) { for (const d of DRAWERS) if (d !== api) d.setOpen(false, true); }
/** Toggle a drawer's closed state; snap = no wipe (it closes because another opens, or the body swaps). */
export function wipe(el, closed, snap) {
  if (closed === el.hasAttribute('data-closed')) return;
  if (snap) el.classList.add('snap');
  el.toggleAttribute('data-closed', closed);
  if (snap) { void el.offsetWidth; el.classList.remove('snap'); }   // flush with no transition, then restore it
}

// Escape closes the stage drawers: one document listener for every drawer, each drawer's close in mount order.
const escClosers = [];
function closeOnEscape(close) {
  if (!escClosers.length) document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !anyOpen()) for (const fn of escClosers) fn(); });
  escClosers.push(close);
}

/**
 * A stage drawer's setOpen(open, snap), shared by mountDrawer and mountModeDrawer: opening closes the others (self() is
 * the drawer's api), then runs onOpen; the drawer wipes, and each of its stages reads open (a hidden stage never lights).
 * Escape closes it.
 */
export function drawerOpener(drawer, stages, self, onOpen) {
  function setOpen(open, snap) {
    if (open) { closeOthers(self()); onOpen?.(); }
    wipe(drawer, !open, snap);
    for (const st of stages) {
      st.classList.toggle('open', open && !st.hidden);
      st.setAttribute('aria-expanded', String(open));
    }
  }
  closeOnEscape(() => setOpen(false));
  return setOpen;
}
