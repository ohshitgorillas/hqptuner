// The faceplate's browser-held preferences: HQPTuner's own choices, persisted
// in localStorage, applied at once, never staged and never sent to the engine.
//   dacType          — Shaping's DAC type row, PCM: "other" or "r2r".
//   dacChip          — Shaping's DAC chip row, SDM: "other" or "ess".
//   topOfPage        — what the page's top section shows: "auto" (the spectrum
//                      over the Matrix section folded to its header line),
//                      "profile" (the Matrix section alone) or "spectrum".
//   bottomBar        — "switcher" (the Setting Switcher) or "none".
//   pageRange        — the page's Source meter Range, dB: "60", "90" or "120",
//                      the spectrum's span and the levels' floor (−range) both.
//   hiddenStages     — the stages hidden from the chain rail, a subset of
//                      HIDEABLE_STAGES, held in that order.
//   allowPinnedRates — the opt-in for pinning an output rate; off by default.
//
// A stored value outside a preference's set reads as that preference's default,
// and a stored hidden stage outside HIDEABLE_STAGES is dropped.
import { signal } from "@preact/signals";

import { enumPref, loadBool, persist, warnStorage } from "./prefs.js";

export const DAC_TYPES = ["other", "r2r"];
export const DAC_CHIPS = ["other", "ess"];
export const TOP_OF_PAGE = ["auto", "profile", "spectrum"];
export const BOTTOM_BARS = ["switcher", "none"];
export const PAGE_RANGES = ["60", "90", "120"];
export const HIDEABLE_STAGES = ["dsd", "speakers", "crossfeed", "loudness", "correction"];

const K_HIDDEN = "hqptuner.hiddenStages";
const K_PINNED = "hqptuner.allowPinnedRates";

export const [dacType, setDacType] = enumPref("hqptuner.dacType", DAC_TYPES, "other");
export const [dacChip, setDacChip] = enumPref("hqptuner.dacChip", DAC_CHIPS, "other");
export const [topOfPage, setTopOfPage] = enumPref("hqptuner.topOfPage", TOP_OF_PAGE, "auto");
export const [bottomBar, setBottomBar] = enumPref("hqptuner.bottomBar", BOTTOM_BARS, "switcher");
export const [pageRange, setPageRange] = enumPref("hqptuner.pageRange", PAGE_RANGES, "90");

/**
 * The strings in a stored JSON list. Unset, junk, a value that is not a list
 * and a storage that cannot be read all read as the empty list, and a member
 * that is not a string is dropped.
 *
 * @param {string} key
 * @returns {string[]}
 */
function loadStrings(key) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    warnStorage("read");
    return [];
  }
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((/** @type {unknown} */ k) => typeof k === "string");
  } catch {
    // A junk value reads as unset, the same way a junk boolean does.
    return [];
  }
}

/**
 * The hideable stages among `stages`, once each, in HIDEABLE_STAGES order.
 *
 * @param {string[]} stages
 * @returns {string[]}
 */
function hideable(stages) {
  return HIDEABLE_STAGES.filter((s) => stages.includes(s));
}

/** @type {{ value: string[] }} */
export const hiddenStages = signal(hideable(loadStrings(K_HIDDEN)));

/**
 * Hide one stage from the chain rail, or show it again, and persist the hidden
 * set. A stage outside HIDEABLE_STAGES is ignored: the signal and the stored
 * value both stand.
 *
 * @param {string} stage
 * @param {boolean} hidden
 * @returns {void}
 */
export function setStageHidden(stage, hidden) {
  if (!HIDEABLE_STAGES.includes(stage)) return;
  const rest = hiddenStages.value.filter((s) => s !== stage);
  hiddenStages.value = hideable(hidden ? [...rest, stage] : rest);
  try {
    localStorage.setItem(K_HIDDEN, JSON.stringify(hiddenStages.value));
  } catch {
    // storage disabled (private mode) — keep the in-memory value
    warnStorage("written");
  }
}

export const allowPinnedRates = signal(loadBool(K_PINNED, false));

/**
 * Set the pinned-rates opt-in and persist it.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setAllowPinnedRates(on) {
  allowPinnedRates.value = !!on;
  persist(K_PINNED, allowPinnedRates.value);
}
