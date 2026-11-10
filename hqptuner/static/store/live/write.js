// The one path the LIVE view's controls write by.
//
// Every control writes the moment it changes — one field, one
// POST /api/config/live, readback-verified by the backend before it answers.
// Nothing here stages. The pending buffer belongs to the tabs view and Apply
// flushes all of it, so a LIVE control that touched it would apply edits the
// user never asked for (lanes/live/lane.py says the same from the other side).
//
// Two mirrors follow a write. `engineState` always: a live edit never reaches the
// config file, so /api/state is the only place its new value shows up. `enums`
// when the write re-enumerates — SetMode swaps the filter and shaper lists
// wholesale, and the rate list depends on both mode and the selected filter
// (manual §4.6). The backend has already refreshed them; this pulls the fresh
// lists into the page so the next control resolves against what the engine now
// offers.
//
// No control here is ever refused because playback is running (CLAUDE.md): what
// a live change costs mid-stream is the user's to spend, and the captions say so.
//
// The app works only with both daemon lanes up. While it is not ready, an edit is
// held here, in memory, the newest value per setting, and goes out once it is.

import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";
import { effect, untracked } from "@preact/signals";
import { engineState, enums, ready } from "../signals.js";
import { engineRestarting } from "../enginewrite.js";
import { refreshConfig } from "../sync.js";
import { liveBusy, setError, reportError, REENUMERATES, RATE_MIRRORED } from "./state.js";

/** @typedef {import("./state.js").LiveReport} LiveReport */

// Re-read what a live write moved. Takes the batch's fields rather than one
// name because a live snapshot applies several at once (store/live/presets.js) and
// must re-mirror by exactly the rules a hand-made write already follows —
// deciding that twice is how the two paths drift.
/**
 * Re-read what a live write moved — engine state always, the enumerations when the
 * batch re-enumerated, the running config when it touched a rate limit or was held.
 * @param {string[]} fields the batch's own fields, whatever wrote them
 * @param {LiveReport} [report]
 * @returns {Promise<void>}
 */
export async function remirrorLive(fields, report) {
  const state = await api.state();
  // An edit to the chain the engine has not loaded is HELD, not applied
  // (lanes/live/routing.resolve_live) — so State cannot show it and no engine list
  // moved. The running config's live overlay is where a held edit appears, and
  // that overlay is what the dormant chain's card reads back.
  const held = !!(report && report.stored && Object.keys(report.stored).length);
  // The new lists are pulled BEFORE either signal is installed, and the pair is
  // then installed together. State carries the new active_chain, so installing
  // it first rendered the new chain's card against the pre-switch lists for as
  // long as the enumerations request took — a filter picked in that window
  // posted an ID from a list the engine had already replaced.
  const fresh = !held && fields.some((f) => REENUMERATES.has(f)) ? await api.enumerations() : null;
  engineState.value = state.data;
  if (fresh) enums.value = fresh.data;
  // A mode write moves what the running config reports for BOTH rate limits
  // (routing.live_overrides), and that overlay is what the Output tab's rate
  // columns read. Its own poll is on the slow cadence, so pull it here rather
  // than leave them showing the pre-switch tier for a few seconds.
  if (held || fields.some((f) => RATE_MIRRORED.has(f))) await refreshConfig();
}

// Whether a write can go out now. `ready` alone is not enough: during HQPTuner's own
// apply restart the last health reading still says ready until the next poll, while
// the server's gate already refuses.
const sendable = () => ready.value && !engineRestarting.value;

// field -> the newest value edited while not ready.
/** @type {Map<string, string | number | boolean>} */
const held = new Map();

/**
 * Write one live control and re-mirror behind it, leaving the outcome on the lane's
 * busy and error signals.
 * @param {string} field
 * @param {string | number | boolean} value
 * @returns {Promise<void>}
 */
async function sendLive(field, value) {
  liveBusy.value = field;
  setError(field, "");
  try {
    const { report } = await api.live({ [field]: String(value) });
    await remirrorLive([field], report);
    setError(field, reportError(report));
  } catch (e) {
    // A refused batch (409) applied nothing, but a thrown error is not always a
    // refusal: the daemon can accept a setter and then die under it, which leaves
    // the mirrors describing a chain that is no longer loaded. Re-read rather than
    // assume, best effort — if the daemon is gone the read fails too, and the
    // mirrors are then as current as anything can make them.
    await remirrorLive([field]).catch(() => {});
    setError(field, errText(e));
  } finally {
    liveBusy.value = "";
  }
}

// Send what was held, one write per setting, and empty the set first so an edit made
// meanwhile is held afresh rather than lost.
async function flushHeld() {
  const batch = [...held];
  held.clear();
  for (const [field, value] of batch) await sendLive(field, value);
}

effect(() => {
  if (sendable()) untracked(flushHeld);
});

// Write one live control. Returns nothing on purpose: the outcome lives on the
// signals above, so no control has to hold a second copy of it.
/**
 * Write one live control, or hold it until both lanes are ready.
 * @param {string} field
 * @param {string | number | boolean} value
 * @returns {Promise<void>}
 */
export async function writeLive(field, value) {
  if (!untracked(sendable)) {
    held.set(field, value);
    return;
  }
  await sendLive(field, value);
}
