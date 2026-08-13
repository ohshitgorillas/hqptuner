// Client-only UI state shared between the store and components: the active tab
// and the derived fast-poll cadence. Kept in the store (not in the tab
// component) so store/sync.js can read it without a component->store import cycle.
import { signal, computed } from "@preact/signals";
import { quickSystemUpdates, liveMode } from "./prefs.js";

export const activeTab = signal("output");

// Which shelf the Loudness strip edits ("low" | "high") — client-only UI
// state, never touches the store trees or the server. Lives here so the plot
// (plots.js) can flip it when a corner dot is grabbed without importing from
// the tab component.
export const loudnessSide = signal("low");

// Fast (status/volume) poll cadence: 1 s, the rate at which the daemon's own
// readings move. Scoping the bump to the page being looked at keeps the extra
// load off the ones that aren't.
//
// The volume page and LIVE take it unconditionally: every control on them
// writes to the running engine and the readings beside them are how you judge
// the write, so neither is worth watching at 2 s. LIVE also can't opt in the
// tab way — it is a mode, not a tab (App.js swaps the body while `activeTab`
// still names the tab the user left), so without this test the page would poll
// at 2 s no matter what. The System page keeps its opt-in: its readings are
// diagnostic, not something you are steering against.
const FAST_MS = 1000;
const DEFAULT_MS = 2000;
export const fastPollMs = computed(() => {
  if (liveMode.value) return FAST_MS;
  const t = activeTab.value;
  if (t === "volume") return FAST_MS;
  if (t === "system" && quickSystemUpdates.value) return FAST_MS;
  return DEFAULT_MS;
});
