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
const K_SIMPLE = "hqptuner.plainNames";
const K_LIVE = "hqptuner.liveMode";
const K_APOD_WINDOW = "hqptuner.apodWindow";
const K_APOD_LIGHT = "hqptuner.apodLight";

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

// The "Option style" switch: Simplified re-renders the six chain dropdowns
// (filters, dither, modulator) with the plain-English names from the
// plain-names overlay (store/plainnames.js). Standard — the raw engine names —
// is the default and what an unset or unavailable storage reads as.
export const plainNames = signal(loadBool(K_SIMPLE, false));

/**
 * Set the "Option style" pref (true = Simplified) and persist it.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setPlainNames(on) {
  plainNames.value = !!on;
  persist(K_SIMPLE, plainNames.value);
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

// The header's apodizing indicator. Off by default: it is a monitor for a
// question most listening does not ask, and an indicator nobody switched on has
// no business flashing in the chrome. Consumed by components/ApodLamp.js.
export const apodLight = signal(loadBool(K_APOD_LIGHT, false));

/**
 * Set the header apodizing indicator's opt-in and persist it.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setApodLight(on) {
  apodLight.value = !!on;
  persist(K_APOD_LIGHT, apodLight.value);
}

// Time window of the Engine health card's apodizing-events density strip: how
// much recent playback the strip covers, in seconds, or "all" for the whole
// current track. An unset or junk value reads as the 60 s default.
export const APOD_WINDOWS = ["30", "60", "120", "300", "all"];

/**
 * @param {string} key
 * @param {string} dflt
 * @returns {string}
 */
function loadApodWindow(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v != null && APOD_WINDOWS.includes(v) ? v : dflt;
  } catch {
    warnStorage("read");
    return dflt;
  }
}

export const apodWindow = signal(loadApodWindow(K_APOD_WINDOW, "60"));

/**
 * Set the apodizing-strip time window and persist it. A value outside
 * APOD_WINDOWS is ignored: the signal and the stored value both stand.
 *
 * @param {string} value
 * @returns {void}
 */
export function setApodWindow(value) {
  if (!APOD_WINDOWS.includes(value)) return;
  apodWindow.value = value;
  try {
    localStorage.setItem(K_APOD_WINDOW, value);
  } catch {
    // storage disabled (private mode) — keep the in-memory value
    warnStorage("written");
  }
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

// The LIVE page's block order. The page is six stacked blocks; the first, LIVE
// MODE, is locked, and the other five are the user's to arrange. Stored as a
// JSON list of block keys rather than an index per block so that a release
// which adds or drops a block reconciles rather than strands: an unknown key is
// dropped and a missing one is appended in default order, both on load and on
// every set, so the stored list can never render a block off the page.
const K_LIVE_ORDER = "hqptuner.liveOrder";

/** Default top-to-bottom order of the five movable LIVE blocks. */
export const LIVE_BLOCK_ORDER = ["hero", "health", "chains", "playback", "matrix"];

/**
 * @param {string[]} keys
 * @returns {string[]}
 */
function reconcileOrder(keys) {
  const known = keys.filter((k) => LIVE_BLOCK_ORDER.includes(k));
  return [...known, ...LIVE_BLOCK_ORDER.filter((k) => !known.includes(k))];
}

/** @returns {string[]} */
function loadOrder() {
  let raw = null;
  try {
    raw = localStorage.getItem(K_LIVE_ORDER);
  } catch {
    warnStorage("read");
    return [...LIVE_BLOCK_ORDER];
  }
  if (raw == null) return [...LIVE_BLOCK_ORDER];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...LIVE_BLOCK_ORDER];
    return reconcileOrder(parsed.filter((/** @type {unknown} */ k) => typeof k === "string"));
  } catch {
    // A junk value reads as unset, the same way a junk boolean does.
    return [...LIVE_BLOCK_ORDER];
  }
}

export const liveOrder = signal(loadOrder());

/**
 * Set the LIVE block order, reconciled against the default. Does not persist —
 * the order is written once, when the user leaves layout-edit mode.
 *
 * @param {string[]} keys
 * @returns {void}
 */
export function setLiveOrder(keys) {
  liveOrder.value = reconcileOrder(keys.filter((k) => typeof k === "string"));
}

/**
 * Persist the current LIVE block order.
 *
 * @returns {void}
 */
export function commitLiveOrder() {
  try {
    localStorage.setItem(K_LIVE_ORDER, JSON.stringify(liveOrder.value));
  } catch {
    warnStorage("written");
  }
}

// Collapsed dropdown groups (Simplified option style). One JSON list of
// "<kind>|<family>" and "<kind>|<family>|<variant>" keys; a key's absence
// means expanded, so a fresh profile opens every group. Keyed per kind, not
// per control, so the PCM and SDM filter dropdowns share one fold.
const K_DD_COLLAPSED = "hqptuner.collapsedGroups";

/** @returns {Record<string, true>} */
function loadCollapsed() {
  let raw = null;
  try {
    raw = localStorage.getItem(K_DD_COLLAPSED);
  } catch {
    warnStorage("read");
    return {};
  }
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    /** @type {Record<string, true>} */
    const map = {};
    for (const k of parsed) {
      if (typeof k === "string") map[k] = true;
    }
    return map;
  } catch {
    // A junk value reads as unset, the same way a junk boolean does.
    return {};
  }
}

export const collapsedGroups = signal(loadCollapsed());

/**
 * Toggle one dropdown group's disclosure and persist the collapsed set.
 *
 * @param {string} key "<kind>|<family>" or "<kind>|<family>|<variant>"
 * @returns {void}
 */
export function toggleCollapsedGroup(key) {
  /** @type {Record<string, true>} */
  const next = { ...collapsedGroups.value };
  if (next[key]) delete next[key];
  else next[key] = true;
  collapsedGroups.value = next;
  try {
    localStorage.setItem(K_DD_COLLAPSED, JSON.stringify(Object.keys(next)));
  } catch {
    warnStorage("written");
  }
}
