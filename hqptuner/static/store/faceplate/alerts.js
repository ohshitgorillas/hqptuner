// The alerts the faceplate raises and where each one lives. Each alert keeps the severity and sentence its source
// store decides. The shaper pair carries the chain it judges, so a lit row lights on that chain's tab only, and the junk
// advice is advice, carrying the backend's reason as given.

import { computed } from "@preact/signals";
import { alertPlan, alertsAt } from "../../model/shell/alerts.js";
import { credentialsAlert } from "../alerts/credentials.js";
import { droppedAlert } from "../alerts/dropped.js";
import { engineAlerts } from "../health.js";
import { shaperAlerts } from "../alerts/shaperfit.js";
import { roonIdleAlert } from "../alerts/roonidle.js";
import { junkAdvice } from "../alerts/junkadvice.js";
import { AFTER_SHAPING } from "./chain.js";

/** @typedef {import("../../model/shell/alerts.js").Alert} Alert */
/** @typedef {import("../../model/shell/alerts.js").Home} Home */
/** @typedef {import("../../model/shell/alerts.js").Sev} Sev */
/** @typedef {import("../../model/shell/alerts.js").AlertPlan} AlertPlan */
/** @typedef {import("../health.js").Alert} SourceAlert */

/**
 * Where each kind lives: stages and drawers by rail id, sections by page section id, header elements by name, fixing
 * rows by catalog key, and `plate` for a line the plate shows under its top bar.
 *
 * @type {Record<string, Home>}
 */
const HOMES = {
  credentials: { el: "conn" },
  engine: { plate: true },
  speed: { el: "gauge" },
  clip: { stage: "volume", drawer: "volume" },
  apod: { stage: "resampling", section: "resampling" },
  shaperSdm: { stage: "shaping", section: "shaping", dark: AFTER_SHAPING },
  shaperPcm: { stage: "shaping", section: "shaping" },
  roon: { el: "gear", set: "timing", drawer: "timing", row: ["idle_time"] },
  junk: { stage: "hf", drawer: "hf", row: ["junk_filter"] },
};

/** The engine-health kinds (store/health.js), by the faceplate kind each lands as. @type {Record<string, string>} */
const ENGINE_KIND = { "dsp-speed": "speed", clipping: "clip", apodizing: "apod" };

/** The shaper-fit kinds (store/alerts/shaperfit.js), by the faceplate kind and the chain each judges. @type {Record<string, { kind: string, chain: "pcm" | "sdm" }>} */
const SHAPER_KIND = {
  "shaper-fit-sdm": { kind: "shaperSdm", chain: "sdm" },
  "shaper-fit-pcm": { kind: "shaperPcm", chain: "pcm" },
};

/**
 * One source store's alert as the faceplate raises it.
 *
 * @param {string} kind
 * @param {string} sev
 * @param {string} text
 * @returns {Alert}
 */
const raised = (kind, sev, text) => ({ kind, sev: /** @type {Sev} */ (sev), text });

/**
 * The alerts the faceplate raises, in this order: credentials, the settings a daemon restart dropped, engine health,
 * the shaper fit, Roon, the junk advice.
 *
 * @returns {Alert[]}
 */
export function faceplateAlerts() {
  const creds = credentialsAlert.value;
  const dropped = droppedAlert.value;
  const roon = roonIdleAlert.value;
  const junk = junkAdvice.value;
  return [
    ...(creds ? [raised("credentials", creds.sev, creds.text)] : []),
    ...(dropped ? [{ ...raised("engine", dropped.sev, dropped.text), items: dropped.items, act: dropped.act }] : []),
    ...engineAlerts.value.map((/** @type {SourceAlert} */ a) => raised(ENGINE_KIND[a.kind], a.sev, a.text)),
    ...shaperAlerts.value.map((/** @type {SourceAlert} */ a) => ({
      ...raised(SHAPER_KIND[a.kind].kind, a.sev, a.text),
      chain: SHAPER_KIND[a.kind].chain,
    })),
    ...(roon ? [raised("roon", roon.sev, roon.text)] : []),
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
