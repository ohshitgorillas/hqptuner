// Polling: mirror the backend's already-polled snapshots into the source signals
// (store/signals.js). The backend does the daemon talking; this layer only copies
// what it has and reschedules itself.

import { effect } from "@preact/signals";
import { api } from "../lib/api.js";
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
const raw = (r) => r;
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
export async function refreshDevices() {
  await api.refreshDevices();
  await refreshConfig();
}

export async function refreshConfig() {
  await mirror(api.enumerations, enums);
  await mirror(api.config, config);
  await mirror(api.matrix, matrixConfig);
  await mirror(api.pending, staged, raw);
}

export function startPolling(interval = 2000) {
  safe(api.metadata).then((m) => {
    if (m) metadata.value = m;
  });
  refreshFast();
  refreshConfig();
  // The fast (status/volume) cadence is reactive: a page's "quick updates" opt-in
  // drops it to 500 ms while that page is shown (store/ui.js). Reschedule the
  // timer whenever the derived cadence changes; the config poll stays fixed.
  let fastTimer;
  effect(() => {
    const ms = fastPollMs.value;
    if (fastTimer) clearInterval(fastTimer);
    fastTimer = setInterval(refreshFast, ms);
  });
  setInterval(refreshConfig, interval * 2);
}
