// Dynamic favicon — the tab icon follows the DSP tab's mode: 🔊 for speakers,
// 🎧 for headphones. It used to sniff the active preset's NAME for the words
// "headphone"/"speaker", which was true only for users who named their presets
// that way; the mode is the same fact, stated rather than guessed.
// Rendered as an inline SVG-text data URI, so no icon files are shipped and
// the old /favicon.ico 404 goes away via the static link in index.html.
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
