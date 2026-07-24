// Speaker processing (hqplayerd readme §1.9) — per-channel level (dBFS) and
// distance (cm), read from and written to the daemon's /speakers form.
//
// This does NOT ride the config staging buffer. The write is its own form POST
// that reloads the engine (~3 s) and is idle-gated server-side, exactly like a
// matrix profile Load — so the card holds its own edits and applies them
// directly, rather than pretending to be part of the pending-changes bar.
import { signal } from "@preact/signals";

import { api } from "../lib/api.js";

export const speakers = signal(null); // {enabled, channels:[{index,label,level,distance,...}]}
export const speakersStale = signal(false);
export const speakersError = signal("");
export const speakersBusy = signal(false);

function fail(e) {
  speakersError.value = String(e && e.message ? e.message : e);
}

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
