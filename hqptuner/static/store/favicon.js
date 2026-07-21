// Dynamic favicon — the tab icon follows the ACTIVE preset (the truly-loaded
// config name, never a preview): "headphone" anywhere in the name gets the
// headphones glyph, "speaker" the speaker, anything else the level slider.
// Rendered as an inline SVG-text data URI, so no icon files are shipped and
// the old /favicon.ico 404 goes away via the static link in index.html.
import { effect } from "@preact/signals";
import { activePreset } from "./state.js";

const svg = (emoji) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>`,
  );

function pick(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("headphone")) return "🎧";
  if (n.includes("speaker")) return "🔊";
  return "🎚️";
}

export function initFavicon() {
  effect(() => {
    const link = document.getElementById("favicon");
    if (link) link.href = svg(pick(activePreset.value));
  });
}
