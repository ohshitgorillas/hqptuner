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
const K_KNOBS = "hqptuner.easyKnobs";

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

// Where each preset's knobs were left. A tile's knob positions are otherwise
// readable only while that tile is the lit one, because they are derived from
// the filter values every render — press a different tile and the one you left
// matches nothing, so it has nothing to show and falls back to its defaults.
// That loses a position the user set, which is what this remembers.
//
// Only DARK tiles read it. The lit tile still shows what the fields carry, so a
// filter changed by hand in a chain card still wins over anything stored here.
/**
 * Parse the stored record, discarding anything that is not a map of maps of
 * strings — a hand-edited or half-written entry leaves the store empty rather
 * than seeding a tile with a position no knob has.
 *
 * @returns {Record<string, Record<string, string>>}
 */
function readKnobs() {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  let raw;
  try {
    raw = JSON.parse(read(K_KNOBS) || "");
  } catch {
    return out; // nothing stored, or not JSON — every tile starts at its defaults
  }
  if (raw === null || typeof raw !== "object") return out;
  for (const [slot, positions] of Object.entries(raw)) {
    if (positions === null || typeof positions !== "object") continue;
    /** @type {Record<string, string>} */
    const kept = {};
    for (const [knob, at] of Object.entries(positions)) if (typeof at === "string") kept[knob] = at;
    out[slot] = kept;
  }
  return out;
}

/**
 * One preset's slot in the record. Keyed by grid AND preset, so the two grids'
 * presets of the same name keep their own positions.
 *
 * @param {string} grid
 * @param {string} presetId
 * @returns {string}
 */
const slot = (grid, presetId) => `${grid}/${presetId}`;

/** Where each preset's knobs were last set, by grid and preset id. */
export const easyKnobs = signal(readKnobs());

/**
 * Remember where a preset's knobs were set, so its tile shows them again once it goes dark.
 *
 * @param {string} grid
 * @param {string} presetId
 * @param {Record<string, string>} knobs
 * @returns {void}
 */
export function rememberKnobs(grid, presetId, knobs) {
  easyKnobs.value = { ...easyKnobs.value, [slot(grid, presetId)]: { ...knobs } };
  write(K_KNOBS, JSON.stringify(easyKnobs.value));
}

/**
 * Where a preset's knobs were last set — empty when it has never been set.
 *
 * @param {string} grid
 * @param {string} presetId
 * @returns {Record<string, string>}
 */
export function knobsFor(grid, presetId) {
  return easyKnobs.value[slot(grid, presetId)] || {};
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
