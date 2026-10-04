// What the faceplate shows: the window it is fitted to, which body is on the plate, which stage's drawer is open and
// which popover is open. One drawer and one popover at a time. The gear and the builders swap the whole body; the
// header, the engine row and the bottom bar stay.

import { signal, computed } from "@preact/signals";
import { plateFit } from "../../model/shell/plate.js";

/** @typedef {"chain" | "settings" | "snapshots" | "station"} Body */

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

/**
 * Swap the body: the one picked, or back to the chain when it already shows. The open drawer and popover close.
 *
 * @param {Body} name
 */
export function showBody(name) {
  body.value = body.value === name ? "chain" : name;
  openStage.value = null;
  openPopover.value = null;
}

/**
 * A rail stage's tap: its drawer opens in place of any other, or closes when it is the open one.
 *
 * @param {string} id
 */
export function toggleStage(id) {
  openStage.value = openStage.value === id ? null : id;
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

/** Escape: the open popover closes; with none open, the open drawer does. */
export function closeTop() {
  if (openPopover.value !== null) openPopover.value = null;
  else openStage.value = null;
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
