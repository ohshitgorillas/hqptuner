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
 *
 * @typedef {object} FacetSummary
 *   What a facet's button reports, before any of it is put into words. Every
 *   `*Label` below is this plus a sentence: the summary is the behavior, the
 *   sentence is copy the owner may reword at will.
 * @property {number} count how many picks are actually narrowing
 * @property {string | null} single the wire value of the only pick, when there is exactly one
 * @property {string | null} mode the combine mode, named only once a second pick makes it bite
 * @property {string[]} extra codes for clauses the count cannot carry
 */

// The state half of a facet button, shared by every facet that has no clause of
// its own beyond its count.
/**
 * @param {(string | number)[]} sel
 * @param {string | null} mode
 * @returns {FacetSummary}
 */
const summarize = (sel, mode) => ({
  count: sel.length,
  single: sel.length === 1 ? String(sel[0]) : null,
  mode: sel.length > 1 ? mode : null,
  extra: [],
});

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
 * What the focus dropdown's button reports: how many focuses narrow the list, and the mode combining them.
 * @returns {FacetSummary}
 */
export const focusSummary = () => summarize(nFocus.value, nFocusMode.value);

/**
 * Summary label for the focus dropdown's button: "Any focus", the one picked focus, or "N focuses" with its mode.
 * @returns {string}
 */
export function focusLabel() {
  const s = focusSummary();
  if (!s.count) return "Any focus";
  if (s.single != null) return String(oneLabel(FOCUS, s.single, s.single));
  return withMode(`${s.count} focuses`, String(s.mode));
}

// Genre's "any" tag outranks the combine mode (store/narrow/match.js): a filter
// the manual marks as suiting every genre survives the selection whatever else
// is picked. Under AND that makes every other pick inert — the result is the
// "any" filters and nothing else, whether or not Classical is also ticked.
// Under OR the picks still widen the list, so nothing is inert there.
const anyGenreDominates = () => nGenreMode.value === "and" && nGenre.value.includes("any");

// The inert picks are not counted: the button reports what is actually
// narrowing, which under a dominating "any" is that pick alone.
/**
 * What the genre dropdown's button reports. A dominating "any" collapses to that
 * one pick and carries the `any-dominates` code.
 * @returns {FacetSummary}
 */
export function genreSummary() {
  if (anyGenreDominates()) return { count: 1, single: "any", mode: null, extra: ["any-dominates"] };
  return summarize(nGenre.value, nGenreMode.value);
}

/**
 * Summary label for the genre dropdown's button: "Any genre", the one picked genre, or "N genres" with its mode.
 * @returns {string}
 */
export function genreLabel() {
  const s = genreSummary();
  if (!s.count) return "Any genre";
  if (s.single != null) return String(oneLabel(GENRES, s.single, s.single));
  return withMode(`${s.count} genres`, String(s.mode));
}

// Summary label for a multi-select carrying no combine mode. Genre and focus
// cannot share it: theirs name the mode once a second pick makes it bite, and
// phase and length have no mode to name.
/**
 * @param {import("./facet-data.js").FacetItems} items the facet's option table
 * @param {FacetSummary} s its summary
 * @param {string} idle what an empty selection reads as
 * @param {string} plural the noun a count is reported in
 * @returns {string}
 */
const countLabel = (items, s, idle, plural) => {
  if (!s.count) return idle;
  if (s.single != null) return String(oneLabel(items, s.single, s.single));
  return `${s.count} ${plural}`;
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
  const s = phaseSummary();
  const named = countLabel(PHASES, s, "Any phase", "phases");
  if (!s.extra.includes("no-phase")) return named;
  return s.count ? `${named} + no phase` : "No phase";
}

/**
 * What the phase dropdown's button reports. Counts named phases only; a picked
 * "No phase" is carried as the `no-phase` code rather than as one more phase.
 * @returns {FacetSummary}
 */
export function phaseSummary() {
  const sel = nPhase.value;
  const named = sel.filter((/** @type {string | number} */ v) => v !== "");
  const s = summarize(named, null);
  if (named.length !== sel.length) s.extra.push("no-phase");
  return s;
}

/**
 * What the length dropdown's button reports: how many lengths narrow the list.
 * @returns {FacetSummary}
 */
export const lengthSummary = () => summarize(nLength.value, null);

/**
 * Summary label for the length dropdown's button: "Any length", the one picked length, or "N lengths".
 * @returns {string}
 */
export const lengthLabel = () => countLabel(LENGTHS, lengthSummary(), "Any length", "lengths");

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
  const rules = rateSummary();
  if (!rules.length) return "Rate change";
  if (rules.length === 1) return RATE_RULE_LABELS[rules[0]];
  return `Rate: ${rules.length} rules`;
}

/** @type {Record<string, string>} */
const RATE_RULE_LABELS = {
  "hide-limited": "No rate-limited",
  downsafe: "Downsampling",
  "odd-rates": "Uncommon rates",
};

// Which rate-change rules are engaged, as their own codes, in the order the
// button names them. Not exported, unlike the other summaries: the rate rules
// each render their code as `data-v` on their own popover row, so a reader
// already has a better handle on this facet's state than a call would give it.
/**
 * @returns {string[]}
 */
function rateSummary() {
  const rules = [];
  if (effHideLimited.value) rules.push("hide-limited");
  if (nDownsafeOnly.value) rules.push("downsafe");
  if (nOddRateOnly.value) rules.push("odd-rates");
  return rules;
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
