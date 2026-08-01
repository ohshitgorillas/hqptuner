// Client-only UI preference: the signature accent color. Persisted in
// localStorage and applied as `data-accent` on <html>; the CSS owns the actual
// color values (`:root[data-accent="…"]`). No daemon involvement — pure chrome.
//
// Module load must stay node-safe (the SSR harness imports the component graph
// with no `localStorage`/`document`): the storage read is guarded, and the
// document is only touched inside functions the browser entry point calls.
import { signal } from "@preact/signals";

const KEY = "hqptuner.accent";
const KEY_HEX = "hqptuner.accentHex";
export const ACCENTS = ["blue", "green", "amber", "violet"];
const DEFAULT = "blue";
// each preset's --accent value (mirrors the :root[data-accent] CSS) — fills the
// hex box when a swatch is picked, so custom colors start from the preset
export const ACCENT_HEX = {
  blue: "#4f9dde",
  green: "#3fe0a0",
  amber: "#e0a63a",
  violet: "#a78bfa",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function load() {
  try {
    const v = localStorage.getItem(KEY);
    return ACCENTS.includes(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function loadHex() {
  try {
    const v = localStorage.getItem(KEY_HEX);
    return HEX_RE.test(v || "") ? v : "";
  } catch {
    return "";
  }
}

export const accent = signal(load());
export const accentHex = signal(loadHex()); // "" = follow the preset swatch

// --accent-glow is the brighter hero sibling; derive it from a custom hex by
// pulling each channel 30% toward white (matches the presets' glow relationship)
function glowOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => {
    const c = (n >> s) & 255;
    return Math.round(c + (255 - c) * 0.3)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function setInline(hex) {
  const st = document.documentElement.style;
  if (hex) {
    st.setProperty("--accent", hex);
    st.setProperty("--accent-glow", glowOf(hex));
  } else {
    st.removeProperty("--accent");
    st.removeProperty("--accent-glow");
  }
}

// Persist + apply a preset swatch. Sets the root attribute the CSS keys on and
// drops any custom-hex override, so the swap is instant and every accent site
// follows from the one variable.
export function applyAccent(name) {
  const v = ACCENTS.includes(name) ? name : DEFAULT;
  accent.value = v;
  accentHex.value = "";
  document.documentElement.dataset.accent = v;
  setInline("");
  try {
    localStorage.setItem(KEY, v);
    localStorage.removeItem(KEY_HEX);
  } catch {
    /* storage disabled (private mode) — keep the in-memory value */
  }
}

// Persist + apply a custom hex, overriding the preset via inline --accent.
// Invalid input is ignored (the box simply doesn't take).
export function applyAccentHex(hex) {
  const v = (hex || "").trim().startsWith("#") ? hex.trim() : `#${(hex || "").trim()}`;
  if (!HEX_RE.test(v)) return;
  accentHex.value = v;
  setInline(v);
  try {
    localStorage.setItem(KEY_HEX, v);
  } catch {
    /* storage disabled — keep the in-memory value */
  }
}

// Stamp the root attribute (and any custom hex) at boot — no first-paint flash.
export function initAccent() {
  document.documentElement.dataset.accent = accent.value;
  if (accentHex.value) setInline(accentHex.value);
}
