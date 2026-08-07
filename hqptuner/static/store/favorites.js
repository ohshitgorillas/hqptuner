// Favorite filters — client-only curation, persisted per browser. Keyed by
// filter NAME, not enum id: the running engine owns ids and ordering, names are
// the stable join key (architecture §2), so one list serves all four filter
// dropdowns (pcm/sdm × 1x/nx) and survives re-enumeration.
//
// The favorites-only narrowing switch lives HERE beside the set (narrowing.js
// re-exports it): removing the last star must turn the switch off — the narrow
// bar grays the toggle at zero favorites, and a grayed control must not hold an
// engaged state — and keeping both in one module does that without an import
// cycle.
//
// Module load stays node-safe like prefs.js: storage reads are guarded, and a
// dead store is worth exactly one line of console noise.
import { signal } from "@preact/signals";

const KEY = "hqptuner.favoriteFilters";

let storageWarned = false;

/**
 * @param {string} verb
 * @returns {void}
 */
function warnStorage(verb) {
  if (storageWarned) return;
  storageWarned = true;
  if (typeof localStorage === "undefined") {
    console.warn(`hqptuner: no localStorage in this environment — favorites are not persisted (${verb} skipped).`);
  } else {
    console.warn(`hqptuner: localStorage unavailable — favorites could not be ${verb}; starting empty.`);
  }
}

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    warnStorage("read");
    return new Set();
  }
}

/**
 * @param {Set<string>} set
 * @returns {void}
 */
function persist(set) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    warnStorage("written");
  }
}

export const favoriteFilters = signal(load());
export const nFavOnly = signal(false);

/**
 * Whether a filter name is starred.
 * @param {string} name
 * @returns {boolean}
 */
export function isFavorite(name) {
  return favoriteFilters.value.has(name);
}

/**
 * Star or unstar a filter name and persist the set, turning the favorites-only switch
 * off when the last star goes.
 * @param {string} name
 * @returns {void}
 */
export function toggleFavorite(name) {
  const next = new Set(favoriteFilters.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  favoriteFilters.value = next;
  if (!next.size) nFavOnly.value = false;
  persist(next);
}
