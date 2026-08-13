// Polling: mirror the backend's already-polled snapshots into the source signals
// (store/signals.js). The backend does the daemon talking; this layer only copies
// what it has and reschedules itself.

import { effect } from "@preact/signals";
import { api } from "../lib/api.js";
import { lastApply } from "./actions.js";
import { fastPollMs } from "./ui.js";
import {
  health,
  engineState,
  engineStatus,
  enums,
  config,
  matrixConfig,
  metadata,
  volume,
  volumeRange,
  staged,
} from "./signals.js";

/**
 * @typedef {{ data?: unknown }} Payload
 *   What a polled endpoint answers with. Most wrap their snapshot as
 *   `{stale, loaded_at, data}`; health/metadata/pending answer raw, which is
 *   what `unwrap` selects between.
 */

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | null>}
 */
async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// Mirror one polled endpoint into its signal. A failed call leaves the last
// good value in place rather than blanking the UI. Most endpoints answer with
// the payload under `.data`; `unwrap` names the ones that answer raw.
const raw = (/** @type {Payload} */ r) => r;
/**
 * Copy one polled endpoint's payload into its signal, leaving the last good
 * value in place when the call fails.
 *
 * @param {() => Promise<Payload>} fn
 * @param {{ value: unknown }} sig
 * @param {(r: Payload) => unknown} [unwrap]
 * @returns {Promise<void>}
 */
export async function mirror(fn, sig, unwrap = (r) => r.data) {
  const r = await safe(fn);
  if (r) sig.value = unwrap(r);
}

async function refreshFast() {
  await mirror(api.health, health, raw);
  await mirror(api.state, engineState);
  await mirror(api.status, engineStatus);
  // the one endpoint feeding two signals: the level and the range it sits in
  const v = await safe(api.volume);
  if (v) {
    volume.value = v.volume;
    volumeRange.value = v;
  }
}

// Trigger a daemon output-device rescan, then re-pull the config forms so the
// device dropdowns show a newly-present endpoint (an NAA powered back on).
/**
 * Trigger a daemon output-device rescan, then re-pull the config forms.
 *
 * @returns {Promise<{ refreshed: boolean, restored: Record<string, string>, warning?: string }>}
 *   The rescan report. `warning` is set when the rescan finished but the live
 *   settings it stopped the engine for could not be put back — the caller
 *   surfaces it, because a silent loss is the bug this reports on.
 */
export async function refreshDevices() {
  const r = await api.refreshDevices();
  await refreshConfig();
  // Reported here rather than at the button, so every caller surfaces it: a
  // rescan that lost the user's live settings must say so whoever asked for it.
  // Left untouched when there is nothing to warn about — the line is still
  // showing the last apply's result and the user may be reading it.
  if (r && r.warning) lastApply.value = { ok: false, text: r.warning };
  return r;
}

/** Re-pull the slow snapshots — enumerations, config, matrix and the pending buffer. */
export async function refreshConfig() {
  await mirror(api.enumerations, enums);
  await mirror(api.config, config);
  await mirror(api.matrix, matrixConfig);
  await mirror(api.pending, staged, raw);
}

/** Take the first snapshot of every endpoint and start the fast and config poll timers. */
export function startPolling(interval = 2000) {
  safe(api.metadata).then((m) => {
    if (m) metadata.value = m;
  });
  refreshFast();
  refreshConfig();
  // The fast (status/volume) cadence is reactive: the volume page, LIVE, and the
  // System page with quick updates ticked run at 1 s (store/ui.js). Reschedule the
  // timer whenever the derived cadence changes; the config poll stays fixed.
  /** @type {ReturnType<typeof setInterval>} */
  let fastTimer;
  effect(() => {
    const ms = fastPollMs.value;
    if (fastTimer) clearInterval(fastTimer);
    fastTimer = setInterval(refreshFast, ms);
  });
  setInterval(refreshConfig, interval * 2);
}
