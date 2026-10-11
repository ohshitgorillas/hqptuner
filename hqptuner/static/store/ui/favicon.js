// Dynamic favicon — the browser-tab icon follows the listening mode (store/matrix/mode.js): 🔊 for speakers,
// 🎧 for headphones. The mode is the fact itself — sniffing the active preset's
// NAME for "headphone"/"speaker" holds only for users who name presets that way.
// Rendered as an inline SVG-text data URI, so no icon files are shipped;
// index.html's static link answers /favicon.ico.
import { effect } from "@preact/signals";
import { matrixMode } from "../matrix/mode.js";

const svg = (/** @type {string} */ emoji) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>`,
  );

/**
 * @param {string} mode
 * @returns {string}
 */
function pick(mode) {
  return mode === "speakers" ? "🔊" : "🎧";
}

/** Keep the browser-tab icon following the listening mode for the life of the page. */
export function initFavicon() {
  effect(() => {
    const link = document.getElementById("favicon");
    if (link instanceof HTMLLinkElement) link.href = svg(pick(matrixMode.value));
  });
}
