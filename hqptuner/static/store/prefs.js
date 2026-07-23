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

// A dead store is worth exactly one line of console noise: silence hides the
// "prefs never persist" case (notably node/SSR, where every read is a default),
// but warning per key would spam once per pref per session. One flag, one warn.
let storageWarned = false;

function warnStorage(verb) {
  if (storageWarned) return;
  storageWarned = true;
  if (typeof localStorage === "undefined") {
    console.warn(`hqptuner: no localStorage in this environment — UI prefs are not persisted (${verb} skipped).`);
  } else {
    console.warn(`hqptuner: localStorage unavailable — UI prefs could not be ${verb}; using defaults.`);
  }
}

function loadBool(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v === "1";
  } catch {
    warnStorage("read");
    return dflt;
  }
}

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

export function setShowDescriptions(on) {
  showDescriptions.value = !!on;
  persist(K_DESC, showDescriptions.value);
}

export function setKeepOptionDescriptions(on) {
  keepOptionDescriptions.value = !!on;
  persist(K_KEEP, keepOptionDescriptions.value);
}

// Faster-poll opt-ins, per page. Off by default (the 2 s default is fine for
// most use); a page's checkbox bumps its status poll to 500 ms while shown.
// Consumed by store/ui.js (fastPollMs).
export const quickSystemUpdates = signal(loadBool(K_QUICK_SYS, false));
export const fastVolumeUpdates = signal(loadBool(K_FAST_VOL, false));

export function setQuickSystemUpdates(on) {
  quickSystemUpdates.value = !!on;
  persist(K_QUICK_SYS, quickSystemUpdates.value);
}

export function setFastVolumeUpdates(on) {
  fastVolumeUpdates.value = !!on;
  persist(K_FAST_VOL, fastVolumeUpdates.value);
}

// Static feature notes follow the master only.
export const notesVisible = computed(() => showDescriptions.value);
// Per-selection option descriptions survive a hidden master when kept.
export const descVisible = computed(() => showDescriptions.value || keepOptionDescriptions.value);
