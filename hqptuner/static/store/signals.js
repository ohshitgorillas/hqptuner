// The store's source signals: the raw polled trees (engine + config), the
// client-side editor state over them, and the small connection-state
// computeds. Every other store module (resolve.js, actions.js, sync.js) sits on
// top of this one, which imports nothing from them — the dependency edge only
// ever runs one way.
//
// The three trees:
//
//   engine  — live runtime (4321 State/enums/status/health): authority for
//             live-lane control values + the per-mode enum lists + reachability
//   config  — GET /config form: authority for http-lane control values +
//             each field's min/max/enum constraints; the persistent-file baseline
//   staged  — server-side pending buffer ({live, http}); the client mirrors it
//
// Live changes are never persisted, so engine and config can disagree for the
// same setting — that divergence is why these are separate trees.

import { signal, computed } from "@preact/signals";

export const PAUSED = 1;
export const PLAYING = 2; // Status state: 0 Stopped, 1 Paused, 2 Playing, 3 Stopping

// --- source signals ---
export const health = signal(null);
export const engineState = signal(null); // /api/state data (live indices)
export const engineStatus = signal(null); // /api/status data
export const enums = signal(null);
export const config = signal(null); // /api/config data {fields, profiles}
export const matrixConfig = signal(null); // /api/matrix data {fields} (crossfeed/correction)
export const metadata = signal(null); // static: {filters, shapers, settings}

export const volume = signal(null); // engine-reported current volume (dB, string)
export const volumeRange = signal(null); // {min, max, enabled, adaptive} from VolumeRange
export const volumeDrag = signal(null);
export const volumeShown = computed(() => (volumeDrag.value != null ? String(volumeDrag.value) : volume.value));

export const pendingPreset = signal(null);
export const previewConfig = signal(null);
export const staged = signal({ live: {}, http: {} });
export const liveOverride = signal({});
export const lastApply = /** @type {{ value: import("./apply-summary.js").Verdict | null }} */ (signal(null));

export const phase = computed(() => health.value?.phase ?? null);
export const generation = computed(() => health.value?.generation ?? 0);
export const modeName = computed(() => (enums.value && enums.value.mode && enums.value.mode.name) || "");
export const advisor = computed(() => (engineStatus.value || {}).advisor !== false);
