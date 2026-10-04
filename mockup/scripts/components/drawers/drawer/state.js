// A mounted drawer's staged state and the DOM it paints: the record every module of the drawer reads (D), a control's
// change, the dirty dots, the apply group's paint, the gray reasons and the backend groups. The decisions are
// model/drawer.js's; this module executes them.

import { select } from "../../controls/seg.js";
import { withXref, hasXref } from "../../../lib/controls/xref.js";
import { editOf, regray, isStaged, applyPaint, restarts } from "../../../model/shell/drawer.js";
import { family } from "./registry.js";

/** @typedef {import("../../../model/shell/drawer.js").Values} Values */
/** @typedef {import("../../../model/shell/drawer.js").Grayable} Grayable */
/** @typedef {import("../../../model/shell/drawer.js").RowGray} RowGray */
/** @typedef {import("./registry.js").Family} Family */
/** @typedef {import("./registry.js").SetOpen} SetOpen */
/** @typedef {import("./apply.js").ApplyGroup} ApplyGroup */
/** @typedef {Parameters<typeof import("../../controls/rate-dial.js").mountRateDial>[1]} RateTiers */
/** @typedef {{ list: string[], selected: number }} Devices */

/** @typedef {Record<string, string>} Store  control id → value, as the controls hold it */
/** @typedef {(v: string) => void} Setter  moves a control to a value without staging it */

/**
 * A control's element, with the setter that repaints it.
 *
 * @template {HTMLElement} [E=HTMLElement]
 * @typedef {E & { _setValue?: Setter }} SettableEl
 */

/** @typedef {import("../../../data/stages/output.js").DrawerSchema} Schema */
/** @typedef {import("../../../data/stages/output.js").Item} Item */
/** @typedef {import("../../../data/stages/output.js").Row} Row */
/** @typedef {import("../../../data/stages/output.js").Control} Control */
/** @typedef {import("../../../data/settings/common.js").Option} Option */
/** @typedef {Schema["tabs"][number]} Tab */

/** @typedef {Control & { aria?: string }} Labelled  a control as the shared builders take it (null aria = no label) */
/** @typedef {Labelled & { options: Option[] }} Listed  a control kind that lists options */

/**
 * A setting block's staging handle: seed a value, stage one, hear Discard, hear every value change.
 *
 * @typedef {object} BlockCtx
 * @property {(id: string, v: unknown) => void} init
 * @property {(id: string, v: unknown) => void} set
 * @property {(fn: (base: Store) => void) => void} onDiscard
 * @property {(fn: (vals: Store) => void) => void} watch
 */

/** @typedef {(host: HTMLElement, ctx: BlockCtx) => void} Block */

/** @typedef {{ c: Control, r: { live?: boolean }, paintOpt: (v: unknown) => void }} Ctl  what a control builder gets */
/** @typedef {Ctl & { el: HTMLElement }} Bound  a built control */
/** @typedef {{ c: Control & Grayable, el: HTMLElement }} GrayCtl */

/**
 * A mounted drawer's api: what main.js, the family's other members and the Profile builder call.
 *
 * @typedef {object} DrawerApi
 * @property {SetOpen} setOpen
 * @property {(t: string) => void} showTab
 * @property {(id: string, v: string) => void} set
 * @property {() => void} regray
 * @property {() => boolean} isOpen
 * @property {() => boolean} hasDirty
 * @property {() => void} applied
 * @property {() => void} discarded
 * @property {() => void} settle
 * @property {() => void} remark
 */

/**
 * The record of one mount.
 *
 * @typedef {object} Drawer
 * @property {Schema} schema
 * @property {Record<string, string>} groupNames
 * @property {Record<string, Devices> | undefined} devices
 * @property {RateTiers | undefined} rateTiers
 * @property {Record<string, Block>} blocks
 * @property {Record<string, (v: string) => void>} on
 * @property {((vals: Store) => void) | undefined} onApply
 * @property {string} prefix
 * @property {((vals: Store) => void) | undefined} onValues
 * @property {Family | null} fam
 * @property {string | undefined} backend
 * @property {Store} vals
 * @property {Store} base
 * @property {Map<string | undefined, Bound>} segs
 * @property {Map<string, Bound & { set: Setter }>} ui
 * @property {((base: Store) => void)[]} discards
 * @property {Set<string>} blockIds
 * @property {Map<string, HTMLElement>} blockEl
 * @property {{ ctls: GrayCtl[], reason: HTMLElement }[]} grays
 * @property {GrayCtl[] | null} rowGray
 * @property {((vals: Store) => void)[]} watchers
 * @property {HTMLElement[]} tabs
 * @property {HTMLElement[]} panels
 * @property {boolean} single
 * @property {HTMLElement} title
 * @property {HTMLElement} drawer
 * @property {ApplyGroup} applyGrp
 * @property {Tab} curTab
 * @property {SetOpen} setOpen
 * @property {DrawerApi} api
 */

/**
 * The deps mountDrawer passes on to the record.
 *
 * @typedef {object} StateDeps
 * @property {Record<string, string>} groupNames
 * @property {Record<string, Devices> | undefined} devices
 * @property {RateTiers | undefined} rateTiers
 * @property {Record<string, Block>} blocks
 * @property {Record<string, (v: string) => void>} on
 * @property {((vals: Store) => void) | undefined} onApply
 * @property {string} prefix
 * @property {string | undefined} famName
 * @property {((vals: Store) => void) | undefined} onValues
 */

/**
 * The drawer record D for one mount: its schema and deps, its value store (a family's shared one), and the maps the
 * controls register into. The DOM fields (tabs, panels, title, drawer, applyGrp, curTab, setOpen, api) fill in as
 * mountDrawer builds them, before anything reads them; the record is typed as the finished one.
 *
 * @param {Schema} schema
 * @param {StateDeps} deps
 * @returns {Drawer}
 */
export function drawerState(
  schema,
  { groupNames, devices, rateTiers, blocks, on, onApply, prefix, famName, onValues },
) {
  const famKey = famName ?? schema.family;
  const fam = famKey ? family(famKey) : null;
  const record = /** @type {unknown} */ ({
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
  });
  return /** @type {Drawer} */ (record);
}

/**
 * One control changed (at = {el, c, r, paintOpt}): record it, stage it unless its row is live, then the hooks hear it.
 *
 * @param {Drawer} D
 * @param {Bound} at
 * @param {string} v
 */
export function changed(D, at, v) {
  const { el, c, r, paintOpt } = at;
  const id = String(c.id); // the key a missing id has always been stored under
  const edit = editOf(id, v, r.live);
  Object.assign(D.vals, edit.vals);
  Object.assign(D.base, edit.base); // live rows apply at once: nothing to discard
  paintOpt(v);
  regrayDrawer(D);
  if (edit.dirty) markDirty(D, el);
  if (c.switchesBackend) setBackend(D, v);
  D.on[id]?.(v);
}

/**
 * Move a seg control from outside (mock cross-effects). Runs the same path as a tap.
 *
 * @param {Drawer} D
 * @param {string | undefined} id
 * @param {string} v
 */
export function setFrom(D, id, v) {
  const it = D.segs.get(id);
  if (!it || /** @type {HTMLElement | null} */ (it.el.querySelector("button.on"))?.dataset.v === String(v)) return;
  select(it.el, v);
  changed(D, it, v);
}

/**
 * Re-read every gray reason from the current values: disable those controls, print the row's reasons. A reason that
 * names its fix elsewhere links there (lib/xref.js), once per drawer (the first row showing it); a second mount
 * (Profile builder, `prefix`) never links: its targets are the chain's drawers, under another body.
 *
 * @param {Drawer} D
 */
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

/**
 * One row's gray state: each control on or off, then its reason lines (blank reason = gray with no line).
 *
 * @param {{ ctls: GrayCtl[], reason: HTMLElement }} g
 * @param {RowGray} gray
 */
function paintGray(g, { off, reasons }) {
  g.ctls.forEach(({ el }, i) => {
    el.classList.toggle("grayed", off[i]);
    const xs = /** @type {Iterable<HTMLInputElement>} */ (
      el.matches("select,input") ? [el] : el.querySelectorAll("button,input,select")
    );
    for (const x of xs) x.disabled = off[i];
  });
  g.reason.replaceChildren(...reasons.flatMap((r, i) => [i ? " " : "", ...withXref(r.text, r.link)]));
  g.reason.hidden = !reasons.length;
}

/**
 * The dirty dot on el's tab (a single-part stage: on the title), then the apply group repaints.
 *
 * @param {Drawer} D
 * @param {HTMLElement} el
 */
export function markDirty(D, el) {
  const p = /** @type {HTMLElement | null} */ (el.closest(".dpanel"));
  if (!p) return;
  const dot = D.single ? D.title : D.tabs.find((b) => b.dataset.tab === p.dataset.tab);
  /** @type {HTMLElement} */ (dot).classList.add("dirty");
  paintApply(D);
}

/**
 * The apply group shows on a restart tab or with staged edits (any family member's); its buttons need staged edits.
 *
 * @param {Drawer} D
 */
export function paintApply(D) {
  const staged = isStaged(D.drawer.querySelector(".dirty") !== null, D.fam ? D.fam.members : []);
  const { shown, live } = applyPaint(restarts(D.schema, D.curTab), staged);
  D.applyGrp.paint(shown, live);
}

/**
 * Every dirty dot clears; the apply group repaints.
 *
 * @param {Drawer} D
 */
export function clearDirty(D) {
  for (const el of D.drawer.querySelectorAll(".dirty")) el.classList.remove("dirty");
  paintApply(D);
}

/**
 * The Backend segment decides which backend groups show; Combo shows all of them.
 *
 * @param {Drawer} D
 * @param {string} v
 */
export function setBackend(D, v) {
  D.backend = v;
  D.drawer.classList.toggle("combo", v === "combo");
  const groups = /** @type {NodeListOf<HTMLElement>} */ (D.drawer.querySelectorAll(".begrp"));
  for (const g of groups) g.hidden = !groupVisible(D, g.dataset.be);
}

/**
 * Does backend `be`'s group show under the current backend.
 *
 * @param {Drawer} D
 * @param {string | undefined} be
 * @returns {boolean}
 */
export function groupVisible(D, be) {
  return D.backend === "combo" || D.backend === be;
}
