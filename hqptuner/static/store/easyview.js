// Easy Mode's VIEW state: whether the Easy Mode card is on screen instead of the
// filter cards, and which of its two grids is showing. Nothing here touches a
// field or the daemon — a tile click is an ordinary staged edit, and this module
// only decides what the user is looking at while they make it.
//
// Both facts belong to the BROWSER, not to a preset: which face of the filter
// controls someone prefers is a property of the person, not of the configuration
// they are editing. That is the difference from store/matrix/mode.js, whose
// speakers/headphones choice is stored per preset on the server and only falls
// back to localStorage. Here localStorage is the whole store.
//
// Module load stays node-safe (the SSR harness imports the component graph with
// no localStorage), so every read and write is guarded and a dead store simply
// leaves the in-memory signal driving the session.
import { signal } from "@preact/signals";

const K_MODE = "hqptuner.easyMode";
const K_GRID = "hqptuner.easyGrid";

/**
 * @param {string} key
 * @returns {string | null}
 */
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage disabled — the default stands for this session
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage disabled — the in-memory value drives the session */
  }
}

/** Whether the Easy Mode card is showing in place of the filter cards. */
export const easyMode = signal(read(K_MODE) === "1");

/** Which grid the Easy Mode card is showing: "album" or "playlist". */
export const easyGrid = signal(read(K_GRID) === "playlist" ? "playlist" : "album");

/**
 * Show or hide the Easy Mode card, and remember which for next time.
 * @param {boolean} on
 * @returns {void}
 */
export function setEasyMode(on) {
  easyMode.value = !!on;
  write(K_MODE, easyMode.value ? "1" : "0");
}

// An unrecognized grid leaves the switcher where it is rather than falling back
// to a default: the caller named something this card cannot show, and dropping
// the user onto Album for it would read as the click having done something.
/**
 * Switch the Easy Mode card's grid, and remember which for next time.
 * @param {string} next "album" | "playlist"
 * @returns {void}
 */
export function setEasyGrid(next) {
  if (next !== "album" && next !== "playlist") return;
  easyGrid.value = next;
  write(K_GRID, next);
}
