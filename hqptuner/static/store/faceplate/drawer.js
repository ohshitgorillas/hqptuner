// The stage drawer's store half: what a drawer drawn from its schema decides over the staged store. Which tabs carry a
// dirty dot, whether the title carries it, whether the drawer's rail stage carries the staged mark, whether the apply
// group shows and whether its buttons are live, which tab is shown, which open question the drawer pins under its head,
// the options, value and option lines a row's control renders, and the apply mode the head's split button runs. The DOM
// half is components/faceplate/drawer/; the schema grammar is drawer/grammar.js.
//
// Members of one `family` share their staged state: any member's staged edit lights every
// member's apply group. A family is declared once (`FAMILIES`): the rail stages its members draw and the catalog keys they hold,
// so the store knows it with no drawer loaded. A drawer with its own form (`own`) stands that form in for the staged
// set: its staged state dots every tab, its apply group always shows, and Apply and Discard run the form.
//
// The apply mode is a browser-held preference, one choice for every drawer: `apply` applies the staged set, `save`
// applies it and saves it into the loaded station.

import { computed } from "@preact/signals";
import { applyPaint, isStaged } from "../../model/shell/drawer.js";
import { field } from "../core/readings.js";
import { activePreset, isDirty } from "../resolve.js";
import { applyAll, discardAll } from "../actions.js";
import { question } from "../ask.js";
import { enumPref } from "../ui/prefs.js";
import { openPopover } from "./view.js";
import { shownKeys, tabKeys } from "./drawer/grammar.js";

export { groupShown, rowShown } from "./drawer/grammar.js";
export { drawerPick, drawerPlate, rowLines, rowOptions, rowValue } from "./drawer/rows.js";
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
/** @typedef {import("./drawer/grammar.js").NoteLine} NoteLine */
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

/**
 * One drawer family: the rail stages whose drawers declare it, and the catalog keys those drawers hold.
 *
 * @typedef {object} Family
 * @property {readonly string[]} stages
 * @property {readonly string[]} keys
 */

/**
 * The drawer families, by name.
 *
 * @type {Readonly<Record<string, Family>>}
 */
const FAMILIES = {
  matrix: {
    stages: ["matrix", "pipelines", "crossfeed", "loudness", "correction"],
    keys: [
      "matrix_enabled",
      "matrix_expand_hf",
      "matrix_engine",
      "matrix_iir2fir",
      "matrix_pipelines",
      "pipelines",
      "crossfeed_enabled",
      "crossfeed_preset",
      "crossfeed_frequency",
      "crossfeed_level",
      "loudness_enabled",
      "loudness_low_type",
      "loudness_low_freq",
      "loudness_low_steep",
      "loudness_low_level",
      "loudness_high_type",
      "loudness_high_freq",
      "loudness_high_steep",
      "loudness_high_level",
      "loudness_range_low",
      "loudness_range_high",
      "dac_correction_enabled",
      "dac_correction_profile",
    ],
  },
};

/**
 * The catalog keys each family's members hold, by family: a staged edit to any of them lights the apply group of every
 * drawer declaring that family.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const FAMILY_KEYS = Object.fromEntries(Object.entries(FAMILIES).map(([name, f]) => [name, f.keys]));

/** The rail stages whose drawers are matrix family members: the matrix engine's part of the chain. */
export const MATRIX_STAGES = FAMILIES.matrix.stages;

/**
 * Whether applying a field restarts the engine.
 *
 * @param {string} key
 * @returns {boolean}
 */
export const restartLane = (key) => field(key).value.restart;

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
 * Whether a drawer holds a staged edit of either lane: its own form's, else a key of its tabs that `counts` passes,
 * every key without it.
 *
 * @param {DrawerSchema} drawer
 * @param {(key: string) => boolean} [counts]
 * @returns {boolean}
 */
const holdsStaged = (drawer, counts = () => true) =>
  drawer.own ? drawer.own.staged() : drawer.tabs.some((t) => tabKeys(t).some((k) => isDirty(k) && counts(k)));

/**
 * Whether a drawer's rail stage carries the staged mark: it holds a staged edit its `marks` counts. Its family's other
 * members' edits never count.
 *
 * @param {DrawerSchema} drawer
 * @returns {boolean}
 */
export const stageMarked = (drawer) => holdsStaged(drawer, drawer.marks);

/**
 * A drawer's family as the staged test reads it: none, or one holding a staged edit while any of its keys is staged.
 *
 * @param {DrawerSchema} drawer
 * @returns {{ hasDirty: () => boolean }[]}
 */
function family(drawer) {
  const keys = drawer.family ? FAMILY_KEYS[drawer.family] : undefined;
  return keys ? [{ hasDirty: () => keys.some((k) => isDirty(k)) }] : [];
}

/**
 * Whether a drawer's own form restarts the engine on apply, which marks the head of every control the form applies.
 * Every own form does; a drawer without one restarts only by its keys' lanes.
 *
 * @param {DrawerSchema} drawer
 */
export const formRestarts = (drawer) => !!drawer.own;

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
  const staged = drawer.own ? drawer.own.staged() : isStaged(holdsStaged(drawer), family(drawer));
  const restart = formRestarts(drawer) || shownKeys(drawer, tab).some(restartLane);
  return {
    dirty,
    titleDot: drawer.tabs.length === 1 && dirty.length > 0,
    apply: applyPaint(restart, staged),
  };
}

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
