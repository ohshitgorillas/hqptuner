// The apply bar: the head's Discard + Apply group, and what Apply, Discard, settle and remark do to a mounted drawer.

import { h } from "../../lib/dom.js";
import { applyTargets, commit, restoreOf, blockRestore, dirtyIds } from "../../model/drawer.js";
import { regrayDrawer, clearDirty, markDirty, setBackend } from "./state.js";

/**
 * Head apply group, top right: Discard + Apply. Apply writes the staged edits into the station and restarts the
 * engine; there is nothing to save afterwards (the thread with Jussi, 2026-10-03: config is for settled values, so a
 * restart that the station won't remember has no job; experiments live in the live rows, snapshots and matrix
 * profiles). Discard drops the staged edits. Closing the drawer never discards: edits stay staged so complex changes can
 * be built before applying. paint(shown, staged): the group shows when `shown`; both buttons are live only with
 * staged edits.
 */
const appliedFns = [];
/** Hear every Apply from any drawer (main.js: the connection knob reads Applying… while the engine restarts). */
export function onApplied(fn) {
  appliedFns.push(fn);
}
export function applyGroup(onApply, onDiscard) {
  const discard = h("button.btn.sm", { type: "button", text: "Discard", on: { click: () => onDiscard?.() } });
  const apply = h("button.btn.sm.aapply", {
    type: "button",
    text: "Apply",
    on: {
      click: () => {
        onApply();
        for (const fn of appliedFns) fn();
      },
    },
  });
  const el = h("div.apply", { hidden: true }, discard, apply);
  return {
    el,
    paint(shown, staged) {
      el.hidden = !shown;
      discard.disabled = apply.disabled = !staged;
      el.classList.toggle("staged", staged);
    },
  };
}

/** A stage drawer's apply group: Apply and Discard reach every family member (else the drawer alone). */
export function drawerApplyGroup(D) {
  return applyGroup(
    () => {
      for (const d of applyTargets(D.fam, D.api)) d.applied();
    },
    // Family: every member puts its values back first, then all repaint (a gray reason or block may read another's).
    () => {
      const ms = applyTargets(D.fam, D.api);
      for (const d of ms) d.discarded();
      for (const d of ms) d.settle();
    },
  );
}

/** Apply (mock): this member's staged values take effect (rail follows via onApply), dots clear. */
export function applied(D) {
  D.onApply?.(D.vals);
  Object.assign(D.base, commit(D.vals, D.base));
  clearDirty(D);
}

/**
 * Discard (mock): every staged value goes back to the last applied one, the controls and blocks repaint, and the dots
 * clear. Hooks (deps.on) hear the restored values, as they heard the edits (backend groups, cross-effects).
 */
export function discarded(D) {
  for (const [id, { set, c, paintOpt }] of D.ui) {
    const back = restoreOf(id, D.vals, D.base);
    if (!(id in back)) continue;
    D.vals[id] = back[id];
    set(back[id]);
    paintOpt(back[id]);
    if (c.switchesBackend) setBackend(D, back[id]);
    D.on[id]?.(back[id]);
  }
  Object.assign(D.vals, blockRestore(D.blockIds, D.base)); // this member's block values (not another member's)
  for (const fn of D.discards) fn({ ...D.base });
}

/** After a Discard: every gray reason re-reads the values, the dots clear. */
export function settle(D) {
  regrayDrawer(D);
  clearDirty(D);
}

/** Dirty dots for every value that differs from the base (a staged buffer put back by the Profile builder). */
export function remark(D) {
  for (const id of dirtyIds(D.ui.keys(), D.vals, D.base)) markDirty(D, D.ui.get(id).el);
  for (const id of dirtyIds(D.blockEl.keys(), D.vals, D.base)) markDirty(D, D.blockEl.get(id));
}
