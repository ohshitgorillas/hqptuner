// The one path the live controls write by.
//
// Every control writes the moment it changes — one field, one
// POST /api/config/live, readback-verified by the backend before it answers.
// Nothing here stages. Apply flushes all of the pending buffer, so a live
// control that touched it would apply edits the
// user never asked for (lanes/live/lane.py says the same from the other side).
//
// Two mirrors follow a write. `engineState` always: a live edit never reaches the
// config file, so /api/state is the only place its new value shows up. `enums`
// when the server's answer says it re-read the engine's enumerations for the
// batch, or when there is no answer at all: the server has already refreshed
// them, and this pulls the fresh lists into the page so the next control
// resolves against what the engine now offers.
//
// No control here is ever refused because playback is running (CLAUDE.md): what
// a live change costs mid-stream is the user's to spend, and the captions say so.

import { signal } from "@preact/signals";
import { api } from "../../lib/api.js";
import { failText } from "../../lib/errtext.js";
import { engineState, enums } from "../signals.js";
import { refreshConfig } from "../sync.js";
import { liveUnsettled, RATE_MIRRORED, reportError } from "./state.js";

/** @typedef {import("./state.js").LiveReport} LiveReport */

/** The sentence a live write that threw opens with. */
const LIVE_LEAD = "Live change failed: ";

// The last live write's failure, "" once a write verifies: a write that threw, or
// the settings its report says did not verify. Latest wins.
export const liveWriteError = signal("");

// Latest-wins across overlapping re-mirrors: State is whatever the most recent
// read of it said, so only the newest call to start installs what it read.
let remirrorSeq = 0;

// What superseded re-mirrors still owe. A call that loses to a newer one installs
// nothing, so a mode write overlapped by a volume write would otherwise never land
// its new menus or its rate limits. Each call records its needs here before its
// first await, and the winner does them all; a flag clears only once its work is in.
const owed = { enums: false, config: false };

/**
 * Add one re-mirror's needs to what the winning call owes.
 * @param {string[]} fields
 * @param {LiveReport} [report]
 */
function recordOwed(fields, report) {
  // The server says whether the batch re-enumerated. With no answer the request
  // threw, and a setter may still have landed under it, so nothing says the
  // lists stayed put.
  if (!report || report.reenumerated) owed.enums = true;
  // An edit to the chain the engine has not loaded is HELD, not applied
  // (lanes/live/routing.resolve_live), so State cannot show it. The running
  // config's live overlay is where a held edit appears, and that overlay is what
  // the dormant chain's controls read back.
  const held = !!(report && report.stored && Object.keys(report.stored).length);
  // A mode write moves what the running config reports for BOTH rate limits
  // (routing.live_overrides), and that overlay is what the Output drawer's rate
  // dial reads. Its own poll is on the slow cadence, so pull it here rather
  // than leave them showing the pre-switch tier for a few seconds.
  if (held || fields.some((f) => RATE_MIRRORED.has(f))) owed.config = true;
}

// Re-read what a live write moved. Takes the batch's fields rather than one
// name because a live snapshot applies several at once (store/live/presets.js) and
// must re-mirror by exactly the rules a hand-made write already follows —
// deciding that twice is how the two paths drift.
/**
 * Re-read what a live write moved: engine state always, the enumerations when the
 * report says the batch re-enumerated or there is no report, the running config
 * when it touched a rate limit or was held.
 * @param {string[]} fields the batch's own fields, whatever wrote them
 * @param {LiveReport} [report] the server's answer; absent when the request threw
 * @returns {Promise<void>}
 */
export async function remirrorLive(fields, report) {
  const seq = ++remirrorSeq;
  recordOwed(fields, report);
  const state = await api.state();
  // The new lists are pulled BEFORE either signal is installed, and the pair is
  // then installed together. State carries the new active_chain, so installing
  // it first would render the new chain's controls against the pre-switch lists for as
  // long as the enumerations request took — a filter picked in that window
  // would post an ID from a list the engine had already replaced.
  const fresh = owed.enums ? await api.enumerations() : null;
  if (seq !== remirrorSeq) return;
  engineState.value = state.data;
  if (fresh) {
    enums.value = fresh.data;
    owed.enums = false;
  }
  if (!owed.config) return;
  await refreshConfig();
  // A call that started during the refresh may have read its own write after
  // this one did, so its debt stays for it to settle.
  if (seq === remirrorSeq) owed.config = false;
}

// Write one live control. Returns nothing on purpose: the outcome is the mirrors
// the re-mirror installs and `liveWriteError`, so no control has to hold a second
// copy of it.
/**
 * Write one live control and re-mirror behind it, counting it on `liveUnsettled`
 * until the re-mirror is in, and leave its failure, or "", in `liveWriteError`.
 * @param {string} field
 * @param {string | number | boolean} value
 * @returns {Promise<void>}
 */
export async function writeLive(field, value) {
  liveUnsettled.value += 1;
  try {
    const { report } = await api.live({ [field]: String(value) });
    liveWriteError.value = reportError(report);
    await remirrorLive([field], report);
  } catch (e) {
    liveWriteError.value = failText(LIVE_LEAD, e);
    // A refused batch (409) applied nothing, but a thrown error is not always a
    // refusal: the daemon can accept a setter and then die under it, which leaves
    // the mirrors describing a chain that is no longer loaded. Re-read rather than
    // assume, best effort — if the daemon is gone the read fails too, and the
    // mirrors are then as current as anything can make them.
    await remirrorLive([field]).catch(() => {});
  } finally {
    liveUnsettled.value -= 1;
  }
}
