// The store's source signals: the raw polled trees (engine + config, architecture
// §2) plus the small connection-state computeds over them. Split out so the
// resolution and action layers in state.js sit on top of a module that imports
// nothing from them — the dependency edge only ever runs one way.

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

// --- derived: connection ---
export const reachable = computed(() => !!(health.value && health.value.reachable));
export const alarm = computed(() => !!(health.value && health.value.alarm));
export const modeName = computed(() => (enums.value && enums.value.mode && enums.value.mode.name) || "");
