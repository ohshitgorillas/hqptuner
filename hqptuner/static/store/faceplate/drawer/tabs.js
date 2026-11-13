// Which tab a drawer shows. A pick is recorded against the opening it belongs to: the drawer's current opening while it
// is open, its next one while it is closed. A drawer whose schema names the tab it opens on shows a pick only during
// that pick's opening, so a tab picked while open holds until the drawer closes and a pick made while closed is what
// the next opening shows. Any other drawer shows its last pick.

import { effect, signal } from "@preact/signals";
import { openStage } from "../view.js";

/** @typedef {import("./grammar.js").DrawerSchema} DrawerSchema */

/** How many times each drawer has opened, by drawer id. @type {Map<string, number>} */
const openings = new Map();

effect(() => {
  const id = openStage.value;
  if (id) openings.set(id, (openings.get(id) ?? 0) + 1);
});

/**
 * The opening a pick made now belongs to.
 *
 * @param {string} drawerId
 */
const opening = (drawerId) => (openings.get(drawerId) ?? 0) + (openStage.value === drawerId ? 0 : 1);

/** The tab last picked in each drawer and the opening it was picked for, by drawer id. */
const picked = signal(/** @type {Record<string, { tab: string, at: number }>} */ ({}));

/**
 * The tab a drawer shows: its pick, else the tab its schema opens on, else its first.
 *
 * @param {DrawerSchema} drawer
 * @returns {string}
 */
export function shownTab(drawer) {
  const has = (/** @type {string | undefined} */ id) => drawer.tabs.some((t) => t.id === id);
  const pick = picked.value[drawer.id];
  const holds = pick && (!drawer.opensOn || pick.at === opening(drawer.id));
  if (holds && has(pick.tab)) return pick.tab;
  const opens = drawer.opensOn?.();
  return opens !== undefined && has(opens) ? opens : drawer.tabs[0].id;
}

/**
 * Pick a drawer's tab.
 *
 * @param {string} drawerId
 * @param {string} tabId
 */
export function showTab(drawerId, tabId) {
  picked.value = { ...picked.value, [drawerId]: { tab: tabId, at: opening(drawerId) } };
}
