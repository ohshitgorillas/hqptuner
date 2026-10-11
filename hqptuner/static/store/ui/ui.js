// Client-only UI state shared between the store and components. Kept in the
// store (not in a component) so the store can read it without a
// component->store import cycle.
import { signal } from "@preact/signals";

// Which side of the Loudness drawer's Bass | Treble switch is shown ("low" |
// "high") — client-only UI state, never touches the store trees or the server.
// The drawer's store half (store/faceplate/drawers/loudness.js) sets it from the
// switch and when a plot handle is grabbed, and reads it for the switch's dots;
// components/faceplate/drawers/loudness/Bands.js draws the shown side's rows.
export const loudnessSide = signal("low");
