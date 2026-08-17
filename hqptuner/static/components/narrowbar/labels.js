// Pure helpers for the narrowing bar: the button summary labels, the
// multi-select toggle transforms, and the per-option preview counts. Its own
// module because none of it renders anything — every function here is a plain
// value-in / value-out read of the narrowing signals, shared by the widgets and
// the facet assembly.
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/options.js";
import {
  nGenre,
  nGenreMode,
  nFocus,
  nFocusMode,
  nPhase,
  nLength,
  nOddRateOnly,
  nDownsafeOnly,
} from "../../store/narrow/state.js";
import { previewCount, effHideLimited } from "../../store/narrow/match.js";
import { GENRES, FOCUS, PHASES, LENGTHS } from "./facet-data.js";

/**
 * @typedef {{ genre?: string[], genreMode?: string, quality?: number, focus?: string[], focusMode?: string,
 *             phase?: string[], length?: string[],
 *             hideLimited?: boolean, oddOnly?: boolean, downsafeOnly?: boolean, apod?: boolean, half?: boolean,
 *             lossy?: string }} NarrowOverrides
 *   A partial facet selection laid over the live one — what a candidate pick
 *   would produce, which is what the count chips are counted against
 *   (store/narrow/state.js buildSel names the full set).
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

// Genre's "any" tag outranks the combine mode (store/narrow/match.js): a filter
// the manual marks as suiting every genre survives the selection whatever else
// is picked. Under AND that makes every other pick inert — the result is the
// "any" filters and nothing else, whether or not Classical is also ticked.
// Under OR the picks still widen the list, so nothing is inert there.
const anyGenreDominates = () => nGenreMode.value === "and" && nGenre.value.includes("any");

/**
 * Summary label for the genre dropdown's button: "Any genre", the one picked genre, or "N genres" with its mode.
 * @returns {string}
 */
export function genreLabel() {
  const sel = nGenre.value;
  if (!sel.length) return "Any genre";
  // The inert picks are not counted: the button reports what is actually
  // narrowing, which under a dominating "any" is that pick alone.
  if (anyGenreDominates()) return String(oneLabel(GENRES, "any", "any"));
  if (sel.length === 1) return String(oneLabel(GENRES, sel[0], String(sel[0])));
  return withMode(`${sel.length} genres`, nGenreMode.value);
}

// Summary label for a multi-select carrying no combine mode. Genre and focus
// cannot share it: theirs name the mode once a second pick makes it bite, and
// phase and length have no mode to name.
/**
 * @param {import("./facet-data.js").FacetItems} items the facet's option table
 * @param {(string | number)[]} sel its picked values
 * @param {string} idle what an empty selection reads as
 * @param {string} plural the noun a count is reported in
 * @returns {string}
 */
const countLabel = (items, sel, idle, plural) => {
  if (!sel.length) return idle;
  if (sel.length === 1) return String(oneLabel(items, sel[0], String(sel[0])));
  return `${sel.length} ${plural}`;
};

// Phase counts NAMED phases only. "No phase" is a pick about the absence of a
// classification rather than one more phase, so folding it into the count would
// report a number of phases that includes a filter having none. It reads as its
// own trailing clause instead, and the named half keeps the ordinary rule: one
// named phase shows its own label, more show a count.
/**
 * Summary label for the phase dropdown's button. Counts named phases only; a
 * picked "No phase" adds a trailing " + no phase" clause.
 * @returns {string}
 */
export function phaseLabel() {
  const sel = nPhase.value;
  const named = sel.filter((/** @type {string | number} */ v) => v !== "");
  if (named.length === sel.length) return countLabel(PHASES, named, "Any phase", "phases");
  if (!named.length) return "No phase";
  return `${countLabel(PHASES, named, "Any phase", "phases")} + no phase`;
}

/**
 * Summary label for the length dropdown's button: "Any length", the one picked length, or "N lengths".
 * @returns {string}
 */
export const lengthLabel = () => countLabel(LENGTHS, nLength.value, "Any length", "lengths");

/**
 * Whether a genre row is inert under the live selection — an AND selection
 * carrying "any" renders every other row unable to change the result.
 * @param {string | number} v
 * @returns {boolean}
 */
export const genreRowOff = (v) => v !== "any" && anyGenreDominates();

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
