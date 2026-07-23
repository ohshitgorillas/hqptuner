// Client-only UI state shared between the store and components: the active tab
// and the derived fast-poll cadence. Kept in the store (not in the tab
// component) so state.js can read it without a component->store import cycle.
import { signal, computed } from "@preact/signals";
import { quickSystemUpdates, fastVolumeUpdates } from "./prefs.js";

export const activeTab = signal("output");

// Fast (status/volume) poll cadence. 500 ms only when the user has opted a page
// into quick updates AND is currently looking at it; the default 2 s otherwise.
// Scoping the bump to the active page keeps the extra daemon load off pages the
// user isn't watching.
const FAST_MS = 500;
const DEFAULT_MS = 2000;
export const fastPollMs = computed(() => {
  const t = activeTab.value;
  if (t === "system" && quickSystemUpdates.value) return FAST_MS;
  if (t === "volume" && fastVolumeUpdates.value) return FAST_MS;
  return DEFAULT_MS;
});
