// The filter primer's VIEW state: whether the primer is on screen instead of the
// filter cards. The third face the filter half of a page can show, beside the
// filter cards and the Easy Mode card (store/easyview.js), and the same kind of
// swap: nothing here touches a field or the daemon.
//
// Unlike Easy Mode it is NOT remembered. A primer is read once and left, and a
// page that reopened it on every load would be a page element rather than an
// answer to a question — the same reasoning as easyview.js's help panel.
//
// While the primer is being built nothing in the UI points at it, so the one way
// in is the `#primer` hash. Module load stays node-safe (the SSR harness imports
// the component graph with no `location`), so the hash is read only where one
// exists and the flag otherwise starts down.
import { signal } from "@preact/signals";

const HASH = "#primer";

/** @returns {boolean} */
function hashOpen() {
  return typeof location !== "undefined" && location.hash === HASH;
}

/** Whether the filter primer is showing in place of the filter cards. */
export const primerOpen = signal(hashOpen());

/**
 * Show or hide the primer. Not remembered: the next load starts on the filter
 * cards whatever this session was looking at.
 * @param {boolean} on
 * @returns {void}
 */
export function setPrimerOpen(on) {
  primerOpen.value = !!on;
}

if (typeof addEventListener === "function") {
  addEventListener("hashchange", () => setPrimerOpen(hashOpen()));
}
