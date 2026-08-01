// Dynamic favicon — the tab icon follows the DSP tab's mode: 🔊 for speakers,
// 🎧 for headphones. The mode is the fact itself — sniffing the active preset's
// NAME for "headphone"/"speaker" holds only for users who name presets that way.
// Rendered as an inline SVG-text data URI, so no icon files are shipped;
// index.html's static link answers /favicon.ico.
import { effect } from "@preact/signals";
import { dspMode } from "./dspmode.js";

const svg = (emoji) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>`,
  );

function pick(mode) {
  return mode === "speakers" ? "🔊" : "🎧";
}

export function initFavicon() {
  effect(() => {
    const link = document.getElementById("favicon");
    if (link instanceof HTMLLinkElement) link.href = svg(pick(dspMode.value));
  });
}
