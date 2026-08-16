// Pure helpers for the narrowing bar: the button summary labels, the
// multi-select toggle transforms, and the per-option preview counts. Its own
// module because none of it renders anything — every function here is a plain
// value-in / value-out read of the narrowing signals, shared by the widgets and
// the facet assembly.
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/options.js";
import { nGenre, nGenreMode, nFocus, nFocusMode, nOddRateOnly, nDownsafeOnly } from "../../store/narrowing.js";
import { previewCount, effHideLimited } from "../../store/narrowmatch.js";
import { GENRES, FOCUS } from "./facet-data.js";

/**
 * @typedef {{ genre?: string[], genreMode?: string, quality?: number, focus?: string[], focusMode?: string,
 *             phase?: string, length?: string,
 *             hideLimited?: boolean, oddOnly?: boolean, downsafeOnly?: boolean, apod?: boolean, half?: boolean,
 *             lossy?: string }} NarrowOverrides
 *   A partial facet selection laid over the live one — what a candidate pick
 *   would produce, which is what the count chips are counted against
 *   (store/narrowing.js buildSel names the full set).
 * @typedef {{ value: (string | number)[] }} MultiSignal
 */

/**
 * Toggles a value in a multi-select signal: adds it if absent, removes it if present.
 * @param {MultiSignal} sig
 * @param {string | number} v
 * @returns {void}
 */
export function toggleIn(sig, v) {
  const cur = sig.value;
  sig.value = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

// The combine mode only reaches a button label once it can change the result —
// at two picks. One pick or none, the mode is inert and naming it would report a
// setting that is doing nothing.
const withMode = (/** @type {string} */ text, /** @type {string} */ mode) => `${text} · ${mode.toUpperCase()}`;

/**
 * Summary label for the focus dropdown's button: "Any focus", the one picked focus, or "N focuses" with its mode.
 * @returns {string}
 */
export function focusLabel() {
  const sel = nFocus.value;
  if (!sel.length) return "Any focus";
  if (sel.length === 1) return String(oneLabel(FOCUS, sel[0], String(sel[0])));
  return withMode(`${sel.length} focuses`, nFocusMode.value);
}

/**
 * Summary label for the genre dropdown's button: "Any genre", the one picked genre, or "N genres" with its mode.
 * @returns {string}
 */
export function genreLabel() {
  const sel = nGenre.value;
  if (!sel.length) return "Any genre";
  if (sel.length === 1) return String(oneLabel(GENRES, sel[0], String(sel[0])));
  return withMode(`${sel.length} genres`, nGenreMode.value);
}

/**
 * Summary label for the rate-change dropdown's button. Idle it names the facet
 * ("Rate change") and claims nothing — the unnarrowed list is NOT all-capable.
 * One engaged rule reads as that rule; more read as a count. Reads the
 * EFFECTIVE rules, so an auto-engaged hide is named here even though only an
 * explicit override highlights the button.
 */
export function rateLabel() {
  const parts = [];
  if (effHideLimited.value) parts.push("No rate-limited");
  if (nDownsafeOnly.value) parts.push("Downsampling");
  if (nOddRateOnly.value) parts.push("Uncommon rates");
  if (!parts.length) return "Rate change";
  if (parts.length === 1) return parts[0];
  return `Rate: ${parts.length} rules`;
}

/** Looks a value up in a facet's option table and returns its label, or `fallback` if no row matches. */
export const oneLabel = (
  /** @type {import("./facet-data.js").FacetItems} */ items,
  /** @type {string | number} */ v,
  /** @type {string} */ fallback,
) => (items.find(([iv]) => String(iv) === String(v)) || [null, fallback])[1];

// The selection a click on this row would PRODUCE: picked values drop out,
// unpicked ones join. Same transform `toggleIn` performs, so the count a row
// shows is the count the click actually lands on — an already-picked row
// previews its own removal, not the state it is already in.
/**
 * Returns the array a toggle of `v` would produce — picked values drop out,
 * unpicked ones join.
 * @template T
 * @param {T[]} arr
 * @param {T} v
 * @returns {T[]}
 */
export const toggleVal = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

// Per-option result counts hang off the ACTIVE chain only (user decision): PCM
// unless the output mode is SDM. The two numbers are that chain's 1x / Nx list
// sizes for the selection CLICKING THAT ROW WOULD PRODUCE — so with Transients
// already on, the Space row reads how many filters carry both. Reads each
// dropdown's own field key so the preview honours that chain's apod / lossy
// toggles too.
/**
 * Counts how many filters the active chain's 1x and Nx lists would hold under
 * `overrides` — SDM's oversampling lists when the output mode is SDM, PCM's
 * filter lists otherwise.
 * @param {NarrowOverrides} overrides
 * @returns {{ one: number, nx: number }}
 */
export function chainCounts(overrides) {
  const sdm = effective("output_mode") === "sdm";
  const one = previewCount(
    optionsFor("config", sdm ? "oversampling1x" : "filter1x"),
    "1x",
    sdm ? "sdm_filter_1x" : "pcm_filter_1x",
    overrides,
  );
  const nx = previewCount(
    optionsFor("config", sdm ? "oversampling" : "filter"),
    "nx",
    sdm ? "sdm_filter_nx" : "pcm_filter_nx",
    overrides,
  );
  return { one, nx };
}
