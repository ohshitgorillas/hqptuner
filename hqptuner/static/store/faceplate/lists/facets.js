// The narrowing console's store half. The facets are v1's own signals (store/narrow/state.js, the favorites switch in
// store/narrow/favorites.js), persisted by v1's narrowing store, plus this phase's two shaper facets
// (store/faceplate/lists/shapers.js). This module reads them as the one state record the console's model reads
// (model/shell/narrow-view.js), writes a facet by its console key, resets and tests a set of keys, and counts what a
// pick would leave: the running chain's 1x and Nx filter lists through v1's preview count, or a shaper list.

import { batch } from "@preact/signals";
import {
  APOD_1X_DEFAULT,
  APOD_NX_DEFAULT,
  FOCUS_MODE_DEFAULT,
  GENRE_MODE_DEFAULT,
  LOSSY_1X_DEFAULT,
  QUALITY_DEFAULT,
  RATE_RULE_DEFAULT,
  nApod1x,
  nApodNx,
  nDownsafeOnly,
  nFocus,
  nFocusMode,
  nGenre,
  nGenreMode,
  nHideLimited,
  nLength,
  nLossy1x,
  nOddRateOnly,
  nPhase,
  nQuality,
} from "../../narrow/state.js";
import { effHideLimited, previewCount } from "../../narrow/match.js";
import { nFavOnly } from "../../narrow/favorites.js";
import "../../narrow/persist.js";
import { runningChain } from "../path.js";
import { kindOf } from "./open.js";
import { listOptions, rawOptions } from "./options.js";
import { ditherRate, modTier, shaperKeeps } from "./shapers.js";

/** @typedef {import("./open.js").ListKind} ListKind */
/** @typedef {Record<string, unknown>} Over  facet values by console key, laid over the state for a preview */

/**
 * The state record the console reads.
 *
 * @typedef {object} NarrowState
 * @property {number} quality
 * @property {string[]} genre
 * @property {string} genreMode
 * @property {string[]} focus
 * @property {string} focusMode
 * @property {string} apod1x
 * @property {string} apodNx
 * @property {string[]} length
 * @property {string[]} phase
 * @property {string} lossy
 * @property {boolean} hideLimited  the rate rule as it applies, its auto default resolved
 * @property {boolean} downsafe
 * @property {boolean} odd
 * @property {boolean} fav
 * @property {string[]} modTier
 * @property {string[]} ditherRate
 */

/**
 * Each console key's signal and the value it starts at. The rate rule stores `auto` | `on` | `off`; the console reads
 * and writes it as the rule ticked or not.
 *
 * @type {Record<string, [{ value: unknown }, unknown]>}
 */
const FACETS = {
  quality: [nQuality, QUALITY_DEFAULT],
  genre: [nGenre, []],
  genreMode: [nGenreMode, GENRE_MODE_DEFAULT],
  focus: [nFocus, []],
  focusMode: [nFocusMode, FOCUS_MODE_DEFAULT],
  apod1x: [nApod1x, APOD_1X_DEFAULT],
  apodNx: [nApodNx, APOD_NX_DEFAULT],
  length: [nLength, []],
  phase: [nPhase, []],
  lossy: [nLossy1x, LOSSY_1X_DEFAULT],
  hideLimited: [nHideLimited, RATE_RULE_DEFAULT],
  downsafe: [nDownsafeOnly, false],
  odd: [nOddRateOnly, false],
  fav: [nFavOnly, false],
  modTier: [modTier, []],
  ditherRate: [ditherRate, []],
};

/**
 * The narrowing as the console reads it, the rate rule resolved.
 *
 * @returns {NarrowState}
 */
export function narrowState() {
  return {
    quality: Number(nQuality.value),
    genre: nGenre.value,
    genreMode: nGenreMode.value,
    focus: nFocus.value,
    focusMode: nFocusMode.value,
    apod1x: nApod1x.value,
    apodNx: nApodNx.value,
    length: nLength.value,
    phase: nPhase.value,
    lossy: nLossy1x.value,
    hideLimited: effHideLimited.value,
    downsafe: nDownsafeOnly.value,
    odd: nOddRateOnly.value,
    fav: nFavOnly.value,
    modTier: modTier.value,
    ditherRate: ditherRate.value,
  };
}

/**
 * Write one facet by its console key; the rate rule takes the ticked state and stores `on` or `off`.
 *
 * @param {string} key
 * @param {unknown} value
 */
export function setFacet(key, value) {
  const f = FACETS[key];
  if (!f) return;
  f[0].value = key === "hideLimited" ? (value ? "on" : "off") : value;
}

/**
 * Put the named facets back where a fresh page starts them.
 *
 * @param {string[]} keys
 */
export function resetFacets(keys) {
  batch(() => {
    for (const k of keys) if (FACETS[k]) FACETS[k][0].value = FACETS[k][1];
  });
}

/**
 * Whether any of the named facets holds other than its starting value (pick lists by content). The rate rule's auto
 * default is not a move, whatever it resolves to.
 *
 * @param {string[]} keys
 * @returns {boolean}
 */
export const facetsMoved = (keys) =>
  keys.some((k) => FACETS[k] && JSON.stringify(FACETS[k][0].value) !== JSON.stringify(FACETS[k][1]));

/** The matching selection's key for each console key that applies at both stages. @type {Record<string, string>} */
const SELECTION_KEY = {
  genre: "genre",
  genreMode: "genreMode",
  focus: "focus",
  focusMode: "focusMode",
  length: "length",
  phase: "phase",
  hideLimited: "hideLimited",
  odd: "oddOnly",
  downsafe: "downsafeOnly",
  fav: "favOnly",
};

/**
 * The console keys of a preview as v1's matching selection reads them at one stage. Apodizing and 1x sources apply
 * at their own stage only.
 *
 * @param {Over} over
 * @param {"1x" | "nx"} stage
 * @returns {Record<string, unknown>}
 */
function selectionOver(over, stage) {
  /** @type {Record<string, unknown>} */
  const sel = {};
  for (const [k, s] of Object.entries(SELECTION_KEY)) if (k in over) sel[s] = over[k];
  if ("quality" in over) sel.quality = Number(over.quality);
  const apod = over[stage === "1x" ? "apod1x" : "apodNx"];
  if (apod !== undefined) Object.assign(sel, { apod: apod !== "all", half: apod === "half" });
  if (stage === "1x" && "lossy" in over) sel.lossy = over.lossy === "both" ? "" : over.lossy;
  return sel;
}

/**
 * How many filters the running chain's 1x and Nx lists would keep with `over` laid on the narrowing.
 *
 * @param {Over} over
 * @returns {{ "1x": number, nx: number }}
 */
export function previewCounts(over) {
  const chain = runningChain();
  /** @param {"1x" | "nx"} stage */
  const count = (stage) => {
    const key = `${chain}_filter_${stage}`;
    return previewCount(rawOptions(key), stage, key, selectionOver(over, stage));
  };
  return { "1x": count("1x"), nx: count("nx") };
}

/** The catalog key whose list each shaper kind counts. @type {Record<string, string>} */
const SHAPER_KEY = { modulators: "sdm_modulator", dithers: "pcm_dither" };

/**
 * How many options a shaper list would keep with `over` laid on its facets.
 *
 * @param {ListKind} kind
 * @param {Over} over
 * @returns {number}
 */
export function shaperCount(kind, over) {
  const key = SHAPER_KEY[kind];
  if (!key) return 0;
  const st = /** @type {NarrowState} */ ({ ...narrowState(), ...over });
  return listOptions(key).filter((o) => shaperKeeps(o, kindOf(key), st)).length;
}
