// The faceplate's Visual settings: the accent swatches, the accent tokens a pick derives, and the theme stamped on a
// root from the theme store's live accent, custom hex and dyslexic switch.

import { effect } from "@preact/signals";

import { effectOf } from "../../../model/shell/settings.js";
import { ACCENT_HEX, accent, accentHex, dyslexic } from "../../ui/theme.js";

/**
 * @typedef {{ v: string, label: string, hex: string }} Accent
 * @typedef {{ value: string, label: string }} AccentOption
 * @typedef {{ style: { setProperty: (name: string, value: string) => void }, dataset: DOMStringMap }} ThemeRoot
 */

/** @type {readonly Accent[]} */
export const ACCENTS = [
  { v: "amber", label: "Amber", hex: ACCENT_HEX.amber },
  { v: "blue", label: "Blue", hex: ACCENT_HEX.blue },
  { v: "green", label: "Phosphor green", hex: ACCENT_HEX.green },
  { v: "violet", label: "Violet", hex: ACCENT_HEX.violet },
];

/** @type {readonly AccentOption[]} */
export const ACCENT_OPTIONS = ACCENTS.map(({ v, label }) => ({ value: v, label }));

/**
 * The four accent tokens for a swatch name and an optional custom hex: the custom hex when set, else the named
 * swatch's, else amber's.
 *
 * @param {string} name
 * @param {string} hex
 * @returns {Record<string, string>}
 */
export function accentTokens(name, hex) {
  const pick = hex || (ACCENTS.find((a) => a.v === name)?.hex ?? ACCENT_HEX.amber);
  const fx = /** @type {{ tokens: Record<string, string> }} */ (effectOf("vacc", pick, ACCENTS, []));
  return fx.tokens;
}

/**
 * Stamp the live accent tokens and dyslexic switch on a root.
 *
 * @param {ThemeRoot} root
 * @returns {void}
 */
export function applyFaceplateTheme(root) {
  for (const [name, value] of Object.entries(accentTokens(accent.value, accentHex.value))) {
    root.style.setProperty(name, value);
  }
  if (dyslexic.value) root.dataset.dyslexic = "1";
  else delete root.dataset.dyslexic;
}

/**
 * Reapply the theme to a root on every change; returns the dispose.
 *
 * @param {ThemeRoot} root
 * @returns {() => void}
 */
export function watchFaceplateTheme(root) {
  return effect(() => applyFaceplateTheme(root));
}
