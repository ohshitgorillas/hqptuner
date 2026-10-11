// The engine-write lifecycle, shared by every write to the daemon.
//
// Two signals, because a write and a restart are not the same fact. `engineBusy`
// is "a write is in flight" and drives the brand knob's Applying… state; `engineRestarting`
// is "the daemon is going away for this one" and drives the page dim. A staged apply
// routed entirely live raises the first and not the second: the engine never leaves,
// so a dim would be telling the user something untrue.

import { signal } from "@preact/signals";
import { refreshHealth } from "./sync.js";

// Every write that restarts or reloads the daemon, whichever control started it. The
// brand knob reads this (store/faceplate/conn.js).
export const engineBusy = signal(false);

// The subset of those writes that actually takes the daemon down. The page dim reads
// this alone, so the dim keeps one meaning: the engine is not there right now.
export const engineRestarting = signal(false);

/**
 * Hold the brand knob in its Applying… state for the length of a write, and read health back
 * before releasing it.
 *
 * The backend's own wait returns only once both daemon lanes are up on a connection made
 * after the write, so the reading taken here is the true one; without it the knob would
 * clear onto a snapshot up to a poll interval old, taken while the daemon was down.
 *
 * @template T
 * @param {() => Promise<T>} run
 * @param {boolean} [restarts] whether this write takes the daemon down, dimming the page
 *   for its length. Defaults true: every caller outside the apply lane restarts by
 *   construction, and only a staged apply can turn out to be all-live.
 * @returns {Promise<T>}
 */
export async function duringEngineWrite(run, restarts = true) {
  engineBusy.value = true;
  engineRestarting.value = restarts;
  try {
    return await run();
  } finally {
    // `mirror` leaves the last good value in place on a failed fetch, so a health
    // endpoint that is itself down cannot blank the UI here.
    await refreshHealth();
    engineBusy.value = false;
    engineRestarting.value = false;
  }
}
