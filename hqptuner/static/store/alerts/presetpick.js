// A preset pick or delete that failed — one alert-strip row.
//
// It belongs on the strip rather than beside the picker: nothing in the header's
// right cluster renders conditionally, because text appearing and disappearing
// there shifts the status pill and every element around it. The strip is the
// app's fault surface, already carries the lane faults this sits beside, and
// costs the header no width.
//
// The failure is transient rather than polled, so unlike the other rows in this
// directory it has a signal behind it: the header writes it on a rejected pick
// and clears it on the next one that works.
import { signal, computed } from "@preact/signals";

/** The last preset pick or delete that failed, or null when the last one worked. */
export const presetPickFailed = signal(/** @type {{action: string, name: string} | null} */ (null));

// Owner-approved copy, verbatim (CLAUDE.md): reworded only with its own approval.
const MESSAGES = {
  load: (/** @type {string} */ name) => `Preset "${name}" did not load. The engine refused it or did not answer.`,
  delete: (/** @type {string} */ name) => `Preset "${name}" was not deleted. The engine refused it or did not answer.`,
};

/** The failed-preset-action alert row for the strip, or null when the last pick worked. */
export const presetPickAlert = computed(() => {
  const failed = presetPickFailed.value;
  if (!failed) return null;
  const message = failed.action === "delete" ? MESSAGES.delete : MESSAGES.load;
  return { kind: "preset-pick-failed", sev: "warn", text: message(failed.name) };
});
