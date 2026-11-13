// A state import replaces HQPTuner's own stores on the server, so every store the page holds is read again once it
// lands. A store left holding its pre-import copy would write that copy back over the imported one on its next save:
// a star toggled, a facet moved, a description typed. Writes still waiting on a quiet timer are sent before the
// import, and whatever is still owed once it lands, a failed write included, is dropped before the re-reads, for the
// same reason.

import { signal } from "@preact/signals";
import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";
import { refreshConfig } from "../sync.js";
import { hydrateFavorites } from "../narrow/favorites.js";
import { dropOwedNarrowing, flushNarrowing, hydrateNarrowing } from "../narrow/persist.js";
import { dropQueuedDescriptions, flushDescriptions, hydrateDescriptions } from "../matrix/descriptions.js";
import { hydrateMatrixModes } from "../matrix/mode.js";
import { refreshLivePresets } from "../live/presets.js";

/** The line the state upload shows: how the last import went, or "" before any. */
export const importStatus = signal("");

/** The line a refused import shows, by the refusal's code. */
const REFUSAL = new Map([
  ["state_unreadable", "Not an HQPTuner state file."],
  ["state_too_new", "This state file is from a newer HQPTuner. Update HQPTuner first."],
]);

/**
 * The line a failed import shows: the refusal's own line where its code has one, else the failure's sentence.
 *
 * @param {unknown} err
 * @returns {string}
 */
function failureLine(err) {
  const code = err instanceof Error && "code" in err ? String(err.code) : "";
  return REFUSAL.get(code) ?? `Failed: ${errText(err)}`;
}

/**
 * Send the writes waiting on a timer, post the state file, drop whatever is still owed, then read every store again.
 *
 * @param {File} file
 * @returns {Promise<void>}
 */
async function replaceStores(file) {
  await Promise.all([flushNarrowing(), flushDescriptions()]);
  await api.stateImport(file);
  dropOwedNarrowing();
  dropQueuedDescriptions();
  await Promise.all([
    refreshConfig(),
    hydrateFavorites(),
    hydrateNarrowing(),
    hydrateDescriptions(),
    hydrateMatrixModes(),
    refreshLivePresets(),
  ]);
}

/**
 * Import a state file and report how it went in `importStatus`. The engine is not touched. A refused import changes
 * nothing, so it re-reads nothing and drops nothing still owed. Never throws.
 *
 * @param {File} file
 * @returns {Promise<void>}
 */
export async function importState(file) {
  importStatus.value = "importing…";
  try {
    await replaceStores(file);
    importStatus.value = "State imported. Your previous state is saved in backups.";
  } catch (err) {
    importStatus.value = failureLine(err);
  }
}
