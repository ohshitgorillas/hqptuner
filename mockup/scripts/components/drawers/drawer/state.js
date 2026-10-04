// A mounted drawer's staged state and the DOM it paints: the record every module of the drawer reads (D), a control's
// change, the dirty dots, the apply group's paint, the gray reasons and the backend groups. The decisions are
// model/drawer.js's; this module executes them.

import { select } from "../../controls/seg.js";
import { withXref, hasXref } from "../../../lib/controls/xref.js";
import { editOf, regray, isStaged, applyPaint, restarts } from "../../../model/shell/drawer.js";
import { family } from "./registry.js";

/**
 * The drawer record D for one mount: its schema and deps, its value store (a family's shared one), and the maps the
 * controls register into. The DOM fields (tabs, panels, title, drawer, applyGrp, curTab, setOpen, api) fill in as
 * mountDrawer builds them.
 */
export function drawerState(
  schema,
  { groupNames, devices, rateTiers, blocks, on, onApply, prefix, famName, onValues },
) {
  const fam = (famName ?? schema.family) ? family(famName ?? schema.family) : null;
  return {
    schema,
    groupNames,
    devices,
    rateTiers,
    blocks,
    on,
    onApply,
    prefix,
    onValues,
    fam,
    backend: schema.backend,
    vals: fam ? fam.vals : {}, // control id → current value (seg + number); a family shares one store
    base: fam ? fam.base : {}, // control id → the value Discard returns to: the last applied (live rows: the current)
    segs: new Map(), // seg control id → {el, c, r, paintOpt}
    ui: new Map(), // control id → {set, c, r, paintOpt, el}: set(v) repaints that control (Discard)
    discards: [], // block ctx.onDiscard listeners
    blockIds: new Set(), // value ids a block keeps (it repaints them itself on Discard)
    blockEl: new Map(), // block value id → its block element (remark: dirty dots after a buffer is put back)
    grays: [], // {ctls: [{c, el}], reason: el} per row with gray-able controls
    rowGray: null, // collects the row being built
    watchers: [], // block ctx.watch listeners
    tabs: [],
    panels: [],
    single: false,
    title: null,
    drawer: null,
    applyGrp: null,
    curTab: null,
    setOpen: null,
    api: null,
  };
}

/** One control changed (at = {el, c, r, paintOpt}): record it, stage it unless its row is live, then the hooks hear it. */
export function changed(D, at, v) {
  const { el, c, r, paintOpt } = at;
  const edit = editOf(c.id, v, r.live);
  Object.assign(D.vals, edit.vals);
  Object.assign(D.base, edit.base); // live rows apply at once: nothing to discard
  paintOpt(v);
  regrayDrawer(D);
  if (edit.dirty) markDirty(D, el);
  if (c.switchesBackend) setBackend(D, v);
  D.on[c.id]?.(v);
}

/** Move a seg control from outside (mock cross-effects). Runs the same path as a tap. */
export function setFrom(D, id, v) {
  const it = D.segs.get(id);
  if (!it || it.el.querySelector("button.on")?.dataset.v === String(v)) return;
  select(it.el, v);
  changed(D, it, v);
}

/** Re-read every gray reason from the current values: disable those controls, print the row's reasons. A reason that
 *  names its fix elsewhere links there (lib/xref.js), once per drawer (the first row showing it); a second mount
 *  (Profile builder, `prefix`) never links: its targets are the chain's drawers, under another body. */
export function regrayDrawer(D) {
  const rows = regray(
    D.grays.map((g) => g.ctls.map(({ c }) => c)),
    D.vals,
    !D.prefix,
    hasXref,
  );
  D.grays.forEach((g, i) => paintGray(g, rows[i]));
  for (const fn of D.watchers) fn(D.vals);
  D.onValues?.(D.vals);
}

/** One row's gray state: each control on or off, then its reason lines (blank reason = gray with no line). */
function paintGray(g, { off, reasons }) {
  g.ctls.forEach(({ el }, i) => {
    el.classList.toggle("grayed", off[i]);
    for (const x of el.matches("select,input") ? [el] : el.querySelectorAll("button,input,select")) x.disabled = off[i];
  });
  g.reason.replaceChildren(...reasons.flatMap((r, i) => [i ? " " : "", ...withXref(r.text, r.link)]));
  g.reason.hidden = !reasons.length;
}

/** The dirty dot on el's tab (a single-part stage: on the title), then the apply group repaints. */
export function markDirty(D, el) {
  const p = el.closest(".dpanel");
  if (!p) return;
  (D.single ? D.title : D.tabs.find((b) => b.dataset.tab === p.dataset.tab)).classList.add("dirty");
  paintApply(D);
}

/** The apply group shows on a restart tab or with staged edits (any family member's); its buttons need staged edits. */
export function paintApply(D) {
  const staged = isStaged(D.drawer.querySelector(".dirty") !== null, D.fam ? D.fam.members : []);
  const { shown, live } = applyPaint(restarts(D.schema, D.curTab), staged);
  D.applyGrp.paint(shown, live);
}

/** Every dirty dot clears; the apply group repaints. */
export function clearDirty(D) {
  for (const el of D.drawer.querySelectorAll(".dirty")) el.classList.remove("dirty");
  paintApply(D);
}

/** The Backend segment decides which backend groups show; Combo shows all of them. */
export function setBackend(D, v) {
  D.backend = v;
  D.drawer.classList.toggle("combo", v === "combo");
  for (const g of D.drawer.querySelectorAll(".begrp")) g.hidden = !groupVisible(D, g.dataset.be);
}

/** Does backend `be`'s group show under the current backend. */
export function groupVisible(D, be) {
  return D.backend === "combo" || D.backend === be;
}
