// The store's source signals: the raw polled trees (engine + config, architecture
// §2), the client-side editor state over them, and the small connection-state
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
// same setting — that divergence is why these are separate trees (architecture §2).

import { signal, computed } from "@preact/signals";

// --- source signals ---
export const health = signal(null); // {reachable, alarm, unreachable_since, info}
export const engineState = signal(null); // /api/state data (live indices)
export const engineStatus = signal(null); // /api/status data
export const enums = signal(null); // /api/enumerations data (merged w/ static)
export const config = signal(null); // /api/config data {fields, profiles}
// exported as part of the store surface: components read it via runningValue,
// and tests/js drive the matrix-fed chips by assigning it directly.
export const matrixConfig = signal(null); // /api/matrix data {fields} (crossfeed/correction)
export const metadata = signal(null); // static: {filters, shapers, settings}

// live playback volume — NOT a staged control: it lives in its own signals and
// writes immediately via the Control API (never through the staged/apply flow).
export const volume = signal(null); // engine-reported current volume (dB, string)
export const volumeRange = signal(null); // {min, max, enabled, adaptive} from VolumeRange

// --- editor state ---
// Preset preview: picking a preset loads its saved settings into the editor as
// the baseline (no daemon touch) so they can be tweaked before Apply commits the
// switch. pendingPreset = the previewed name; previewConfig = its field values.
export const pendingPreset = signal(null);
export const previewConfig = signal(null);
export const staged = signal({ live: {}, http: {} }); // mirrors server pending
// Transient client-only overrides, set live while a knob is dragged so controls
// and response plots update instantly with no server round-trip per pointer move.
// Committed to `staged` on release, then cleared. Highest priority in effective().
export const liveOverride = signal({});

// --- derived: connection ---
export const reachable = computed(() => !!(health.value && health.value.reachable));
export const alarm = computed(() => !!(health.value && health.value.alarm));
export const modeName = computed(() => (enums.value && enums.value.mode && enums.value.mode.name) || "");
