// Speaker processing (hqplayerd readme §1.9): per-channel level (dBFS) and
// distance (cm), read from and written to the daemon's /speakers form.
//
// This does NOT ride the config staging buffer. The write is its own form POST
// that reloads the engine (~3 s), interrupting playback, exactly like a
// matrix profile Load, so store/faceplate/drawers/speakers.js holds the edits
// and the Speakers drawer's apply group runs this form's POST.
import { signal } from "@preact/signals";

import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";
import { duringEngineWrite } from "../enginewrite.js";

export const speakers = signal(null); // {enabled, channels:[{index,label,level,distance,...}]}
export const speakersError = signal("");
export const speakersBusy = signal(false);

/** The speaker-processing switch as drafted over the daemon's; null follows the daemon's. */
export const gateDraft = signal(/** @type {boolean | null} */ (null));

/** The daemon's speaker-processing switch, off before the form's first read. */
export const daemonGate = () => !!(/** @type {{ enabled?: boolean } | null} */ (speakers.value)?.enabled);

/**
 * Draft the speaker-processing switch: the speakers form's own write, which stages nothing in the config staging
 * buffer. Back at the daemon's, it is no edit.
 *
 * @param {boolean} on
 */
export function setSpeakersGate(on) {
  gateDraft.value = on === daemonGate() ? null : on;
}

/** Whether the drafted switch differs from the daemon's, which a later read can have moved onto it. */
export const gateDiffers = () => gateDraft.value !== null && gateDraft.value !== daemonGate();

/**
 * @typedef {{ level?: string, distance?: string }} ChannelEdit
 *   One channel's pending edit. Both fields are strings: the drawer writes what
 *   the input holds (store/faceplate/drawers/speakers.js draftField), and a field the user cleared is
 *   DELETED rather than set empty, so "absent" means "leave the daemon's value".
 */

/** @param {unknown} e */
function fail(e) {
  speakersError.value = errText(e);
}

/** Read the daemon's /speakers form into the store, recording any failure. */
export async function loadSpeakers() {
  try {
    const r = await api.speakers();
    speakers.value = r.data;
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
    // The form POST reloads the engine (~3 s); every engine write runs under the engine-write
    // lifecycle, which keeps the brand knob on Applying… across it rather than Unreachable.
    const { report: r } = await duringEngineWrite(() => api.applySpeakers({ enabled: !!enabled, channels }));
    if (r.speakers) speakers.value = r.speakers;
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
