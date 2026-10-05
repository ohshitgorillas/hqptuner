// The output backends a daemon offers, and the form field each backend's
// settings ride on. A Linux daemon has one local backend, ALSA; a Windows daemon
// has two, ASIO and WASAPI. Which of them this daemon has is read off its own
// /config form: the `backend` select lists them, and a local backend's device
// field is on the form only where that backend exists.

import { configByName } from "../resolve.js";
import { optionsFor } from "./options.js";

/** @type {Record<string, string>} */
export const BACKEND_LABELS = { alsa: "ALSA", asio: "ASIO", wasapi: "WASAPI", network: "Network", combo: "Combo" };

// What the switch offers until the form has listed its own.
const DEFAULT_BACKENDS = ["alsa", "network", "combo"];
const LOCAL = ["alsa", "asio", "wasapi"];
// The prefix a backend's own form fields carry. Combo has none: it runs the
// other backends' devices and owns no field.
/** @type {Record<string, string>} */
const PREFIX = { alsa: "alsa", asio: "asio", wasapi: "wasapi", network: "net" };

/**
 * The form field holding one setting of one backend, e.g. `net_device`; "" for a
 * backend that owns no fields.
 * @param {string} backend the backend's wire value
 * @param {string} setting `device`, `dop`, `anydsd`, …
 * @returns {string}
 */
export function fieldOf(backend, setting) {
  const prefix = PREFIX[backend];
  return prefix ? `${prefix}_${setting}` : "";
}

/**
 * The backends the switch offers: the ones the daemon's form lists, in its order.
 * @returns {SchemaOption[]}
 */
export function backendOptions() {
  const listed = optionsFor("config", "backend").map((o) => String(o.value));
  const values = listed.length ? listed : DEFAULT_BACKENDS;
  return values.map((value) => ({ value, label: BACKEND_LABELS[value] || value }));
}

/**
 * The local backends this daemon has, by the device fields its form carries;
 * ALSA alone while the form carries none of them.
 * @returns {string[]}
 */
export function localBackends() {
  const fields = configByName.value;
  const present = LOCAL.filter((backend) => fieldOf(backend, "device") in fields);
  return present.length ? present : ["alsa"];
}
