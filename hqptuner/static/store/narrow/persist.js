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
import { effect, batch } from "@preact/signals";
import { api } from "../../lib/api.js";
import { op, opErrorText, FAILED } from "../core/ops.js";
import { PLATFORM, quietWindow } from "../../lib/clock.js";
import { sameJson } from "../../lib/samejson.js";
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

/** @typedef {import("../../lib/clock.js").Clock} Clock */

/** The last failed narrowing read or write's sentence, "" once one succeeds. */
const narrowingOp = op("narrowing");
export const narrowingError = opErrorText(narrowingOp);

/** The quiet window a facet move restarts; it writes the facets out when it closes. */
let quiet = quietWindow(QUIET_MS, () => void flushNarrowing(), PLATFORM);
/** @type {Record<string, any>} the facet set as the server last confirmed it */
let lastSent = snapshot();
/** Facets the user has moved since that write — hydrate leaves these alone, and a non-empty set means a write is owed. */
const touched = new Set();
/** True while hydrate is filling the signals, so its own writes do not read as the user's. */
let applying = false;

/**
 * Pace the quiet window on ``next`` from the next facet move on.
 * @param {Clock} [next]
 * @returns {void}
 */
export function initNarrowing(next = PLATFORM) {
  quiet.cancel();
  quiet = quietWindow(QUIET_MS, () => void flushNarrowing(), next);
}

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
  return FACETS.map(([key]) => key).filter((key) => !sameJson(snap[key], lastSent[key]));
}

/**
 * Fill the facet signals from the server, leaving alone any facet the user has
 * already moved — a slow hydrate must not undo a click that beat it. Never
 * throws: an unreachable backend leaves the bar at its defaults, which is what
 * the page can honestly show.
 * @returns {Promise<void>}
 */
export async function hydrateNarrowing() {
  await narrowingOp.run(async () => {
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
    narrowingError.value = "";
  });
}

/**
 * Write the facets now if any have moved since the last confirmed write, and
 * take the server's answer as stored. A refused write leaves every facet where
 * the user put it — narrowing is presentational, so yanking a toggle back is
 * worse than a stale file — and puts the server's sentence in `narrowingError`.
 * @returns {Promise<void>}
 */
export async function flushNarrowing() {
  quiet.cancel();
  if (!touched.size) return;
  const snap = snapshot();
  touched.clear();
  const result = await narrowingOp.run(async () => {
    const body = await api.saveNarrowing(snap);
    lastSent = body.facets || snap;
    narrowingError.value = "";
  });
  if (result === FAILED) {
    // Still owed: the next facet the user moves, or the next flush, retries it.
    for (const key of changedKeys(snap)) touched.add(key);
  }
}

/**
 * Forget every write still owed, a failed one included, and take the facets as they stand as the confirmed set, so
 * nothing moved before now is written. For a store the server has just replaced: an owed facet would otherwise be
 * skipped by the next hydrate and written over the replacement by the next flush.
 * @returns {void}
 */
export function dropOwedNarrowing() {
  quiet.cancel();
  touched.clear();
  lastSent = snapshot();
  narrowingError.value = "";
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
  quiet.arm();
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
