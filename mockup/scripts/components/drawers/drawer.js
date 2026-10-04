// Stage drawer, rendered from a schema (see data/output.js for the shape).
// Opens only from its rail stage. Tabs = the parts of that stage. A change marks its tab dirty (it stages)
// unless its row is `live` (applies at once, never stages). The head's top-right corner, clear of the close button, carries
// the apply group (no restart marks anywhere in drawers): Discard + Apply. Apply writes the station and restarts the engine:
// one act, as the daemon has it (a config file holds startup defaults; writing it is the restart). There is no
// applied-but-unsaved state, so no Apply & save, no Auto-save. It shows while the open tab holds a restart-lane setting
// (schema.restart = every row; else row.restart, or tab.restart for a block) or while the drawer holds staged edits; its
// buttons work only with staged edits.
// Apply clears the dirty dots (mock); Discard puts every staged value back to the last applied one and clears them. The Backend segment decides which backend
// groups show; Combo shows all of them, each under its own subhead.
// A {block} item mounts a bespoke part from deps.blocks[name](host, ctx). An instrument (Source meter) ignores ctx and never
// stages; a setting block (Volume range bar) stages through ctx: set(id, v) records + marks dirty, init(id, v) records
// its start value, watch(fn) hears the drawer's values after every change (gray reasons).
// One drawer open at a time: opening one closes the others.
// deps.on[controlId](value) hears every change to that control (mock cross-effects, e.g. rail readouts).
// row.man is a string or [{k, text}] paragraphs (k = the sub-setting's label, bolded ahead of its copy).
// control.gray(values) → reason ('' = enabled): the control disables and the reason shows under the row's controls;
// values are the drawer's current (staged) control values by id, re-read on every change.
// control type 'group' {items:[control]} lays several controls in one row; an item's `label` sits above it.
// control type 'choice' {options:[{v, label, sub?, control?, man?}]}: vertical radio lines spanning the row, each with its
// own detail control (enabled only while its line is picked, never hidden) and its manual paragraph on the right.
// row.optMan [{v, man}] lists every option with its manual copy across the full row, under control and copy; the selected one is lit and
// follows the selection; tapping an option selects it (same path as the control).
//
// The parts live under drawer/: registry (one open at a time, families), state (the drawer record D, staging, gray,
// dirty dots), apply (the apply bar and its acts), head (tabs, panels, frame), rows (body items), controls and one
// module per control kind. The decisions they execute are model/drawer.js's.

import { h } from "../../lib/shell/dom.js";
import { closeBtn } from "../../lib/controls/controls.js";
import { startValues } from "../../../../hqptuner/static/model/shell/drawer.js";
import { registerDrawer, drawerOpener } from "./drawer/registry.js";
import { drawerState, setFrom, regrayDrawer, paintApply } from "./drawer/state.js";
import { drawerApplyGroup, applied, discarded, settle, remark } from "./drawer/apply.js";
import { tabStrip, tabPanels, drawerShell, prefixIds, showTab } from "./drawer/head.js";

export { familyOf, loadValues, registerDrawer, closeOthers, drawerOpener } from "./drawer/registry.js";
export { onApplied, applyGroup } from "./drawer/apply.js";

/** @typedef {import("./drawer/state.js").Drawer} Drawer */
/** @typedef {import("./drawer/state.js").DrawerApi} DrawerApi */
/** @typedef {import("./drawer/state.js").Schema} Schema */
/** @typedef {import("./drawer/state.js").Store} Store */
/** @typedef {import("./drawer/state.js").Devices} Devices */
/** @typedef {import("./drawer/state.js").RateTiers} RateTiers */
/** @typedef {import("./drawer/state.js").Block} Block */

/**
 * What a mount takes besides its body, stage and schema.
 *
 * @typedef {object} Deps
 * @property {Record<string, string>} [groupNames]
 * @property {Record<string, Devices>} [devices]
 * @property {RateTiers} [rateTiers]
 * @property {Record<string, Block>} [blocks]
 * @property {Record<string, (v: string) => void>} [on]
 * @property {(vals: Store) => void} [onApply]
 * @property {string} [prefix]
 * @property {string} [family]
 * @property {Element} [head]
 * @property {(vals: Store) => void} [onValues]
 */

/**
 * The drawer's api: what main.js, the family's other members and the Profile builder call.
 *
 * @param {Drawer} D
 * @returns {DrawerApi}
 */
function drawerApi(D) {
  return {
    setOpen: D.setOpen,
    showTab: (t) => showTab(D, t),
    set: (id, v) => setFrom(D, id, v),
    regray: () => regrayDrawer(D),
    isOpen: () => !D.drawer.hasAttribute("data-closed"),
    hasDirty: () => D.drawer.querySelector(".dirty") !== null,
    /** Apply (mock): this member's staged values take effect (rail follows via onApply), dots clear. */
    applied: () => applied(D),
    /** Discard (mock): this member's staged values go back to the last applied ones; settle() then repaints. */
    discarded: () => discarded(D),
    settle: () => settle(D),
    /** Dirty dots for every value that differs from the base (a staged buffer put back by the Profile builder). */
    remark: () => remark(D),
  };
}

/**
 * Mount a stage drawer from its schema into `body`, toggled by its rail stage; returns the drawer's api.
 *
 * @param {HTMLElement} body       .body grid the drawer overlays
 * @param {HTMLElement} stage      rail stage button that toggles it
 * @param {Schema} schema          drawer schema
 * @param {Deps} deps              {groupNames?, devices?, rateTiers?, blocks?: {name: (host) => void}, on?: {id: (v) => void},
 *                                  }  (row.band: 'pcm'|'sdm' tags a family-only row; never grays by mode)
 *   A second mount of a schema (Profile builder) passes: prefix (every DOM id inside gets it, so the two copies never
 *   share an id; CSS keys on both), family (its own store instead of the schema's), head (an element for the head's
 *   top-right corner in place of the apply group: the builder's own Discard / Save), onValues(vals) (hears the family's
 *   values after every change, once the blocks have followed them).
 * @returns {DrawerApi}
 */
export function mountDrawer(
  body,
  stage,
  schema,
  { groupNames = {}, devices, rateTiers, blocks = {}, on = {}, onApply, prefix = "", family: famName, head, onValues },
) {
  const D = drawerState(schema, { groupNames, devices, rateTiers, blocks, on, onApply, prefix, famName, onValues });
  D.tabs = tabStrip(D);
  const close = closeBtn(() => D.setOpen(false), "Close drawer");
  D.panels = tabPanels(D);
  D.single = D.tabs.length === 1;
  D.applyGrp = drawerApplyGroup(D);
  D.curTab = schema.tabs[0];
  D.title = h("span.t", { text: schema.title });
  D.drawer = drawerShell(D, head ?? D.applyGrp.el, close);
  if (prefix) prefixIds(D.drawer, prefix);
  body.append(D.drawer);

  Object.assign(D.base, startValues(D.vals, D.base)); // start values (a family: each member adds its own)
  regrayDrawer(D);
  paintApply(D);

  stage.setAttribute("aria-controls", D.drawer.id);
  stage.addEventListener("click", () => D.setOpen(D.drawer.hasAttribute("data-closed")));
  D.setOpen = drawerOpener(
    D.drawer,
    [stage],
    () => D.api,
    () => {
      regrayDrawer(D);
      paintApply(D);
    },
  );

  D.api = drawerApi(D);
  registerDrawer(D.api);
  if (D.fam) D.fam.members.push(D.api);
  return D.api;
}
