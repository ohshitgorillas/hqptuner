// The spectrum delay: how far behind the meter feed the meters, the spectrum and the spectrogram run, in seconds, so
// the user sees them in step with what they hear. The engine reports its own output delay with every status poll; the
// user's offset, held in localStorage like every UI pref, moves the meters from there, and together they never put the
// meters ahead of the feed.
import { computed, signal } from "@preact/signals";
import { engineStatus } from "../signals.js";
import { warnStorage } from "../ui/prefs.js";

const K_SPECTRUM_OFFSET = "hqptuner.spectrumOffset";
const SPECTRUM_OFFSET_MAX = 5;
const US_PER_S = 1e6;

/**
 * A typed offset as seconds within range, or null where the text is no number.
 *
 * @param {string | number | null} text
 * @returns {number | null}
 */
function offsetOf(text) {
  if (text == null || String(text).trim() === "") return null;
  const v = Number(text);
  return Number.isFinite(v) ? Math.min(SPECTRUM_OFFSET_MAX, Math.max(-SPECTRUM_OFFSET_MAX, v)) : null;
}

/** @returns {number} */
function loadOffset() {
  try {
    return offsetOf(localStorage.getItem(K_SPECTRUM_OFFSET)) ?? 0;
  } catch {
    warnStorage("read");
    return 0;
  }
}

export const spectrumOffset = signal(loadOffset());

/**
 * Set the spectrum offset from what the user typed, clamped to -5 to 5 s; text that is no number changes nothing.
 *
 * @param {string | number} text
 */
export function setSpectrumOffset(text) {
  const v = offsetOf(text);
  if (v == null) return;
  spectrumOffset.value = v;
  try {
    localStorage.setItem(K_SPECTRUM_OFFSET, String(v));
  } catch {
    // storage disabled (private mode) — keep the in-memory value
    warnStorage("written");
  }
}

/** The output delay the engine reports, in seconds, or null where it reports none, no number, or zero. */
export const engineDelay = computed(() => {
  const us = Number(((engineStatus.value || {}).status || {}).output_delay);
  return Number.isFinite(us) && us !== 0 ? us / US_PER_S : null;
});

/** How far behind the feed the meters run, in seconds: the engine's output delay plus the offset, never below zero. */
export const effectiveDelay = computed(() => Math.max(0, (engineDelay.value ?? 0) + spectrumOffset.value));
