// The UI label for a wire key: the daemon's /config form field name (an entry's
// `field`) or a live setter key (its `liveKey`), mapped to the name the page
// gives the control that reads it. A control's catalog key can differ from its
// wire key (`optimal_iso` writes `volume_fixed`), so the map is built from the
// wire names, not from the catalog keys. The name is resolved the way the page
// resolves it: the control's own label, else the name its /api/metadata entry
// gives it, which is why it is looked up on each call rather than at load. A
// wire key no control reads, or one whose control has no name anywhere, is
// shown as itself. The same labels word a failed live write.
import { endSentence } from "../../lib/errtext.js";
import { describe } from "../prose.js";
import { schema } from "../schema.js";

/** @type {Map<string, [string, SchemaField]>} */
const CONTROLS = new Map();
for (const [key, entry] of Object.entries(schema)) {
  for (const wire of [entry.field, entry.liveKey]) {
    if (wire) CONTROLS.set(wire, [key, entry]);
  }
}

/**
 * The UI label for one wire key.
 * @param {string} key a /config form field or a live setter key
 * @returns {string} the control's UI label, or the key itself when no control reads it or none is named
 */
export function wireLabel(key) {
  const control = CONTROLS.get(key);
  if (!control) return key;
  const [catalogKey, entry] = control;
  if (entry.label) return entry.label;
  const { label } = describe(entry, catalogKey);
  return label === catalogKey ? key : label;
}

/**
 * Whether one engine that stopped answering decides a failed live write: such
 * an entry explains every other failure in the same write.
 * @param {{ code?: string }[]} fails the setters that failed
 * @returns {boolean}
 */
export const engineStopped = (fails) => fails.some((f) => f.code === "daemon_unavailable");

// A failed live write in the page's words, shared by the apply verdict and the
// LIVE view's per-control and live-preset error. An engine that stopped
// answering explains every other failure in the same write, so one such entry
// makes the whole list one sentence naming every failed setting. Otherwise each
// failed setting gets its own sentence. One HQPTuner refused before sending it
// (`invalid_input`) says so, so it never reads as a refusal by HQPlayer: a
// volume level that is not a number is quoted back from what was sent, and any
// other setting went out without a value. One HQPlayer refused carries the
// daemon's reason, and one that came back with no reason ends at its label. The
// reason's own trailing full stops are dropped so the sentence ends in exactly
// one.
/**
 * The sentence for the live setters that failed, each named by its UI label.
 * @param {{ setting: string, error?: string, code?: string }[]} fails the setters that failed
 * @param {Record<string, string | undefined>} [sent] the value sent for each setter key, where the caller knows it
 * @returns {string}
 */
export function liveFailureText(fails, sent = {}) {
  if (engineStopped(fails)) {
    return `HQPlayer stopped answering while setting ${fails.map((f) => wireLabel(f.setting)).join(", ")}.`;
  }
  return fails
    .map((f) => (f.code === "invalid_input" ? rejectedText(f.setting, sent[f.setting]) : refusalText(f)))
    .join(" ");
}

// The report names only the setting, so the level quoted back is the one the
// caller sent. A volume sent with no value at all is the generic case.
/**
 * @param {string} setting
 * @param {string | undefined} value what was sent for it, undefined when unknown or absent
 * @returns {string}
 */
function rejectedText(setting, value) {
  if (setting === "volume" && value !== undefined) return `Volume must be a number, not "${value}".`;
  return `HQPTuner sent ${wireLabel(setting)} without a value.`;
}

/**
 * @param {{ setting: string, error?: string }} fail
 * @returns {string}
 */
function refusalText(fail) {
  const reason = endSentence(fail.error || "");
  const label = wireLabel(fail.setting);
  return reason === "." ? `HQPlayer refused ${label}.` : `HQPlayer refused ${label}: ${reason}`;
}
