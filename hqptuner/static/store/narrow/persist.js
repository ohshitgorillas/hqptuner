// Writing the narrow bar's facets to the server, and reading them back at load
// — its own module because it is the only part of narrowing that talks to the
// backend, and the state it mirrors has no business knowing that.
//
// The facets are stored for the INSTALL, in state/narrowing.json, the way stars
// and live snapshots are: the bar is presentational and has no daemon field
// behind it, so there is nowhere else for it to live and nothing to reconcile
// with. Nothing polls — a tab picks up another tab's narrowing on reload, and
// two browsers racing is last-write-wins. The favorites-only switch is NOT part
// of that store: it lives in favorites.js and stays session state.
import { signal, effect, batch } from "@preact/signals";
import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";
import {
  nGenre,
  nQuality,
  nFocus,
  nPhase,
  nLength,
  nHideLimited,
  nOddRateOnly,
  nDownsafeOnly,
  nApod1x,
  nApodNx,
  nLossy1x,
  nSrcFormat,
  nGenreMode,
  nFocusMode,
  QUALITY_DEFAULT,
  RATE_RULE_DEFAULT,
  APOD_1X_DEFAULT,
  APOD_NX_DEFAULT,
  LOSSY_1X_DEFAULT,
  SRC_FORMAT_DEFAULT,
  GENRE_MODE_DEFAULT,
  FOCUS_MODE_DEFAULT,
} from "./state.js";

// Every facet the store holds, as [wire key, signal, default]. The wire keys are
// snake_case because the store is Python's; the mapping is mechanical.
/** @type {[string, { value: any }, any][]} */
const FACETS = [
  ["genre", nGenre, []],
  ["quality", nQuality, QUALITY_DEFAULT],
  ["focus", nFocus, []],
  ["phase", nPhase, []],
  ["length", nLength, []],
  // Legacy stores may still carry `ratio` / `upsample_only` / `hide_2x` /
  // `hide_int`; hydrate only reads the keys named here, so stale values are
  // ignored rather than migrated.
  ["hide_limited", nHideLimited, RATE_RULE_DEFAULT],
  ["odd_rate_only", nOddRateOnly, false],
  ["downsafe_only", nDownsafeOnly, false],
  ["apod_1x", nApod1x, APOD_1X_DEFAULT],
  ["apod_nx", nApodNx, APOD_NX_DEFAULT],
  ["lossy_1x", nLossy1x, LOSSY_1X_DEFAULT],
  ["src_format", nSrcFormat, SRC_FORMAT_DEFAULT],
  ["genre_mode", nGenreMode, GENRE_MODE_DEFAULT],
  ["focus_mode", nFocusMode, FOCUS_MODE_DEFAULT],
];

// How long the user has to stop toggling before the bar writes itself out. The
// bar itself never waits on the write — a facet takes effect the moment it is
// clicked, and the store catches up.
const QUIET_MS = 400;

/** The last failed narrowing write, as the server's own sentence. */
export const narrowingError = signal("");

/** @type {ReturnType<typeof setTimeout> | null} the open write timer, or null when idle */
let timer = null;
/** @type {Record<string, any>} the facet set as the server last confirmed it */
let lastSent = snapshot();
/** Facets the user has moved since that write — hydrate leaves these alone, and a non-empty set means a write is owed. */
const touched = new Set();
/** True while hydrate is filling the signals, so its own writes do not read as the user's. */
let applying = false;

/**
 * The whole facet set as the store takes it.
 * @returns {Record<string, any>}
 */
function snapshot() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, sig] of FACETS) out[key] = Array.isArray(sig.value) ? [...sig.value] : sig.value;
  return out;
}

/**
 * The wire keys whose value differs from the last confirmed write.
 * @param {Record<string, any>} snap
 * @returns {string[]}
 */
function changedKeys(snap) {
  return FACETS.map(([key]) => key).filter((key) => JSON.stringify(snap[key]) !== JSON.stringify(lastSent[key]));
}

/**
 * Fill the facet signals from the server, leaving alone any facet the user has
 * already moved — a slow hydrate must not undo a click that beat it. Never
 * throws: an unreachable backend leaves the bar at its defaults, which is what
 * the page can honestly show.
 * @returns {Promise<void>}
 */
export async function hydrateNarrowing() {
  try {
    const body = await api.narrowing();
    const facets = body.facets || {};
    applying = true;
    try {
      batch(() => {
        for (const [key, sig, dflt] of FACETS) {
          if (touched.has(key)) continue;
          sig.value = key in facets ? facets[key] : dflt;
        }
      });
    } finally {
      applying = false;
    }
  } catch (e) {
    narrowingError.value = errText(e);
  }
}

/**
 * Write the facets now if any have moved since the last confirmed write, and
 * take the server's answer as stored. A refused write leaves every facet where
 * the user put it — narrowing is presentational, so yanking a toggle back is
 * worse than a stale file — and puts the server's sentence in `narrowingError`.
 * @returns {Promise<void>}
 */
export async function flushNarrowing() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!touched.size) return;
  const snap = snapshot();
  touched.clear();
  try {
    const body = await api.saveNarrowing(snap);
    lastSent = body.facets || snap;
    narrowingError.value = "";
  } catch (e) {
    // Still owed: the next facet the user moves, or the next flush, retries it.
    for (const key of changedKeys(snap)) touched.add(key);
    narrowingError.value = errText(e);
  }
}

// One subscription over every facet signal: a move marks that facet owed and
// restarts the quiet timer, so a burst of toggles costs one write.
effect(() => {
  const snap = snapshot();
  if (applying) {
    lastSent = snap;
    return;
  }
  const changed = changedKeys(snap);
  if (!changed.length) return;
  for (const key of changed) touched.add(key);
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void flushNarrowing(), QUIET_MS);
});

// Read the stored facets once, at load. Guarded on `fetch` because this module
// is imported by the SSR harness, where there is no backend to ask.
if (typeof fetch === "function") void hydrateNarrowing();
// A tab hidden or closed inside the quiet window would otherwise drop the last
// toggle. Nothing to restore on failure here — the page is going away.
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushNarrowing();
  });
}
