// The spectrum delay: how far behind the meter feed the meters, the spectrum and the spectrogram run, in seconds, so
// the user can line them up with what they hear. Held in localStorage like every UI pref.
import { signal } from "@preact/signals";
import { warnStorage } from "../ui/prefs.js";

const K_SPECTRUM_DELAY = "hqptuner.spectrumDelay";
const SPECTRUM_DELAY_MAX = 5;

/**
 * A typed delay as seconds within range, or null where the text is no number.
 *
 * @param {string | number | null} text
 * @returns {number | null}
 */
function delayOf(text) {
  if (text == null || String(text).trim() === "") return null;
  const v = Number(text);
  return Number.isFinite(v) ? Math.min(SPECTRUM_DELAY_MAX, Math.max(0, v)) : null;
}

/** @returns {number} */
function loadDelay() {
  try {
    return delayOf(localStorage.getItem(K_SPECTRUM_DELAY)) ?? 0.25;
  } catch {
    warnStorage("read");
    return 0.25;
  }
}

export const spectrumDelay = signal(loadDelay());

/**
 * Set the spectrum delay from what the user typed, clamped to 0 to 5 s; text that is no number changes nothing.
 *
 * @param {string | number} text
 */
export function setSpectrumDelay(text) {
  const v = delayOf(text);
  if (v == null) return;
  spectrumDelay.value = v;
  try {
    localStorage.setItem(K_SPECTRUM_DELAY, String(v));
  } catch {
    // storage disabled (private mode) — keep the in-memory value
    warnStorage("written");
  }
}
