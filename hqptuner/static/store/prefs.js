// Client-only UI prefs: which inline manual text shows. Two layers, persisted in
// localStorage, no daemon involvement.
//   showDescriptions       — master toggle for the static per-control feature
//                            notes (.field-note, incl. the hardware card) AND the
//                            per-selection option descriptions (.field-desc).
//   keepOptionDescriptions — when the master is OFF, still show the filter /
//                            dither / modulator / DSD-source per-selection option
//                            descriptions. Only meaningful while the master is off.
// Derived: notesVisible = master; descVisible = master || keepOptions.
//
// Module load stays node-safe (the SSR harness imports the component graph with
// no localStorage): the storage read is guarded.
import { signal, computed } from "@preact/signals";

const K_DESC = "hqptuner.showDescriptions";
const K_KEEP = "hqptuner.keepOptionDescriptions";
const K_QUICK_SYS = "hqptuner.quickSystemUpdates";
const K_FAST_VOL = "hqptuner.fastVolumeUpdates";
const K_LIVE = "hqptuner.liveMode";

// A dead store is worth exactly one line of console noise: silence hides the
// "prefs never persist" case (notably node/SSR, where every read is a default),
// but warning per key would spam once per pref per session. One flag, one warn.
let storageWarned = false;

/**
 * @param {string} verb
 * @returns {void}
 */
function warnStorage(verb) {
  if (storageWarned) return;
  storageWarned = true;
  if (typeof localStorage === "undefined") {
    console.warn(`hqptuner: no localStorage in this environment — UI prefs are not persisted (${verb} skipped).`);
  } else {
    console.warn(`hqptuner: localStorage unavailable — UI prefs could not be ${verb}; using defaults.`);
  }
}

/**
 * @param {string} key
 * @param {boolean} dflt
 * @returns {boolean}
 */
function loadBool(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v === "1";
  } catch {
    warnStorage("read");
    return dflt;
  }
}

/**
 * @param {string} key
 * @param {boolean} on
 * @returns {void}
 */
function persist(key, on) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // storage disabled (private mode) — keep the in-memory value
    warnStorage("written");
  }
}

export const showDescriptions = signal(loadBool(K_DESC, true));
export const keepOptionDescriptions = signal(loadBool(K_KEEP, true));

/**
 * Set the master inline-manual-text pref and persist it.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setShowDescriptions(on) {
  showDescriptions.value = !!on;
  persist(K_DESC, showDescriptions.value);
}

/**
 * Set whether per-selection option descriptions survive a hidden master, and
 * persist it.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setKeepOptionDescriptions(on) {
  keepOptionDescriptions.value = !!on;
  persist(K_KEEP, keepOptionDescriptions.value);
}

// Faster-poll opt-ins, per page. Off by default (the 2 s default is fine for
// most use); a page's checkbox bumps its status poll to 500 ms while shown.
// Consumed by store/ui.js (fastPollMs).
export const quickSystemUpdates = signal(loadBool(K_QUICK_SYS, false));
export const fastVolumeUpdates = signal(loadBool(K_FAST_VOL, false));

/**
 * Set the System page's faster-poll opt-in and persist it.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setQuickSystemUpdates(on) {
  quickSystemUpdates.value = !!on;
  persist(K_QUICK_SYS, quickSystemUpdates.value);
}

/**
 * Takes a string as well as a boolean. Every UI caller hands it a checkbox's
 * boolean, but the daemon's boolean fields arrive as truthy strings elsewhere
 * in this store, so the coercion is part of what this setter promises.
 *
 * @param {boolean | string} on
 * @returns {void}
 */
export function setFastVolumeUpdates(on) {
  fastVolumeUpdates.value = !!on;
  persist(K_FAST_VOL, fastVolumeUpdates.value);
}

// The LIVE switch. Persisted like every other pref, so a reload lands back on
// the page the user was working from rather than dropping them into the tabs.
export const liveMode = signal(loadBool(K_LIVE, false));

/**
 * Set the LIVE switch and persist it, so a reload lands back on the same page.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setLiveMode(on) {
  liveMode.value = !!on;
  persist(K_LIVE, liveMode.value);
}

// Static feature notes follow the master only.
export const notesVisible = computed(() => showDescriptions.value);
// Per-selection option descriptions survive a hidden master when kept.
export const descVisible = computed(() => showDescriptions.value || keepOptionDescriptions.value);
