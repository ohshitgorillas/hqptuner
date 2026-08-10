// Favorite filters — the stars the user put on filter names, stored for the
// install and shared by every browser pointed at it. Keyed by filter NAME, not
// enum id: the running engine owns ids and ordering, names are the stable join
// key (architecture §2), so one list serves all four filter dropdowns (pcm/sdm ×
// 1x/nx) and survives re-enumeration.
//
// The server is the only store. A toggle writes the whole resulting set to
// PUT /api/favorites — unstarring is a write without the name, so there is no
// second route and two browsers racing is last-write-wins. Nothing polls: a tab
// picks up another tab's stars on reload, the same way the LIVE page re-reads
// its presets when it opens.
//
// Stars applied optimistically. The star is the user's own click and the round
// trip is a LAN hop; making them wait for it to light up would make the control
// feel broken far more often than the write actually fails. A failure puts the
// set back and says so under the dropdown.
//
// The favorites-only narrowing switch lives HERE beside the set (narrowing.js
// re-exports it): removing the last star must turn the switch off — the narrow
// bar grays the toggle at zero favorites, and a grayed control must not hold an
// engaged state — and keeping both in one module does that without an import
// cycle. It is session state, never persisted anywhere.
//
// Module load stays node-safe like prefs.js: the hydrate is guarded on `fetch`
// existing and swallows its own failure, so importing this in the SSR harness
// neither throws nor leaves a rejected promise behind.
import { signal } from "@preact/signals";
import { api } from "../lib/api.js";
import { errText } from "../lib/errtext.js";

// The pre-server store. Read exactly once, by the migration below, so stars set
// before favorites moved to the server survive the move.
const LEGACY_KEY = "hqptuner.favoriteFilters";

export const favoriteFilters = signal(new Set());
export const nFavOnly = signal(false);
// The last failed write, as the server's own sentence. One error for the whole
// feature, latest wins: there is one set, and a second toggle clears whatever
// the first left behind.
export const favoritesError = signal("");

/**
 * The names left in localStorage by a pre-server HQPTuner, empty when there are
 * none or the store is unavailable.
 * @returns {string[]}
 */
function legacyNames() {
  try {
    const v = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "string" && n) : [];
  } catch {
    return [];
  }
}

/** @returns {void} */
function dropLegacy() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // A store we cannot clear is a store the next hydrate reads again — harmless,
    // because the server is non-empty by then and the migration no longer runs.
  }
}

/**
 * Fill the set from the server, migrating this browser's leftover localStorage
 * stars up on the way if the server has none. Never throws: an unreachable
 * backend leaves the set empty, which is what the page can honestly show.
 * @returns {Promise<void>}
 */
export async function hydrateFavorites() {
  try {
    const body = await api.favorites();
    const stored = body.filters || [];
    if (stored.length) {
      favoriteFilters.value = new Set(stored);
      return;
    }
    const legacy = legacyNames();
    if (!legacy.length) return;
    favoriteFilters.value = new Set(legacy);
    const saved = await api.saveFavorites([...favoriteFilters.value]);
    favoriteFilters.value = new Set(saved.filters || []);
    dropLegacy();
  } catch (e) {
    favoritesError.value = errText(e);
  }
}

/**
 * Whether a filter name is starred.
 * @param {string} name
 * @returns {boolean}
 */
export function isFavorite(name) {
  return favoriteFilters.value.has(name);
}

/**
 * Star or unstar a filter name and store the resulting set, turning the
 * favorites-only switch off when the last star goes. A refused write puts the
 * set back the way it was and leaves the server's sentence in `favoritesError`.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function toggleFavorite(name) {
  const before = favoriteFilters.value;
  const next = new Set(before);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  favoriteFilters.value = next;
  if (!next.size) nFavOnly.value = false;
  favoritesError.value = "";
  try {
    await api.saveFavorites([...next]);
  } catch (e) {
    favoriteFilters.value = before;
    if (!before.size) nFavOnly.value = false;
    favoritesError.value = errText(e);
  }
}

// Read the set once, at load. Guarded on `fetch` because this module is imported
// by the SSR harness, where there is no backend to ask and no failure to report.
if (typeof fetch === "function") void hydrateFavorites();
