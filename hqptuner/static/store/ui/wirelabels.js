// The UI label for a wire key: the daemon's /config form field name (an entry's
// `field`) or a live setter key (its `liveKey`), mapped to the label the page
// gives the control that reads it. A control's catalog key can differ from its
// wire key (`optimal_iso` writes `volume_fixed`), so the map is built from the
// wire names, not from the catalog keys. A wire key no control reads has no
// label and is shown as itself. The same labels word a failed live write.
import { schema } from "../schema.js";

/** @type {Map<string, string>} */
const LABELS = new Map();
for (const entry of Object.values(schema)) {
  for (const wire of [entry.field, entry.liveKey]) {
    if (wire && entry.label) LABELS.set(wire, entry.label);
  }
}

/**
 * The UI label for one wire key.
 * @param {string} key a /config form field or a live setter key
 * @returns {string} the control's UI label, or the key itself when no control reads it
 */
export const wireLabel = (key) => LABELS.get(key) ?? key;

// A failed live write in the page's words, shared by the apply verdict and the
// LIVE view's per-control and live-preset error. An engine that stopped
// answering explains every other failure in the same write, so one such entry
// makes the whole list one sentence naming every failed setting. Otherwise each
// refused setting gets its own sentence with the daemon's reason, and one that
// came back with no reason ends at its label. The reason's own trailing full
// stops are dropped so the sentence ends in exactly one.
/**
 * The sentence for the live setters that failed, each named by its UI label.
 * @param {{ setting: string, error?: string, code?: string }[]} fails the setters that failed
 * @returns {string}
 */
export function liveFailureText(fails) {
  if (fails.some((f) => f.code === "daemon_unavailable")) {
    return `HQPlayer stopped answering while setting ${fails.map((f) => wireLabel(f.setting)).join(", ")}.`;
  }
  return fails.map(refusalText).join(" ");
}

/**
 * @param {{ setting: string, error?: string }} fail
 * @returns {string}
 */
function refusalText(fail) {
  let reason = (fail.error || "").trimEnd();
  while (reason.endsWith(".")) reason = reason.slice(0, -1);
  const label = wireLabel(fail.setting);
  return reason ? `HQPlayer refused ${label}: ${reason}.` : `HQPlayer refused ${label}.`;
}
