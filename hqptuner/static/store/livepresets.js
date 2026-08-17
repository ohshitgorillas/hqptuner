// Live presets — the LIVE page's named setting combos, and the four calls that
// reach them.
//
// A live preset is not a config preset. The header's presets are whole
// hqplayerd.xml files applied by restarting the daemon; one of these is a
// handful of enum IDs handed to POST /api/config/live, which writes the running
// engine and never touches the configuration file. Nothing here stages, and
// nothing here is saved past the daemon's next restart — the record on disk is
// HQPTuner's, the settings it carries are the engine's and are as temporary as
// anything else on the LIVE page.
//
// The store is small and changes only when this card changes it, so it is not on
// the poll: it is read when LIVE opens and re-read after each save or delete.
import { signal, effect } from "@preact/signals";
import { api } from "../lib/api.js";
import { errText } from "../lib/errtext.js";
import { reportError } from "./live/state.js";
import { remirrorLive } from "./live/write.js";
import { liveMode } from "./prefs.js";

// Every saved preset, as /api/livepresets serves it: {name, chain, fields,
// names, compatible}. Null until the first read — "not looked yet" and "none
// saved" say different things on the card.
export const livePresets = signal(null);
// The preset with a call in flight (""=none), and the last failure. One error
// for the whole card, latest wins — the same rule the LIVE controls follow,
// because the card has one place to put it and the user has one thing in mind.
export const livePresetsBusy = signal("");
export const livePresetError = signal("");

// Nothing here judges a preset against the chain the engine has loaded. A preset
// carries its own output mode, so one taken on the other chain applies by
// switching the engine to it (lanes/live/lane.apply_preset) — there is no
// mismatch to gray, and graying it would have hidden the very thing it is for.

// Read the list. Private: every caller is in this module — nothing outside it
// decides when the store is stale, because nothing outside it changes the store.
async function refreshLivePresets() {
  try {
    const body = await api.livePresets();
    livePresets.value = body.presets || [];
  } catch (e) {
    livePresets.value = [];
    livePresetError.value = errText(e);
  }
}

// One preset's stored batch, for deciding what a successful apply invalidated.
/**
 * @typedef {object} LivePreset
 *   One saved live preset, as /api/livepresets serves it.
 * @property {string} name
 * @property {string} chain
 * @property {Record<string, string>} fields the stored batch, keyed by live form field
 * @property {Record<string, string>} [names] each field's enum NAME, for display
 * @property {boolean} [compatible]
 */

const fieldsOf = (/** @type {string} */ name) => {
  const record = (livePresets.value || []).find((/** @type {LivePreset} */ p) => p.name === name);
  return Object.keys((record && record.fields) || {});
};

// Every mutating call runs through here: mark the preset busy, clear the last
// complaint, report whatever went wrong. `after` runs only when the call itself
// succeeded, so a refused apply re-mirrors nothing — a refused batch applied
// nothing, so the page is still showing the truth.
/**
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} call
 * @param {(result: T) => Promise<void> | void} [after]
 * @returns {Promise<void>}
 */
async function run(name, call, after) {
  livePresetsBusy.value = name;
  livePresetError.value = "";
  try {
    const result = await call();
    if (after) await after(result);
  } catch (e) {
    livePresetError.value = errText(e);
  } finally {
    livePresetsBusy.value = "";
  }
}

// Apply is the live lane's own batch: readback-verified by the backend, and
// answered with the same per-setting report a hand-made write gets — so a 200
// that carries a setting which did not verify is an error here too.
/**
 * Apply a saved preset's batch to the running engine, then re-mirror the fields it
 * carried and surface any setting that did not verify.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function applyLivePreset(name) {
  const fields = fieldsOf(name);
  await run(
    name,
    () => api.applyLivePreset(name),
    async (/** @type {import("./live/state.js").LiveReport} */ report) => {
      await remirrorLive(fields, report);
      livePresetError.value = reportError(report);
    },
  );
}

// The backend snapshots the engine itself, so a save sends nothing but a name.
/**
 * Save the engine's current live settings under a name, then re-read the list.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function saveLivePreset(name) {
  await run(name, () => api.saveLivePreset(name), refreshLivePresets);
}

/**
 * Delete a saved live preset, then re-read the list.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function deleteLivePreset(name) {
  await run(name, () => api.deleteLivePreset(name), refreshLivePresets);
}

// Read the list when LIVE opens. Leaving with it read is fine — the card is not
// rendered — and coming back re-reads, which is what picks up a preset saved in
// another browser tab.
effect(() => {
  if (liveMode.value) refreshLivePresets();
});
