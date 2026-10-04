// The stage drawer's store half: what a drawer drawn from its schema decides over the v1 store. Which tabs carry a
// dirty dot, whether the title carries it, whether the apply group shows and whether its buttons are live, which tab
// is shown, which open question the drawer pins under its head, the options and value a row's control renders, and the
// apply mode the head's split button runs. The DOM half is components/faceplate/drawer/.
//
// A drawer's rows name v1 catalog keys (store/schema.js). A row stages for a restart when its entry is http-lane and
// the write path cannot route it live (`appliesLive`); that is the row that marks its tab. Members of one `family`
// share their staged state: any member's staged edit lights every member's apply group.
//
// The apply mode is a browser-held preference, one choice for every drawer: `apply` applies the staged set, `save`
// applies it and saves it into the loaded station.

import { computed, signal } from "@preact/signals";
import { applyPaint, isStaged, restarts } from "../../model/shell/drawer.js";
import { truthy } from "../../lib/coerce.js";
import { schema as catalog } from "../schema.js";
import { activePreset, effective, formFieldName, isDirty } from "../resolve.js";
import { applyAll } from "../actions.js";
import { question } from "../ask.js";
import { enumOptions, optionsFor } from "../ui/options.js";
import { enumPref } from "../ui/prefs.js";
import { openPopover } from "./view.js";

/**
 * One body item of a tab: a row naming a catalog key, an intro paragraph, or a block the caller mounts by name.
 *
 * @typedef {{ row: { key: string } } | { intro: string } | { block: string }} BodyItem
 */

/** @typedef {{ id: string, label: string, body: BodyItem[] }} DrawerTab */

/**
 * A stage drawer's schema.
 *
 * @typedef {object} DrawerSchema
 * @property {string} id
 * @property {string} title
 * @property {string} aria
 * @property {string} [family]
 * @property {DrawerTab[]} tabs
 */

/**
 * What a drawer's head shows: the tabs carrying a dirty dot, whether the title carries it, and the apply group's
 * state.
 *
 * @typedef {object} DrawerHead
 * @property {string[]} dirty
 * @property {boolean} titleDot
 * @property {{ shown: boolean, live: boolean }} apply
 */

/** @typedef {{ value: string | number | undefined, label: string, disabled?: boolean }} RowOption */

/**
 * The open question as store/ask.js publishes it; a warn carries the wording of its two answers.
 *
 * @typedef {{ owner: string, kind: string, message: string, confirm?: string, decline?: string }} AskedQuestion
 */

/** The mode menu's popover id. */
export const APPLY_MENU = "applymode";

/** The two apply modes, in menu order. */
export const APPLY_MODES = ["apply", "save"];

const [mode, setMode] = enumPref("hqptuner.applyMode", APPLY_MODES, "apply");

/** The apply mode in force, `apply` or `save`. */
export const applyMode = mode;

/** Whether Apply & save has a station to save into: one is loaded. */
export const canSave = computed(() => activePreset.value !== "");

/**
 * Pick an apply mode from the menu: it becomes the mode for every drawer, and the menu closes. A mode outside the two
 * is turned away.
 *
 * @param {string} next
 */
export function pickApplyMode(next) {
  setMode(next);
  if (openPopover.value === APPLY_MENU) openPopover.value = null;
}

/**
 * The split button's act: apply the staged set, saving it into the loaded station in `save` mode. With no station
 * loaded, `save` mode sends nothing.
 *
 * @returns {Promise<import("../apply-summary.js").ApplyAnswer | null>}
 */
export async function runApply() {
  if (applyMode.value !== "save") return applyAll();
  if (!canSave.value) return null;
  return applyAll({ name: activePreset.value });
}

/** Registered drawers, by family, then by id. @type {Map<string, Map<string, DrawerSchema>>} */
const families = new Map();

/**
 * Register a drawer so the other members of its family share its staged state. Registering an id again replaces it.
 *
 * @param {DrawerSchema} drawer
 */
export function registerDrawer(drawer) {
  if (!drawer.family) return;
  const members = families.get(drawer.family) ?? new Map();
  members.set(drawer.id, drawer);
  families.set(drawer.family, members);
}

/**
 * Whether a catalog key stages for a restart: http-lane and not routed live.
 *
 * @param {string} key
 */
const restartLane = (key) => {
  const e = catalog[key];
  return !!e && e.lane === "http" && !e.appliesLive;
};

/**
 * The catalog keys a tab's rows name.
 *
 * @param {DrawerTab} tab
 * @returns {string[]}
 */
const tabKeys = (tab) => tab.body.flatMap((it) => ("row" in it ? [it.row.key] : []));

/**
 * The ids of the tabs holding a staged restart-lane row, in tab order.
 *
 * @param {DrawerSchema} drawer
 * @returns {string[]}
 */
const dirtyTabs = (drawer) =>
  drawer.tabs.filter((t) => tabKeys(t).some((k) => restartLane(k) && isDirty(k))).map((t) => t.id);

/**
 * The other registered members of a drawer's family, as the staged test reads them.
 *
 * @param {DrawerSchema} drawer
 * @returns {{ hasDirty: () => boolean }[]}
 */
function siblings(drawer) {
  const members = drawer.family ? families.get(drawer.family) : undefined;
  if (!members) return [];
  return [...members.values()]
    .filter((m) => m.id !== drawer.id)
    .map((m) => ({ hasDirty: () => dirtyTabs(m).length > 0 }));
}

/**
 * A tab as the restart test reads it: each row flagged by its key's lane.
 *
 * @param {DrawerTab} tab
 */
const restartView = (tab) => ({
  body: tab.body.map((it) => ("row" in it ? { row: { restart: restartLane(it.row.key) } } : {})),
});

/**
 * What a drawer's head shows with `tabId` open.
 *
 * @param {DrawerSchema} drawer
 * @param {string} tabId
 * @returns {DrawerHead}
 */
export function drawerHead(drawer, tabId) {
  const dirty = dirtyTabs(drawer);
  const tab = drawer.tabs.find((t) => t.id === tabId) ?? drawer.tabs[0];
  const staged = isStaged(dirty.length > 0, siblings(drawer));
  return {
    dirty,
    titleDot: drawer.tabs.length === 1 && dirty.length > 0,
    apply: applyPaint(restarts({}, restartView(tab)), staged),
  };
}

/** The tab last picked in each drawer, by drawer id. @type {{ value: Record<string, string> }} */
const picked = signal(/** @type {Record<string, string>} */ ({}));

/**
 * The tab a drawer shows: the one last picked in it, else its first.
 *
 * @param {DrawerSchema} drawer
 * @returns {string}
 */
export function shownTab(drawer) {
  const id = picked.value[drawer.id];
  return drawer.tabs.some((t) => t.id === id) ? id : drawer.tabs[0].id;
}

/**
 * Pick a drawer's tab.
 *
 * @param {string} drawerId
 * @param {string} tabId
 */
export function showTab(drawerId, tabId) {
  picked.value = { ...picked.value, [drawerId]: tabId };
}

/** The owner of the questions an Apply asks (store/guards.js). */
const APPLY_OWNER = "pending";

/**
 * The open question this drawer pins under its head: one an Apply asked, or one a row of this drawer asked. Null when
 * none is open or it belongs elsewhere.
 *
 * @param {DrawerSchema} drawer
 * @returns {AskedQuestion | null}
 */
export function drawerQuestion(drawer) {
  const q = question.value;
  if (!q) return null;
  const mine = q.owner === APPLY_OWNER || drawer.tabs.some((t) => tabKeys(t).includes(q.owner));
  return mine ? q : null;
}

/** A checkbox row's two choices, drawn as a segment. */
const OFF_ON = [
  { value: "0", label: "Off" },
  { value: "1", label: "On" },
];

/**
 * The options a row's segment or select lists: a checkbox's two, the engine's enumeration, the daemon form's own
 * list, or the catalog's.
 *
 * @param {string} key
 * @returns {RowOption[]}
 */
export function rowOptions(key) {
  const e = catalog[key];
  if (!e) return [];
  if (e.widget === "checkbox") return OFF_ON;
  if (e.optionsFrom === "enum") return enumOptions(e.enumKey || "");
  if (e.optionsFrom) return optionsFor(e.optionsFrom, formFieldName(e));
  return e.options ?? [];
}

/**
 * The value a row's control renders, as its options are written: a truth as "1" or "0", anything else as a string.
 *
 * @param {string} key
 * @returns {string}
 */
export function rowValue(key) {
  const e = catalog[key];
  const v = effective(key);
  if (e && (e.widget === "checkbox" || e.bool)) return truthy(v) ? "1" : "0";
  return v === undefined ? "" : String(v);
}
