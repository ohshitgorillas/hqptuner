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

import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";
import { engineState, enums } from "../signals.js";
import { refreshConfig } from "../sync.js";
import { liveBusy, setError, reportError, REENUMERATES, RATE_MIRRORED } from "./state.js";
import { wireRate } from "./rates.js";

/** @typedef {import("./state.js").LiveReport} LiveReport */

// Re-read what a live write moved. Takes the batch's fields rather than one
// name because a live preset applies several at once (store/livepresets.js) and
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
  // A rate or mode write moves what the running config reports for BOTH rate
  // limits (routing.live_overrides), and that overlay is what the dormant rate
  // column reads. Its own poll is on the slow cadence, so pull it here rather
  // than leave the column showing the pre-switch tier for a few seconds.
  if (held || fields.some((f) => RATE_MIRRORED.has(f))) await refreshConfig();
}

// Write one live control. Returns nothing on purpose: the outcome lives on the
// signals above, so no control has to hold a second copy of it.
/**
 * Write one live control and re-mirror behind it, leaving the outcome on the lane's
 * busy and error signals.
 * @param {string} field
 * @param {string | number | boolean} value
 * @returns {Promise<void>}
 */
export async function writeLive(field, value) {
  liveBusy.value = field;
  setError(field, "");
  try {
    // Rate is the one control whose menu value is not what goes on the wire: the
    // menus name a tier, and only here are the source and the engine's own list
    // known well enough to say which member of it (see the base-family note in
    // store/live/rates.js).
    const wire = field === "rate" ? wireRate(String(value)) : String(value);
    const report = await api.live({ [field]: wire });
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
