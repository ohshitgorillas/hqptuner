// The open option list's store half beside view.js's `openList`: which kind of list a catalog key opens (filters fill a
// sheet over the body, the shapers and the DSD processing lists open as a panel at their picker), whether that kind
// carries a narrowing console and favorites, the pick that hands a row's engine name to the picker and closes the list,
// and which row the hover tip is showing.

import { signal } from "@preact/signals";
import { openList, openPopover } from "../view.js";

/** The favorites set, the group copy and the console a list reads. @typedef {"filters" | "modulators" | "dithers" | "dsd"} ListKind */

/** The DSD processing drawer's keys that open a list. */
const DSD_KEYS = new Set(["pcm_conversion", "sdm_conversion", "sdm_integrator", "noise_filter"]);

/**
 * The kind of list a catalog key opens: the modulator's and the dither's are their own, the DSD processing keys' a DSD
 * list, every filter key's a filter list.
 *
 * @param {string} key
 * @returns {ListKind}
 */
export function kindOf(key) {
  if (DSD_KEYS.has(key)) return "dsd";
  if (key.endsWith("_modulator")) return "modulators";
  return key.endsWith("_dither") ? "dithers" : "filters";
}

/**
 * Whether a kind of list carries a narrowing console in its head.
 *
 * @param {ListKind} kind
 * @returns {boolean}
 */
export const hasConsole = (kind) => kind !== "dsd";

/**
 * Whether a kind of list stars its rows as favorites.
 *
 * @param {ListKind} kind
 * @returns {boolean}
 */
export const hasFavorites = (kind) => kind === "filters" || kind === "modulators";

/**
 * Whether a kind of list opens as a panel parked at its picker rather than a sheet over the body.
 *
 * @param {ListKind} kind
 * @returns {boolean}
 */
export const isPanel = (kind) => kind !== "filters";

/** The engine name of the row the hover tip shows, or null. @type {{ value: string | null }} */
export const hoverTip = signal(/** @type {string | null} */ (null));

/**
 * Show the tip for a row.
 *
 * @param {string} v  the row's engine name
 */
export function showTip(v) {
  hoverTip.value = v;
}

/**
 * Hide the tip: always with no row named, else only while it shows that row.
 *
 * @param {string} [v]
 */
export function hideTip(v) {
  if (v === undefined || hoverTip.value === v) hoverTip.value = null;
}

/** Close the open list, the tip and any popover opened over it. */
export function closeOptionList() {
  openList.value = null;
  openPopover.value = null;
  hoverTip.value = null;
}

/**
 * A row's tap: the picker hears the engine name picked, then the list closes.
 *
 * @param {string} v
 */
export function pickFromList(v) {
  const req = openList.value;
  closeOptionList();
  req?.pick(v);
}
