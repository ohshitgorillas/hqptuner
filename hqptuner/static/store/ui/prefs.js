// Client-only UI prefs, persisted in localStorage, no daemon involvement.
//
// Module load stays node-safe (the SSR harness imports the component graph with
// no localStorage): the storage read is guarded.
import { signal } from "@preact/signals";

const K_SPECTRUM_STYLE = "hqptuner.spectrumStyle";
const K_SIMPLE = "hqptuner.plainNames";
const K_APOD_WINDOW = "hqptuner.apodWindow";
const K_APOD_LIGHT = "hqptuner.apodLight";
const K_METER_FLOOR = "hqptuner.meterFloor";
const K_METER_CHANNEL = "hqptuner.meterChannel";
const K_METER_RANGE = "hqptuner.meterRange";

// A dead store is worth exactly one line of console noise: silence hides the
// "prefs never persist" case (notably node/SSR, where every read is a default),
// but warning per key would spam once per pref per session. One flag, one warn.
let storageWarned = false;

/** Warn once, for the whole page, that storage cannot be used.
 * @param {string} verb
 * @returns {void}
 */
export function warnStorage(verb) {
  if (storageWarned) return;
  storageWarned = true;
  if (typeof localStorage === "undefined") {
    console.warn(`hqptuner: no localStorage in this environment — UI prefs are not persisted (${verb} skipped).`);
  } else {
    console.warn(`hqptuner: localStorage unavailable — UI prefs could not be ${verb}; using defaults.`);
  }
}

/** A stored boolean, or `dflt` where nothing is stored.
 * @param {string} key
 * @param {boolean} dflt
 * @returns {boolean}
 */
export function loadBool(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v === "1";
  } catch {
    warnStorage("read");
    return dflt;
  }
}

/** Store a boolean as "1" or "0".
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

// The "Option style" switch: Simplified re-renders the six chain dropdowns
// (filters, dither, modulator) with the plain-English names from the
// plain-names overlay (store/plainnames.js). Simplified is the default and what
// an unset or unavailable storage reads as; Standard shows the raw engine names.
export const plainNames = signal(loadBool(K_SIMPLE, true));

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

// The header's apodizing indicator, in three states: dark, lit by every
// apodizing event, or lit only by what the running filter left uncorrected.
// Off by default: it is a monitor for a question most listening does not ask,
// and an indicator nobody switched on has no business flashing in the chrome.
// components/widgets/ApodLamp.js chooses its lit state by this list's index.
const APOD_LIGHT_MODES = ["off", "all", "uncorrected"];

// An existing install may hold persist()'s boolean "1" or "0" on this key. "1"
// is the lamp on for every event, which is "all"; everything else, junk and unset
// included, is the default.
/**
 * @param {string} key
 * @returns {string}
 */
function loadApodLight(key) {
  try {
    const v = localStorage.getItem(key);
    if (v === "1") return "all";
    return v != null && APOD_LIGHT_MODES.includes(v) ? v : "off";
  } catch {
    warnStorage("read");
    return "off";
  }
}

export const apodLight = signal(loadApodLight(K_APOD_LIGHT));

/**
 * Set the header apodizing indicator's mode and persist it. A value outside
 * APOD_LIGHT_MODES is ignored: the signal and the stored value both stand.
 *
 * @param {string} mode
 * @returns {void}
 */
export function setApodLight(mode) {
  if (!APOD_LIGHT_MODES.includes(mode)) return;
  apodLight.value = mode;
  try {
    localStorage.setItem(K_APOD_LIGHT, mode);
  } catch {
    // storage disabled (private mode) — keep the in-memory value
    warnStorage("written");
  }
}

// Time window of the Engine health card's apodizing-events density strip: how
// much recent playback the strip covers, in seconds, at most the spectrogram's
// 300 s history. An unset or junk value reads as the 60 s default.
export const APOD_WINDOWS = ["30", "60", "120", "300"];

/**
 * A stored choice from `allowed`, or `dflt` where nothing valid is stored.
 *
 * @param {string} key
 * @param {string[]} allowed
 * @param {string} dflt
 * @returns {string}
 */
function loadEnum(key, allowed, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v != null && allowed.includes(v) ? v : dflt;
  } catch {
    warnStorage("read");
    return dflt;
  }
}

/**
 * A persisted choice from a fixed list: its signal, loaded from `key`, and a
 * setter that stores the new value. A value outside `allowed` is ignored by the
 * setter: the signal and the stored value both stand.
 *
 * @param {string} key
 * @param {string[]} allowed
 * @param {string} dflt
 * @returns {[{ value: string }, (value: string) => void]}
 */
export function enumPref(key, allowed, dflt) {
  const sig = signal(loadEnum(key, allowed, dflt));
  /** @param {string} value */
  const set = (value) => {
    if (!allowed.includes(value)) return;
    sig.value = value;
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage disabled (private mode) — keep the in-memory value
      warnStorage("written");
    }
  };
  return [sig, set];
}

export const [apodWindow, setApodWindow] = enumPref(K_APOD_WINDOW, APOD_WINDOWS, "60");

// How the spectrum is drawn. An unset or junk value reads as the trace.
const SPECTRUM_STYLES = ["trace", "bars", "soft", "ridges", "aurora"];
export const [spectrumStyle, setSpectrumStyle] = enumPref(K_SPECTRUM_STYLE, SPECTRUM_STYLES, "trace");

// The Levels floor, dBFS: where the page's Source level bars and their dB scale
// end, apart from the page's Range.
export const METER_FLOORS = ["-48", "-60", "-90"];
export const [meterFloor, setMeterFloor] = enumPref(K_METER_FLOOR, METER_FLOORS, "-60");

// The METER spectrogram: which channel it draws ("sum" or a channel index) and
// how many dB below full scale its color ramp reaches. METER_RANGES is also the
// set the page's Source meter Range (pageRange, below) chooses from.
const METER_CHANNELS = ["sum", "0", "1", "2", "3", "4", "5", "6", "7"];
export const [meterChannel, setMeterChannel] = enumPref(K_METER_CHANNEL, METER_CHANNELS, "sum");
export const METER_RANGES = ["120", "180", "240", "300"];
export const [meterRange, setMeterRange] = enumPref(K_METER_RANGE, METER_RANGES, "120");

// Collapsed dropdown groups (Simplified option style). One JSON list of
// "<kind>|<family>" and "<kind>|<family>|<variant>" keys; a key's absence
// means expanded, so a fresh profile opens every group. Keyed per kind, not
// per control, so the PCM and SDM filter dropdowns share one fold.
const K_DD_COLLAPSED = "hqptuner.collapsedGroups";

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

/** @returns {Record<string, true>} */
function loadCollapsed() {
  /** @type {Record<string, true>} */
  const map = {};
  for (const k of loadStrings(K_DD_COLLAPSED)) map[k] = true;
  return map;
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

// The faceplate's browser-held preferences: HQPTuner's own choices, applied at
// once, never staged and never sent to the engine.
//   dacType          — Shaping's DAC type row, PCM: "other" or "r2r".
//   dacChip          — Shaping's DAC chip row, SDM: "other" or "ess".
//   topOfPage        — what the page's top section shows: "auto" (the spectrum
//                      over the Matrix section folded to its header line),
//                      "profile" (the Matrix section alone) or "spectrum".
//   bottomBar        — "switcher" (the Setting Switcher) or "none".
//   pageRange        — the page's Source meter Range, dB, one of METER_RANGES,
//                      the spectrum's span only; the level bars end at the
//                      Levels floor (meterFloor).
//   hiddenStages     — the stages hidden from the chain rail, a subset of
//                      HIDEABLE_STAGES, held in that order.
//   allowPinnedRates — the opt-in for pinning an output rate; off by default.
//
// A stored value outside a preference's set reads as that preference's default,
// and a stored hidden stage outside HIDEABLE_STAGES is dropped.
export const DAC_TYPES = ["other", "r2r"];
export const DAC_CHIPS = ["other", "ess"];
export const TOP_OF_PAGE = ["auto", "profile", "spectrum"];
export const BOTTOM_BARS = ["switcher", "none"];
export const HIDEABLE_STAGES = ["dsd", "speakers", "crossfeed", "loudness", "correction"];

const K_HIDDEN = "hqptuner.hiddenStages";
const K_PINNED = "hqptuner.allowPinnedRates";

export const [dacType, setDacType] = enumPref("hqptuner.dacType", DAC_TYPES, "other");
export const [dacChip, setDacChip] = enumPref("hqptuner.dacChip", DAC_CHIPS, "other");
export const [topOfPage, setTopOfPage] = enumPref("hqptuner.topOfPage", TOP_OF_PAGE, "auto");
export const [bottomBar, setBottomBar] = enumPref("hqptuner.bottomBar", BOTTOM_BARS, "switcher");
export const [pageRange, setPageRange] = enumPref("hqptuner.pageRange", METER_RANGES, "120");

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
