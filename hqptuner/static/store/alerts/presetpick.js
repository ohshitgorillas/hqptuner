// A preset pick or delete that failed — one alert-strip row.
//
// Every other write failure is reported by the pending bar's result line, which
// the LIVE page does not put on screen (components/App.js), so a pick that failed
// there told the user nothing at all. The strip is in the chrome, present in both
// modes, which is why the failure belongs on it.
//
// An event rather than a state, unlike every other row on this strip: what makes
// "the last preset action failed" untrue is another attempt, so the next pick or
// delete clears it. Deliberately NOT cleared on a reconnect — `connected_at` is
// rewritten by every poll, so a connection-keyed rule would drop the row about a
// second after it appeared.
import { computed, signal } from "@preact/signals";

/** The reason the last preset pick or delete failed, or null when the last one was fine. */
export const presetPickFailure = /** @type {{ value: string | null }} */ (signal(null));

/** The failed-preset-action row for the strip, or null when nothing has failed. */
export const presetPickAlert = computed(() => {
  const reason = presetPickFailure.value;
  if (!reason) return null;
  return { kind: "preset-pick", sev: "warn", text: `Preset action failed: ${reason}` };
});
