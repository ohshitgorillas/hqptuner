// Does a filter pass the narrow bar, and how many would — the matching half of
// narrowing, sitting above the state it reads. Everything here is a pure read
// of the facet signals: one pass answers whether an option survives, the counts
// answer how many would under the live selection or a hypothetical one.
import {
  nGenre,
  nGenreMode,
  nQuality,
  nFocus,
  nFocusMode,
  nPhase,
  nLength,
  nHideLimited,
  nOddRateOnly,
  nDownsafeOnly,
  nApod1x,
  nApodNx,
  nLossy1x,
} from "./state.js";
import { computed } from "@preact/signals";
import { filterFacets } from "./facets.js";
import { favoriteFilters, favoriteModulators, nFavOnly } from "./favorites.js";
import { effective } from "../resolve.js";

// pcm_filter_1x / pcm_filter_nx → "pcm"; sdm_* → "sdm". Selects which side of a
// mode-split ratio (mqa/mp3) to test; null for non-chain callers.
/**
 * @typedef {import("./facets.js").FilterFacet} FilterFacet
 *
 * @typedef {object} Sel
 *   One snapshot of the narrow bar, as buildSel freezes it for a single pass.
 * @property {string[]} genre
 * @property {string} genreMode "and" | "or" — how the genre picks combine
 * @property {number} quality
 * @property {string[]} focus
 * @property {string} focusMode "and" | "or" — how the focus picks combine
 * @property {string[]} phase
 * @property {string[]} length
 * @property {boolean} hideLimited
 * @property {boolean} oddOnly
 * @property {boolean} downsafeOnly
 * @property {boolean} favOnly
 * @property {string|null} family which side of a mode-split ratio to test; null off-chain
 * @property {boolean} apod
 * @property {boolean} half
 * @property {string} lossy which side of the lossy split to keep at 1x; "" off
 *
 * @typedef {object} NarrowOption
 *   The two members of a dropdown option this module reads. Deliberately looser
 *   than OptionItem: the option lists reaching here are OptionItem (from the
 *   option stores) as well as the schema's own bare {value, label} lists.
 * @property {string | number | undefined} value
 * @property {string} label
 */

/**
 * @param {string} field
 * @returns {string|null}
 */
function family(field) {
  if (!field) return null;
  if (field.startsWith("pcm")) return "pcm";
  if (field.startsWith("sdm")) return "sdm";
  return null;
}

// Ratio is the one chain-dependent facet: mqa/mp3 filters upsample-only on PCM
// but any-ratio on SDM, so their facet carries ratioPcm/ratioSdm instead of a
// single ratio. Every other filter has a single `ratio`.
/**
 * @param {FilterFacet} f
 * @param {string|null} fam
 * @returns {string|null}
 */
function ratioOf(f, fam) {
  if (f.ratio != null) return f.ratio;
  return fam === "sdm" ? f.ratioSdm : f.ratioPcm;
}

// Filter a filter-field option list by the active facets. Options whose name
// carries no facet data pass through — narrowing hides only what it can
// positively exclude. `current` is never hidden. The apodizing check reads the
// dropdown's STAGE switch (1x or Nx): on "only", full-apodizing filters pass;
// ½-apodizing ones pass only on "half".
// Each entry reads "facet not engaged, or the filter passes it", so an unset
// facet excludes nothing. "any" is genre's escape hatch — a filter the manual
// marks agnostic survives every selection of that facet.
//
// The multi-select facets (genre, focus) carry their own combine mode: "and"
// intersects, so each further pick narrows, and "or" unions, so each further
// pick widens. Either way the per-option counts read the live mode, so a row's
// chip is the count that clicking it lands on.
/**
 * Does a filter's tag list satisfy the picks under this mode?
 * @param {string[]} picked the facet's selection — never empty here
 * @param {string[]} tagged the filter's own tags for that facet
 * @param {string} mode "and" | "or"
 * @returns {boolean}
 */
const multiPass = (picked, tagged, mode) =>
  mode === "or" ? picked.some((x) => tagged.includes(x)) : picked.every((x) => tagged.includes(x));

/** @type {((f: FilterFacet, s: Sel) => boolean)[]} */
const FACET_CHECKS = [
  // "any" is genre's escape hatch and outranks the mode: the manual marks such a
  // filter as suiting every genre, so it survives any selection either way.
  (f, s) => !s.genre.length || f.genre.includes("any") || multiPass(s.genre, f.genre, s.genreMode),
  (f, s) => !s.quality || (f.quality != null && f.quality >= s.quality),
  // Focus has no "any" tag in the manual — an untagged filter fails a focus pick.
  (f, s) => !s.focus.length || multiPass(s.focus, f.focus, s.focusMode),
  // Phase and length union rather than intersect, and carry no mode switch to
  // say otherwise: a filter holds exactly one of each, so a second pick can
  // only widen. The length menu's "adaptive" row is a trait rather than one
  // more bucket — it matches the flag a filter holds alongside its length.
  (f, s) => !s.phase.length || s.phase.includes(f.phase),
  (f, s) => !s.length.length || s.length.includes(f.length) || (s.length.includes("adaptive") && f.adaptive),
  // The rate-change rules hide only what they can positively exclude: a filter
  // whose ratio class is unknown (null) is never hidden by them. The odd-rate
  // rule hides just the 2x class — integer filters can still reach HQPTuner's
  // tiers from an uncommon source rate (3x48k from 32 kHz), 2x-only ones can't.
  (f, s) => !s.hideLimited || (ratioOf(f, s.family) !== "2x" && ratioOf(f, s.family) !== "integer"),
  (f, s) => !s.oddOnly || ratioOf(f, s.family) !== "2x",
  (f, s) => !s.downsafeOnly || !upsampleOf(f, s.family),
  (f, s) => !s.apod || f.apodizing || (s.half && f.apodizingHalf),
  // Lossy narrowing (1x only): "lossless" drops the whole hi-res family, whose
  // members all owe their 1x rationale to lossy material; "lossy" keeps only
  // that family. Empty means "both" and excludes nothing, which is also what
  // every Nx list gets — buildSel never sets this off the 1x stage.
  (f, s) => !s.lossy || (s.lossy === "lossy" ? f.hiresFamily === true : f.hiresFamily !== true),
];

// The "auto" state of the rate-limited hide, resolved against the daemon's own
// 48 kHz-DSD switch: each backend carries an `any_dsd` attribute (readme
// §1.3.2-1.3.5, surfaced as the "DSD rates: 44.1kHz only / +48kHz family"
// control) — 0 pins DSD output to the 44.1 kHz base, where a rate-limited
// filter can produce nothing from 48 kHz-family sources. Auto engages ONLY on
// that positive evidence, for the ACTIVE backend, in SDM output mode. Combo
// backends carry per-sub-element flags this config surface doesn't expose, so
// they never engage auto. The rates enumeration is deliberately not consulted:
// with the rate on Auto it lists only the rate-0 sentinel, and reading that
// absence as "no 48k support" mis-fired on DACs with +48kHz enabled.
/**
 * @param {string} key "alsa_anydsd" | "net_anydsd"
 * @returns {boolean} true when the backend is pinned to the 44.1 kHz base
 */
function dsd441Only(key) {
  const v = effective(key);
  return v === false || String(v) === "0";
}

export const rateAutoHide = computed(() => {
  if (effective("output_mode") !== "sdm") return false;
  const backend = effective("backend");
  if (backend === "alsa") return dsd441Only("alsa_anydsd");
  if (backend === "network") return dsd441Only("net_anydsd");
  return false;
});

/** Effective rate-limited hide — the user's override, or the auto default. */
export const effHideLimited = computed(
  () => nHideLimited.value === "on" || (nHideLimited.value === "auto" && rateAutoHide.value),
);

// Upsample-only is chain-dependent for the same mode-split pair: the manual's
// "up" rides their PCM row ("Integer up") while their SDM row reads plain
// "Any", so the flat flag applies to the PCM side only.
/**
 * @param {FilterFacet} f
 * @param {string|null} fam
 * @returns {boolean}
 */
function upsampleOf(f, fam) {
  if (f.ratio != null) return f.upsampleOnly;
  return fam === "sdm" ? false : f.upsampleOnly;
}

// The pass-through survives every facet. Its facets describe an ABSENCE of
// resampling rather than a poor one: the engine rates it 1/5 and marks it
// non-apodizing, both of which answer a question that does not apply to the
// option that converts nothing. Ranked as a resampler it falls below the
// quality floor and outside the 1x apodizing default, so the one way to ask for
// no conversion would leave the menu — the same escape hatch genre's "any" tag
// gets in FACET_CHECKS, one level up. PCM-only: the SDM filter enum has no such
// entry, because there is no passing through into DSD.
const PASS_THROUGH = "none";

// A filter with no facet record passes untouched — narrowing hides only what it
// can positively exclude (an option not in the active-mode enum nor the static
// overlay carries no facets).
const facetPass = (/** @type {string} */ label, /** @type {FilterFacet} */ f, /** @type {Sel} */ sel) =>
  label === PASS_THROUGH || !f || FACET_CHECKS.every((check) => check(f, sel));

// Favorites are NOT a facet check: a facet-less option passes facetPass
// untouched, but favorites-only must still hide it. Keyed by option label —
// the filter's name, the same key the facet overlay uses.
const favPass = (/** @type {string} */ label, /** @type {Sel} */ sel) =>
  !sel.favOnly || !favoriteFilters.value.size || favoriteFilters.value.has(label);

/**
 * The modulator options favorites-only narrowing keeps.
 *
 * A dropdown narrows against stars of its OWN kind, and a kind with nothing
 * starred is not narrowed at all: with the switch engaged off modulator stars
 * alone, the filter dropdowns stay whole (favPass above), and with it engaged
 * off filter stars alone this list stays whole. An empty set would otherwise
 * mean "keep nothing", which is a dropdown with no options in it — never what
 * engaging a switch elsewhere on the page was asking for.
 *
 * Modulators carry no facets, so they never reach the facet checks; the star
 * set is the whole of their narrowing.
 * @template {NarrowOption} T
 * @param {T[]} options
 * @returns {T[]}
 */
export function favOnlyModulators(options) {
  const stars = favoriteModulators.value;
  if (!nFavOnly.value || !stars.size) return options;
  return options.filter((o) => stars.has(o.label));
}

// The active selection snapshot. Number() on quality — the raw signal in
// narrowingActive and this can disagree: a non-numeric value reads as active in
// the bar but narrows nothing. Apod and lossy read the dropdown's STAGE
// switch; `field` only selects the ratio family (pcm vs sdm).
/**
 * @param {string} stage "1x" | "nx"
 * @param {string} field
 * @returns {Sel}
 */
function buildSel(stage, field) {
  const apod = stage === "1x" ? nApod1x.value : nApodNx.value;
  return {
    genre: nGenre.value,
    genreMode: nGenreMode.value,
    quality: Number(nQuality.value),
    focus: nFocus.value,
    focusMode: nFocusMode.value,
    phase: nPhase.value,
    length: nLength.value,
    hideLimited: effHideLimited.value,
    oddOnly: nOddRateOnly.value,
    downsafeOnly: nDownsafeOnly.value,
    favOnly: nFavOnly.value,
    family: family(field),
    apod: apod !== "all",
    half: apod === "half",
    lossy: stage === "1x" && nLossy1x.value !== "both" ? nLossy1x.value : "",
  };
}

// Any facet actually narrowing? An unset facet excludes nothing, so an
// all-default snapshot returns the option list untouched (same object).
// Split by SHAPE, not by facet: an empty array is truthy, so a multi-select
// read through the scalar test would report engaged with nothing picked and
// every short-circuit below would stop working.
/** @type {(keyof Sel)[]} */
const LIST_FACETS = ["genre", "focus", "phase", "length"];
/** @type {(keyof Sel)[]} */
const SCALAR_FACETS = ["quality", "hideLimited", "oddOnly", "downsafeOnly", "favOnly", "apod", "lossy"];
/**
 * @param {Sel} s
 * @returns {boolean} whether any facet narrows
 */
function anyEngaged(s) {
  return LIST_FACETS.some((k) => /** @type {string[]} */ (s[k]).length > 0) || SCALAR_FACETS.some((k) => !!s[k]);
}

/**
 * Filter a filter-field option list down to the ones the active facets keep.
 *
 * @template {NarrowOption} T
 * @param {T[]} options
 * @param {string} stage
 * @param {string} field
 * @returns {T[]}
 */
export function narrowOptions(options, stage, field) {
  const sel = buildSel(stage, field);
  if (!anyEngaged(sel)) return options;
  const facets = filterFacets.value;
  return options.filter((o) => favPass(o.label, sel) && facetPass(o.label, facets[o.label], sel));
}

// ---- result counts (narrowing UI) -----------------------------------------
// How many options a selection would keep — the number the live badge and the
// per-option popover previews report. An all-default snapshot short-circuits to
// the full length.
/**
 * @param {NarrowOption[]} options
 * @param {Sel} sel
 * @returns {number}
 */
function countPass(options, sel) {
  if (!anyEngaged(sel)) return options.length;
  const facets = filterFacets.value;
  return options.reduce((n, o) => (favPass(o.label, sel) && facetPass(o.label, facets[o.label], sel) ? n + 1 : n), 0);
}

// Live badge for one filter dropdown: { n, total } against the ACTIVE facets.
/**
 * How many of a dropdown's options the active facets match, against the total —
 * the live badge's numbers.
 *
 * @param {NarrowOption[]} options
 * @param {string} stage
 * @param {string} field
 * @returns {{ n: number, total: number }}
 */
export function narrowCount(options, stage, field) {
  return { n: countPass(options, buildSel(stage, field)), total: options.length };
}

// Per-option popover preview: how many options survive if `overrides` were
// merged onto the current selection (e.g. { genre: [...current, "rock"] }).
/**
 * How many options would survive if `overrides` were merged onto the current
 * selection — the per-option popover preview.
 *
 * @param {NarrowOption[]} options
 * @param {string} stage
 * @param {string} field
 * @param {Partial<Sel>} overrides
 * @returns {number}
 */
export function previewCount(options, stage, field, overrides) {
  return countPass(options, { ...buildSel(stage, field), ...overrides });
}
