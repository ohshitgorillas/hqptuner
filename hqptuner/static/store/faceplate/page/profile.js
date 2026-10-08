// The page's Matrix profile section: the choices its select offers, the live switch, and the running profile's
// description. The switch is v1's LIVE card's (components/live/MatrixProfile.js): MatrixSetProfile is a live switch, not
// a config field, so it never stages; the daemon reaches only the profiles it read at startup, and a saved name it did
// not read is offered disabled. The description is the stored one for the profile running, edited in place: an edit
// shows at once and is written when the typist pauses or the well loses focus (store/matrix/descriptions.js).

import { signal } from "@preact/signals";
import { api } from "../../../lib/api.js";
import { errText } from "../../../lib/errtext.js";
import { refreshConfig } from "../../sync.js";
import { savedProfiles, matrixActiveProfile, isLiveProfile } from "../../matrix/profiles.js";
import { descriptionFor, queueDescription, flushDescriptions } from "../../matrix/descriptions.js";

/** The daemon's own name for the profile that has none (hqplayerd readme §1.12), its select value "". */
const UNNAMED = "[Default]";

/**
 * One option of the select: its value on the wire, its label, and whether a live switch can reach it.
 *
 * @typedef {{ value: string, label: string, disabled: boolean, reason: string }} ProfileChoice
 */

/** A switch is in flight. */
const busy = signal(false);
/** How many switches have not settled: up from a switch's start until the forms are re-read behind it. */
const switching = signal(0);
/** The last refused switch, as the server's own sentence; "" once a switch goes through. */
const error = signal("");
/** What the user typed into the well and for which profile, until the stored copy catches up. */
const draft = signal(/** @type {{ name: string, text: string } | null} */ (null));

/**
 * The select: its value (the running profile, "" for the unnamed one), its options (the unnamed profile, then every
 * saved name, a name the engine did not load disabled), whether a switch is in flight, and the last refusal.
 *
 * @returns {{ value: string, options: ProfileChoice[], busy: boolean, error: string }}
 */
export function profileChoices() {
  const active = matrixActiveProfile.value;
  return {
    value: active === UNNAMED ? "" : active,
    options: [
      { value: "", label: UNNAMED, disabled: false, reason: "" },
      ...savedProfiles.value.map((/** @type {string} */ n) => {
        const live = isLiveProfile(n);
        return { value: n, label: n, disabled: !live, reason: live ? "" : "not loaded by the engine" };
      }),
    ],
    busy: busy.value,
    error: error.value,
  };
}

/**
 * Switch the running matrix to a profile, then re-read the forms so the select follows what the engine reports. A
 * refusal leaves the server's sentence for the section to print.
 *
 * @param {string} name  "" for the unnamed profile
 * @returns {Promise<void>}
 */
export async function switchProfile(name) {
  switching.value += 1;
  busy.value = true;
  error.value = "";
  try {
    await api.matrixProfile("switch", name);
    await refreshConfig();
  } catch (e) {
    error.value = errText(e);
  } finally {
    busy.value = false;
    switching.value -= 1;
  }
}

/**
 * How many profile switches have not settled; the running profile read is current only while it is 0.
 *
 * @returns {number}
 */
export const profileUnsettled = () => switching.value;

/**
 * The running profile's description: what the user is typing for it, else its stored text, else "".
 *
 * @returns {{ name: string, text: string }}
 */
export function profileDescription() {
  const name = matrixActiveProfile.value;
  const typed = draft.value;
  if (typed && typed.name === name) return typed;
  return { name, text: descriptionFor(name)?.text || "" };
}

/**
 * An edit in the well: shown at once, queued for the running profile.
 *
 * @param {string} text
 */
export function editDescription(text) {
  const name = matrixActiveProfile.value;
  draft.value = { name, text };
  queueDescription(name, text);
}

/**
 * The well losing focus: what is queued is written now, and the typed copy gives way to the stored one once they agree.
 * A refused write keeps it, so the paragraph stays in front of the user.
 *
 * @returns {Promise<void>}
 */
export async function leaveDescription() {
  await flushDescriptions();
  const typed = draft.value;
  if (typed && (descriptionFor(typed.name)?.text || "") === typed.text) draft.value = null;
}
