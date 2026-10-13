// The calls whose failure the plate shows: an apply, a live write, a live snapshot, a profile description, a favorite
// and the narrowing facets. Each area whose last call failed raises one warning line carrying that area's own sentence;
// the line goes when the area next succeeds, or when it is tapped, which clears the area's error.
import { computed } from "@preact/signals";
import { lastApply } from "../signals.js";
import { liveWriteError } from "../live/write.js";
import { livePresetError } from "../live/presets.js";
import { descriptionError } from "../matrix/descriptions.js";
import { favoritesError } from "../narrow/favorites.js";
import { narrowingError } from "../narrow/persist.js";

/** @typedef {{ kind: string, sev: "warn", text: string, act: () => void }} FailureAlert */

/**
 * One area's line while `text` holds its failure, none while it is empty.
 *
 * @param {string} kind
 * @param {string} text
 * @param {() => void} clear  what tapping the line does
 * @returns {FailureAlert[]}
 */
const line = (kind, text, clear) => (text ? [{ kind, sev: "warn", text, act: clear }] : []);

/**
 * The line an area's error signal raises; tapping it empties the signal.
 *
 * @param {string} kind
 * @param {{ value: string }} error
 * @returns {FailureAlert[]}
 */
const errorLine = (kind, error) =>
  line(kind, error.value, () => {
    error.value = "";
  });

/**
 * The failed areas' lines, in this order: apply, live write, snapshot, profile description, favorite, narrowing.
 *
 * @type {{ readonly value: FailureAlert[] }}
 */
export const failureAlerts = computed(() => {
  const verdict = lastApply.value;
  return [
    ...line("apply-failed", verdict && !verdict.ok ? verdict.text : "", () => {
      lastApply.value = null;
    }),
    ...errorLine("live-write-failed", liveWriteError),
    ...errorLine("snapshot-failed", livePresetError),
    ...errorLine("description-failed", descriptionError),
    ...errorLine("favorite-failed", favoritesError),
    ...errorLine("narrowing-failed", narrowingError),
  ];
});
