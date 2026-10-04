// The stage drawer's store half: what a drawer drawn from its schema decides over the v1 store. Which tabs carry a
// dirty dot, whether the title carries it, whether the apply group shows and whether its buttons are live, which tab
// is shown, which open question the drawer pins under its head, the options, value and option lines a row's control
// renders, and the apply mode the head's split button runs. The DOM half is components/faceplate/drawer/; the schema
// grammar is drawer/grammar.js.
//
// A drawer's items name v1 catalog keys (store/schema.js). A key stages for a restart when its entry is http-lane and
// the write path cannot route it live (`appliesLive`); a staged restart key dots its tab, and a shown one makes its tab
// a restart tab. Members of one `family` share their staged state: any member's staged edit lights every member's
// apply group. A drawer with its own form (`own`) stands that form in for the staged set: its staged state dots every
// tab, its apply group always shows, and Apply and Discard run the form.
//
// The apply mode is a browser-held preference, one choice for every drawer: `apply` applies the staged set, `save`
// applies it and saves it into the loaded station.

import { computed } from "@preact/signals";
import { applyPaint, isStaged } from "../../model/shell/drawer.js";
import { schema as catalog } from "../schema.js";
import { activePreset, isDirty } from "../resolve.js";
import { applyAll, discardAll } from "../actions.js";
import { question } from "../ask.js";
import { enumPref } from "../ui/prefs.js";
import { openPopover } from "./view.js";
import { shownKeys, tabKeys } from "./drawer/grammar.js";

export { groupShown, rowShown } from "./drawer/grammar.js";
export { rowLines, rowOptions, rowValue } from "./drawer/rows.js";
export { showTab, shownTab } from "./drawer/tabs.js";

/** @typedef {import("./drawer/grammar.js").RowOption} RowOption */
/** @typedef {import("./drawer/grammar.js").RowSpec} RowSpec */
/** @typedef {import("./drawer/grammar.js").FieldOption} FieldOption */
/** @typedef {import("./drawer/grammar.js").FieldSpec} FieldSpec */
/** @typedef {import("./drawer/grammar.js").ChoiceLine} ChoiceLine */
/** @typedef {import("./drawer/grammar.js").ChoiceSpec} ChoiceSpec */
/** @typedef {import("./drawer/grammar.js").GroupItem} GroupItem */
/** @typedef {import("./drawer/grammar.js").BlockItem} BlockItem */
/** @typedef {import("./drawer/grammar.js").IntroPart} IntroPart */
/** @typedef {import("./drawer/grammar.js").BodyItem} BodyItem */
/** @typedef {import("./drawer/grammar.js").DrawerTab} DrawerTab */
/** @typedef {import("./drawer/grammar.js").OwnForm} OwnForm */
/** @typedef {import("./drawer/grammar.js").DrawerSchema} DrawerSchema */
/** @typedef {import("./drawer/rows.js").OptionLine} OptionLine */

/**
 * What a drawer's head shows: the tabs carrying a dirty dot, whether the title carries it, and the apply group's
 * state.
 *
 * @typedef {object} DrawerHead
 * @property {string[]} dirty
 * @property {boolean} titleDot
 * @property {{ shown: boolean, live: boolean }} apply
 */

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

/**
 * A drawer's split button: its own form's apply, else the apply mode's act.
 *
 * @param {DrawerSchema} drawer
 * @returns {Promise<unknown>}
 */
export const applyDrawer = async (drawer) => (drawer.own ? drawer.own.apply() : runApply());

/**
 * A drawer's Discard: its own form's discard, else dropping the staged set.
 *
 * @param {DrawerSchema} drawer
 * @returns {Promise<unknown>}
 */
export const discardDrawer = async (drawer) => (drawer.own ? drawer.own.discard() : discardAll());

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
 * The ids of the dotted tabs, in tab order: those holding a staged restart key, or every tab while the drawer's own
 * form holds edits.
 *
 * @param {DrawerSchema} drawer
 * @returns {string[]}
 */
function dirtyTabs(drawer) {
  if (drawer.own) return drawer.own.staged() ? drawer.tabs.map((t) => t.id) : [];
  return drawer.tabs.filter((t) => tabKeys(t).some((k) => restartLane(k) && isDirty(k))).map((t) => t.id);
}

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
 * What a drawer's head shows with `tabId` open.
 *
 * @param {DrawerSchema} drawer
 * @param {string} tabId
 * @returns {DrawerHead}
 */
export function drawerHead(drawer, tabId) {
  const dirty = dirtyTabs(drawer);
  const tab = drawer.tabs.find((t) => t.id === tabId) ?? drawer.tabs[0];
  const staged = drawer.own ? drawer.own.staged() : isStaged(dirty.length > 0, siblings(drawer));
  const restart = !!drawer.own || shownKeys(drawer, tab).some(restartLane);
  return {
    dirty,
    titleDot: drawer.tabs.length === 1 && dirty.length > 0,
    apply: applyPaint(restart, staged),
  };
}

/** The owner of the questions an Apply asks (store/guards.js). */
const APPLY_OWNER = "pending";

/**
 * The open question this drawer pins under its head: one an Apply asked, or one a key of this drawer asked. Null when
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
