// The one playhead: where the meters stand in playback, as the meter loop
// (store/meter/loop.js) moves it each paint. Every view of playback reads this signal and keeps no position of its own.
import { signal } from "@preact/signals";

/**
 * Where the playhead stands, playback ms; null while the meter loop is idle, and after a reset until it next stands
 * anywhere. Written by the meter loop alone.
 */
export const playhead = signal(/** @type {number | null} */ (null));
