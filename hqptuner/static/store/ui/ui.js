// Client-only UI state shared between the store and components. Kept in the
// store (not in a component) so the store can read it without a
// component->store import cycle.
import { signal } from "@preact/signals";

// Which shelf the Loudness strip edits ("low" | "high") — client-only UI
// state, never touches the store trees or the server. Lives here so the plot
// (plots.js) can flip it when a corner dot is grabbed without importing from
// the tab component.
export const loudnessSide = signal("low");
