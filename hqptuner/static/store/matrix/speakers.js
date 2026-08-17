// Speaker processing (hqplayerd readme §1.9) — per-channel level (dBFS) and
// distance (cm), read from and written to the daemon's /speakers form.
//
// This does NOT ride the config staging buffer. The write is its own form POST
// that reloads the engine (~3 s), interrupting playback, exactly like a
// matrix profile Load — so the card holds its own edits and applies them
// directly, rather than pretending to be part of the pending-changes bar.
import { signal } from "@preact/signals";

import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";

export const speakers = signal(null); // {enabled, channels:[{index,label,level,distance,...}]}
export const speakersStale = signal(false);
export const speakersError = signal("");
export const speakersBusy = signal(false);

/**
 * @typedef {{ level?: string, distance?: string }} ChannelEdit
 *   One channel's pending edit. Both fields are strings — the card writes what
 *   the input holds (SpeakersCard.js editCh), and a field the user cleared is
 *   DELETED rather than set empty, so "absent" means "leave the daemon's value".
 */

/** @param {unknown} e */
function fail(e) {
  speakersError.value = errText(e);
}

/** Read the daemon's /speakers form into the store, recording staleness or failure. */
export async function loadSpeakers() {
  try {
    const r = await api.speakers();
    speakers.value = r.data;
    speakersStale.value = !!r.stale;
    speakersError.value = "";
  } catch (e) {
    fail(e);
  }
}

// `channels` is {index: {level?, distance?}} — a partial overlay. The server
// re-reads the complete form and overlays these, so untouched channels keep
// whatever the daemon currently holds.
/**
 * Write the speaker-processing switch and the per-channel edits to the daemon, and
 * take the readback it answers with.
 * @param {boolean} enabled
 * @param {Record<string, ChannelEdit>} channels keyed by channel index as a string
 * @returns {Promise<boolean>} whether the daemon confirmed the new values
 */
export async function applySpeakers(enabled, channels) {
  speakersBusy.value = true;
  speakersError.value = "";
  try {
    const r = await api.applySpeakers({ enabled: !!enabled, channels });
    if (r.speakers) speakers.value = r.speakers;
    speakersStale.value = false;
    // The lane verifies by reading /speakers back past the reload; an unverified
    // apply is reported rather than dressed up as success.
    if (!r.applied) speakersError.value = "applied, but the daemon did not confirm the new values — check below";
    return !!r.applied;
  } catch (e) {
    fail(e);
    return false;
  } finally {
    speakersBusy.value = false;
  }
}
