// The alerts the faceplate raises and where each one lives. v1 decides every alert already; this renames each to the
// home it lands on and keeps its severity and sentence, with two exceptions: the credentials and Roon lines name the v2
// place to go, the knob and Settings → Timing, where v1's name the status pill and the System tab. The shaper pair
// carries the chain it judges, so a lit row lights on that chain's tab only, and the junk advice is advice, carrying the
// backend's reason as given. v1's failed preset pick is not raised: it tells the user nothing they can act on.

import { computed } from "@preact/signals";
import { alertPlan, alertsAt } from "../../model/shell/alerts.js";
import { credentialsAlert } from "../alerts/credentials.js";
import { engineAlerts } from "../health.js";
import { shaperAlerts } from "../alerts/shaperfit.js";
import { roonIdleAlert } from "../alerts/roonidle.js";
import { junkAdvice } from "../alerts/junkadvice.js";

/** @typedef {import("../../model/shell/alerts.js").Alert} Alert */
/** @typedef {import("../../model/shell/alerts.js").Home} Home */
/** @typedef {import("../../model/shell/alerts.js").Sev} Sev */
/** @typedef {import("../../model/shell/alerts.js").AlertPlan} AlertPlan */
/** @typedef {import("../health.js").Alert} V1Alert */

/**
 * Where each kind lives: stages and drawers by rail id, sections by page section id, header elements by name, fixing
 * rows by catalog key.
 *
 * @type {Record<string, Home>}
 */
const HOMES = {
  credentials: { el: "conn" },
  speed: { el: "gauge" },
  clip: { stage: "volume", drawer: "volume" },
  apod: { stage: "resampling", section: "resampling" },
  shaperSdm: { stage: "shaping", section: "shaping", dark: ["speakers", "output"] },
  shaperPcm: { stage: "shaping", section: "shaping" },
  roon: { el: "gear", set: "timing", drawer: "timing", row: ["idle_time"] },
  junk: { stage: "hf", drawer: "hf", row: ["junk_filter"] },
};

const CREDENTIALS_TEXT =
  "Authentication rejected: username and password are bad. Open connection settings from the knob and try again.";

const ROON_TEXT =
  "Recommend setting Engine idle time (Settings → Timing) to 10 or longer; " +
  "at default idle time, Roon inefficiently restarts the engine between tracks.";

/** v1's engine-health kinds, by the faceplate kind each lands as. @type {Record<string, string>} */
const ENGINE_KIND = { "dsp-speed": "speed", clipping: "clip", apodizing: "apod" };

/** v1's shaper-fit kinds, by the faceplate kind and the chain each judges. @type {Record<string, { kind: string, chain: "pcm" | "sdm" }>} */
const SHAPER_KIND = {
  "shaper-fit-sdm": { kind: "shaperSdm", chain: "sdm" },
  "shaper-fit-pcm": { kind: "shaperPcm", chain: "pcm" },
};

/**
 * One v1 alert as the faceplate raises it.
 *
 * @param {string} kind
 * @param {string} sev
 * @param {string} text
 * @returns {Alert}
 */
const raised = (kind, sev, text) => ({ kind, sev: /** @type {Sev} */ (sev), text });

/**
 * The alerts the faceplate raises, in v1's order: credentials, engine health, the shaper fit, Roon, the junk advice.
 *
 * @returns {Alert[]}
 */
export function faceplateAlerts() {
  const creds = credentialsAlert.value;
  const roon = roonIdleAlert.value;
  const junk = junkAdvice.value;
  return [
    ...(creds ? [raised("credentials", creds.sev, CREDENTIALS_TEXT)] : []),
    ...engineAlerts.value.map((/** @type {V1Alert} */ a) => raised(ENGINE_KIND[a.kind], a.sev, a.text)),
    ...shaperAlerts.value.map((/** @type {V1Alert} */ a) => ({
      ...raised(SHAPER_KIND[a.kind].kind, a.sev, a.text),
      chain: SHAPER_KIND[a.kind].chain,
    })),
    ...(roon ? [raised("roon", roon.sev, ROON_TEXT)] : []),
    ...(junk ? [raised("junk", "advice", junk.reason)] : []),
  ];
}

/**
 * Where the raised alerts land now.
 *
 * @type {{ readonly value: AlertPlan }}
 */
export const alertsNow = computed(() => alertPlan(faceplateAlerts(), HOMES));

/**
 * The alerts a header home's popover shows: those homed on it, in raised order.
 *
 * @param {string} el  the header element's name
 * @returns {Alert[]}
 */
export const alertNotes = (el) => alertsAt(faceplateAlerts(), HOMES, el);
