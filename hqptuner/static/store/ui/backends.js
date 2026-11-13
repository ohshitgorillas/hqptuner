// The output backends a daemon offers, and the form field each backend's
// settings ride on. A Linux daemon has one local backend, ALSA; a Windows daemon
// has two, ASIO and WASAPI. Which of them this daemon has is read off its own
// /config form: the `backend` select lists them, and a local backend's device
// field is on the form only where that backend exists.

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
