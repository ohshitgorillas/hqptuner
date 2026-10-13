// Client-only UI preferences: the signature accent color (a preset name or a
// custom hex, from which the faceplate theme derives the `--acc` tokens on
// <html>) and the dyslexic font switch (`data-dyslexic` on <html>, which swaps
// `--font-ui`). Both persisted in localStorage. No daemon involvement — pure
// chrome.
//
// Module load must stay node-safe (the SSR harness imports the component graph
// with no `localStorage`/`document`): the storage read is guarded, and the
// document is only touched inside functions the browser entry point calls.
import { signal } from "@preact/signals";
import { getStored, removeStored, setStored } from "../../lib/browser/storage.js";

const KEY = "hqptuner.accent";
const KEY_HEX = "hqptuner.accentHex";
const KEY_DYSLEXIC = "hqptuner.dyslexic";
const ACCENTS = ["blue", "green", "amber", "violet"];
const DEFAULT = "amber";
// each preset's color, the hex the faceplate theme derives the `--acc` tokens
// from when no custom hex is set
/** @type {Record<string, string>} */
export const ACCENT_HEX = {
  blue: "#4f9dde",
  green: "#3fe0a0",
  amber: "#e9a63c",
  violet: "#a78bfa",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function load() {
  const stored = getStored(KEY);
  if (!stored.ok) return DEFAULT;
  const v = stored.value || "";
  return ACCENTS.includes(v) ? v : DEFAULT;
}

function loadHex() {
  const stored = getStored(KEY_HEX);
  if (!stored.ok) return "";
  const v = stored.value;
  return HEX_RE.test(v || "") ? v : "";
}

function loadDyslexic() {
  const stored = getStored(KEY_DYSLEXIC);
  if (!stored.ok) return false;
  return stored.value === "1";
}

export const accent = signal(load());
export const accentHex = signal(loadHex()); // "" = follow the preset swatch
export const dyslexic = signal(loadDyslexic()); // true = Atkinson Hyperlegible for --font-ui

// Persist a preset swatch and drop any custom-hex override; the faceplate
// theme restyles the page from the two signals.
/**
 * Persist and apply a preset accent swatch, dropping any custom-hex override.
 * @param {string} name
 * @returns {void}
 */
export function applyAccent(name) {
  const v = ACCENTS.includes(name) ? name : DEFAULT;
  accent.value = v;
  accentHex.value = "";
  // storage disabled (private mode) — keep the in-memory value
  if (setStored(KEY, v)) removeStored(KEY_HEX);
}

// Persist a custom hex, which overrides the preset swatch.
// Invalid input is ignored (the box simply doesn't take).
/**
 * Persist and apply a custom accent hex, with or without its leading `#`.
 * @param {string} hex
 * @returns {void}
 */
export function applyAccentHex(hex) {
  const v = (hex || "").trim().startsWith("#") ? hex.trim() : `#${(hex || "").trim()}`;
  if (!HEX_RE.test(v)) return;
  accentHex.value = v;
  // storage disabled — keep the in-memory value
  setStored(KEY_HEX, v);
}

// The dyslexic font is one attribute on the root and a CSS rule keyed off it;
// absent means the default typeface, so the off state deletes rather than
// writing a falsy value.
/**
 * @param {boolean} on
 * @returns {void}
 */
function stampDyslexic(on) {
  const root = document.documentElement;
  if (on) root.dataset.dyslexic = "1";
  else delete root.dataset.dyslexic;
}

/**
 * Persist and apply the dyslexic font switch.
 * @param {boolean} on
 * @returns {void}
 */
export function applyDyslexic(on) {
  dyslexic.value = !!on;
  stampDyslexic(dyslexic.value);
  // storage disabled (private mode) — keep the in-memory value
  setStored(KEY_DYSLEXIC, dyslexic.value ? "1" : "0");
}
