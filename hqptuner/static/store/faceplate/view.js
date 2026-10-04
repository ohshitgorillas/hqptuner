// What the faceplate shows: the window it is fitted to, which body is on the plate, which stage's drawer is open, which
// option list is open over the body and which popover is open. One drawer, one list and one popover at a time. The
// gear and the builders swap the whole body; the header, the engine row and the bottom bar stay.

import { signal, computed } from "@preact/signals";
import { plateFit } from "../../model/shell/plate.js";
import { setupOpen, closeSetup } from "../setup.js";

/** @typedef {"chain" | "settings" | "snapshots" | "station" | "profile"} Body */

/**
 * An option list as a chain picker opens it: the catalog key whose list shows, the stage narrowing reads, the value
 * running in that field, and what a pick does with the option value picked.
 *
 * @typedef {object} ListRequest
 * @property {string} key
 * @property {"1x" | "nx"} stage
 * @property {string} value
 * @property {(value: string) => unknown} pick
 */

/** The window's inner size, CSS px. The entry writes it at load and on every resize. */
export const viewport = signal({ w: 1080, h: 810 });

/** The plate's size and scale for the window. */
export const plate = computed(() => plateFit(viewport.value));

/** The body on the plate. @type {{ value: Body }} */
export const body = signal(/** @type {Body} */ ("chain"));

/** The rail stage whose drawer is open, or null. @type {{ value: string | null }} */
export const openStage = signal(/** @type {string | null} */ (null));

/** The open popover's id, or null. @type {{ value: string | null }} */
export const openPopover = signal(/** @type {string | null} */ (null));

/** The option list open over the body, or null. @type {{ value: ListRequest | null }} */
export const openList = signal(/** @type {ListRequest | null} */ (null));

/**
 * Swap the body: the one picked, or back to the chain when it already shows. The open drawer and popover close.
 *
 * @param {Body} name
 */
export function showBody(name) {
  body.value = body.value === name ? "chain" : name;
  openStage.value = null;
  openList.value = null;
  openPopover.value = null;
}

/**
 * A rail stage's tap: its drawer opens in place of any other, or closes when it is the open one.
 *
 * @param {string} id
 */
export function toggleStage(id) {
  openStage.value = openStage.value === id ? null : id;
  openList.value = null;
  openPopover.value = null;
}

/**
 * A chain picker's tap: its list opens over the body, refilled from any other picker's, or closes when it is the one
 * already open. A popover over the list closes with it.
 *
 * @param {ListRequest} req
 */
export function openOptionList(req) {
  openList.value = openList.value?.key === req.key ? null : req;
  openPopover.value = null;
}

/**
 * A popover trigger's tap: its popover opens in place of any other, or closes when it is the open one.
 *
 * @param {string} id
 */
export function togglePopover(id) {
  openPopover.value = openPopover.value === id ? null : id;
}

/**
 * Escape: the open popover closes; with none open, the open connection panel does; with neither, the open list does;
 * then the open drawer; with nothing open, the body returns to the chain.
 */
export function closeTop() {
  if (openPopover.value !== null) openPopover.value = null;
  else if (setupOpen.value) closeSetup();
  else if (openList.value !== null) openList.value = null;
  else if (openStage.value !== null) openStage.value = null;
  else body.value = "chain";
}

/**
 * A click anywhere on the document: the open popover closes unless the click landed in a popover or on its trigger,
 * each of which carries `data-pop`. A target that left the document mid-click belonged to something that re-rendered.
 *
 * @param {{ closest: (selector: string) => unknown, isConnected: boolean }} target
 */
export function closeOutside(target) {
  if (openPopover.value !== null && target.isConnected && !target.closest("[data-pop]")) openPopover.value = null;
}
