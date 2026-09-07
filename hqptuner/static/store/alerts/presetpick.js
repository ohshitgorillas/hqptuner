// A preset pick or delete that failed — one alert-strip row.
//
// The header used to print this beside the picker, where the text appeared and
// disappeared under the status pill and shifted every element in that cluster.
// The strip is already the app's fault surface and already carries the lane
// faults this sits beside, and it costs the header no width at all.
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
