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

// The System page's faster-poll opt-in. Off by default (the 2 s default is fine
// for diagnostic readings); ticked, its status poll runs at 1 s while the page
// is shown. Consumed by store/ui.js (fastPollMs). The volume page and LIVE take
// that cadence unconditionally and have no pref of their own.
export const quickSystemUpdates = signal(loadBool(K_QUICK_SYS, false));

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

// LIVE page card disclosure. Four cards on that page collapse so the page can be
// cut down to the controls in use: with Narrow filters, Playback and Engine
// health folded away, the output mode switch and the matrix profile picker sit
// on one screen and switching between them costs no scrolling. Open by default —
// a first visit shows the whole page — and persisted per card, because a
// cut-down page that reverts on reload is not cut down.
const K_LIVE_CARD = {
  narrow: "hqptuner.liveCollapse.narrow",
  playback: "hqptuner.liveCollapse.playback",
  health: "hqptuner.liveCollapse.health",
  matrix: "hqptuner.liveCollapse.matrix",
};

export const liveNarrowOpen = signal(loadBool(K_LIVE_CARD.narrow, true));
export const livePlaybackOpen = signal(loadBool(K_LIVE_CARD.playback, true));
export const liveHealthOpen = signal(loadBool(K_LIVE_CARD.health, true));
export const liveMatrixOpen = signal(loadBool(K_LIVE_CARD.matrix, true));

const LIVE_CARD_SIGNAL = {
  narrow: liveNarrowOpen,
  playback: livePlaybackOpen,
  health: liveHealthOpen,
  matrix: liveMatrixOpen,
};

/**
 * Set one LIVE card's disclosure and persist it.
 *
 * @param {"narrow" | "playback" | "health" | "matrix"} card
 * @param {boolean} open
 * @returns {void}
 */
export function setLiveCardOpen(card, open) {
  const sig = LIVE_CARD_SIGNAL[card];
  sig.value = !!open;
  persist(K_LIVE_CARD[card], sig.value);
}

// Static feature notes follow the master only.
export const notesVisible = computed(() => showDescriptions.value);
// Per-selection option descriptions survive a hidden master when kept.
export const descVisible = computed(() => showDescriptions.value || keepOptionDescriptions.value);
