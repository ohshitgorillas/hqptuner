// The listening mode — SPEAKERS or HEADPHONES. The favicon follows it
// (store/ui/favicon.js); it never turns processing on by itself.
//
// The mode BELONGS TO THE PRESET, not to the browser. Which of the two a
// configuration is listened through is a property of that configuration — a
// preset built around crossfeed and a headphone EQ profile is a headphone preset
// whatever machine opens it — so the choice is stored for the install, keyed by
// preset name (presets/store/matrixmode.py, GET/PUT /api/matrixmodes). hqplayerd's
// config has nowhere to carry it: the daemon re-serializes configuration from its
// own model, so an attribute of ours would not survive.
//
// A preset with no recorded mode leaves the mode where it is. Nothing migrates
// existing presets, because "nobody has said" is not "this one is for speakers",
// and the last-used mode in localStorage remains the fallback for that case and
// for the moments there is no preset at all.
import { signal, computed, effect } from "@preact/signals";

import { activePreset } from "../resolve.js";
import { pendingPreset } from "../signals.js";
import { api } from "../../lib/api.js";

// The key is `hqptuner.dspMode`: it is a persisted localStorage key under which each install files the
// user's speakers/headphones choice, so a rename would orphan that value and drop the user to the default.
const KEY = "hqptuner.dspMode";

function load() {
  try {
    return localStorage.getItem(KEY) === "speakers" ? "speakers" : "headphones";
  } catch {
    return "headphones"; // storage disabled — the session still switches
  }
}

export const matrixMode = signal(load());

// Every preset's stored mode, keyed by preset name, as /api/matrixmodes serves
// it. Private: the map is this module's business, and what the rest of the app
// reads is the mode it resolves to.
const presetModes = signal(/** @type {Record<string, string>} */ ({}));

// Which preset the mode follows: the previewed one while a preset is staged but
// not applied, else the active one.
const boundPreset = computed(() => pendingPreset.value || activePreset.value || "");

/**
 * Fill the map from the server. Never throws: an unreachable backend leaves the
 * last-used mode standing.
 * @returns {Promise<void>}
 */
export async function hydrateMatrixModes() {
  try {
    const body = await api.matrixModes();
    presetModes.value = body.presets || {};
  } catch {
    /* unreachable or unreadable store — the last-used mode stands */
  }
}

// Follow the preset. Fires on a preset switch and on the hydrate that first
// learns the map; a preset with no recorded mode leaves the signal alone. The
// last-used value is kept current as it goes, so the fallback a reload lands on
// is the side the user was last looking at rather than the last one they clicked.
effect(() => {
  const recorded = presetModes.value[boundPreset.value];
  if (recorded !== "speakers" && recorded !== "headphones") return;
  matrixMode.value = recorded;
  rememberLast(recorded);
});

// The last-used mode, the fallback for a preset nobody has said anything about
// and for the moments there is no preset at all.
/**
 * @param {string} mode
 * @returns {void}
 */
function rememberLast(mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage disabled — in-memory value drives the session */
  }
}

// Read the map once, at load. Guarded on `fetch` because this module is imported
// by the SSR harness, where there is no backend to ask.
if (typeof fetch === "function") void hydrateMatrixModes();
