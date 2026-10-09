// Matrix tab mode — SPEAKERS or HEADPHONES. A VIEW SELECTOR: it decides which
// half of the Matrix tab is on screen, and it never turns processing on by itself.
//
// Switching to SPEAKERS SUPPRESSES crossfeed (the two are mutually exclusive
// listening setups — a speaker rig has real ear-to-ear leakage, so synthesizing
// more of it is wrong), and switching back to HEADPHONES puts back exactly what
// was suppressed. Suppression is not the same as turning something off: the user
// enabled crossfeed on the headphone side, that setting belongs to the headphone
// side, and a trip through the speaker controls is not a decision to abandon it.
// Nothing is restored that the switch did not itself take away, and nothing is
// restored over a pipeline the user edited while they were on the speaker side —
// their work outranks the snapshot.
//
// Both directions are STAGED like any other edit — the pending bar counts them
// and Discard undoes them. Nothing reaches the daemon until Apply.
//
// The mode BELONGS TO THE PRESET, not to the browser. Which half of the tab a
// configuration is listened through is a property of that configuration — a
// preset built around crossfeed and a headphone EQ profile is a headphone preset
// whatever machine opens it — so the choice is stored for the install, keyed by
// preset name (presets/store/matrixmode.py, GET/PUT /api/matrixmodes). hqplayerd's
// config has nowhere to carry it: the daemon re-serializes configuration from its
// own model, so an attribute of ours would not survive.
//
// A preset with no recorded mode leaves the tab where it is. Nothing migrates
// existing presets, because "nobody has said" is not "this one is for speakers",
// and the last-used mode in localStorage remains the fallback for that case and
// for the moments there is no preset at all. The snapshot rides along with it, so
// a reload on the speaker side does not strand the headphone setup.
//
// Binding the view to a preset sets the signal DIRECTLY, never through
// `setMatrixMode`: the preset carries its own pipelines and crossfeed in its own
// config, so the suppress/restore below would stage edits the preset already
// accounts for. Only the hand-driven switcher suppresses and restores.
import { signal, computed, effect } from "@preact/signals";

import { activePreset } from "../resolve.js";
import { pendingPreset } from "../signals.js";
import { api } from "../../lib/api.js";

// DELIBERATELY still says dspMode, and must stay that way. This module, its
// signal and its setter were renamed dspMode -> matrixMode when the DSP tab
// became the Matrix tab, but this string is a PERSISTED localStorage key, not an
// internal name: every existing install has the user's speakers/headphones
// choice filed under it. Renaming it to match would silently orphan that value
// and drop everyone back to the default on upgrade. Leave it.
const KEY = "hqptuner.dspMode";

function load() {
  try {
    return localStorage.getItem(KEY) === "speakers" ? "speakers" : "headphones";
  } catch {
    return "headphones"; // storage disabled — the session still switches
  }
}

/**
 * @typedef {object} Suppressed
 *   What the trip to the speaker side took away — the guard for putting exactly
 *   that back, and nothing else.
 * @property {import("../resolve.js").PipelineRow[]} rows the pipelines as they stood
 * @property {string | number | boolean | undefined} crossfeed the Bauer flag as it stood
 * @property {import("../resolve.js").PipelineRow[]} after what the suppression left behind
 */

export const matrixMode = signal(load());

// Every preset's stored mode, keyed by preset name, as /api/matrixmodes serves
// it. Private: the map is this module's business, and what the rest of the app
// reads is the mode it resolves to.
const presetModes = signal(/** @type {Record<string, string>} */ ({}));

// Which preset the tab is looking at: the previewed one while a preset is staged
// but not applied, else the active one. The preview is what is on screen, so it
// is what the view follows.
const boundPreset = computed(() => pendingPreset.value || activePreset.value || "");

/**
 * Fill the map from the server. Never throws: an unreachable backend leaves the
 * tab on the last-used mode, which is what it can honestly show.
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
