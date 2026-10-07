// The options a catalog key's list holds, and the ones narrowing keeps. The running engine enumerates: the loaded
// chain's list is its enumeration and the dormant chain's the daemon's /config form, both as the chain cards read them
// (store/live/chains.js), and a key no chain holds lists its drawer row's options. Each option joins v1's overlays by
// engine name: its facets (store/narrow/facets.js), its plain-names family, variant and leaf in Simplified, a
// modulator's rate floor tier and generation, and its manual prose. Narrowing is v1's matching over v1's facet state;
// the value running in the field is never hidden.

import { schema } from "../../schema.js";
import { metadata } from "../../signals.js";
import { chainControls } from "../../live/chains.js";
import { CHAINS } from "../../live/derive.js";
import { loadedChain } from "../../live/rates.js";
import { narrowOptions } from "../../narrow/match.js";
import { filterFacets } from "../../narrow/facets.js";
import {
  favoriteFilters,
  favoriteModulators,
  nFavOnly,
  toggleFavorite,
  toggleFavoriteModulator,
} from "../../narrow/favorites.js";
import { decorateOptions } from "../../plainnames.js";
import { describe, optionDescription } from "../../prose.js";
import { modulatorTier } from "../../ui/options.js";
import { rowOptions } from "../drawer/rows.js";
import { kindOf } from "./open.js";
import { ditherRate, modTier, shaperKeeps } from "./shapers.js";

/** @typedef {import("../../../model/shell/option-list.js").Opt} Opt */
/** @typedef {import("../../../model/shell/option-list.js").Facets} Facets */
/** @typedef {import("../../narrow/facets.js").FilterFacet} FilterFacet */
/** @typedef {import("../../live/derive.js").MenuOption} MenuOption */
/** @typedef {{ families: Record<string, string>, variants: Record<string, string> }} Blurbs */
/** @typedef {MenuOption & { display?: string, group?: string, subgroup?: string | null }} Decorated */

/**
 * The chain a catalog key sits on, undefined for a key no chain holds.
 *
 * @param {string} key
 * @returns {"pcm" | "sdm" | undefined}
 */
const chainOf = (key) =>
  /** @type {("pcm" | "sdm")[]} */ (["pcm", "sdm"]).find((ch) => CHAINS[ch].some((c) => c.key === key));

/**
 * A key's options before any narrowing, valued by enum ID and labeled by engine name: a chain key's as its chain card
 * lists them, any other key's as its drawer row does.
 *
 * @param {string} key
 * @returns {MenuOption[]}
 */
export function rawOptions(key) {
  const chain = chainOf(key);
  if (!chain) return rowOptions(key);
  const c = chainControls(chain, loadedChain() || null).find((x) => x.key === key);
  return c ? c.optionsRaw : [];
}

/**
 * A filter's facet record in the option list's shape, or undefined when nothing describes it.
 *
 * @param {FilterFacet | undefined} ff
 * @returns {Facets | undefined}
 */
function facetsOf(ff) {
  if (!ff) return undefined;
  return {
    q: ff.quality,
    genre: ff.genre,
    focus: ff.focus,
    phase: ff.phase,
    len: ff.length,
    adaptive: ff.adaptive,
    apod: ff.apodizing ? "full" : ff.apodizingHalf ? "half" : null,
    hires: ff.hiresFamily,
    up: ff.upsampleOnly,
    ratio: ff.ratio,
    ratioPcm: ff.ratioPcm,
    ratioSdm: ff.ratioSdm,
  };
}

/**
 * A modulator's rate floor tier and generation, where its overlay records them.
 *
 * @param {string} name
 * @returns {{ tier?: string, gen?: number }}
 */
function shaperMarks(name) {
  const tier = modulatorTier(name);
  const gen = metadata.value?.shapers?.sdm_modulators?.[name]?.generation;
  return { ...(tier ? { tier } : {}), ...(gen ? { gen } : {}) };
}

/**
 * The options a key's list holds, in the overlay's order while Simplified groups them and the engine's otherwise.
 *
 * @param {string} key
 * @returns {Opt[]}
 */
export function listOptions(key) {
  const entry = schema[key];
  const kind = kindOf(key);
  const facets = filterFacets.value;
  const meta = describe(entry, key);
  /** @type {Decorated[]} */
  const listed = decorateOptions(rawOptions(key), entry.plainNames ?? "");
  return listed.map((o) => ({
    v: o.label,
    fam: o.group ?? "",
    var: o.subgroup ?? null,
    leaf: o.display ?? o.label,
    d: optionDescription(entry, o, meta),
    ...(kind === "filters" ? { f: facetsOf(facets[o.label]) } : {}),
    ...(kind === "modulators" ? shaperMarks(o.label) : {}),
  }));
}

/**
 * The family and variant blurbs a key's plain-names overlay writes, empty when it writes none.
 *
 * @param {string} key
 * @returns {Blurbs}
 */
export function listBlurbs(key) {
  const overlay = metadata.value?.plain_names?.[schema[key].plainNames ?? ""];
  return { families: overlay?.families ?? {}, variants: overlay?.variants ?? {} };
}

/**
 * The options narrowing keeps at a stage, the value running in the field always among them unless it is the one
 * omitted. A DSD list has no narrowing and keeps every option.
 *
 * @param {string} key
 * @param {"1x" | "nx"} stage
 * @param {string} keep
 * @param {string} [omit]  an option dropped whatever narrowing and the running value say
 * @returns {Opt[]}
 */
export function narrowedOptions(key, stage, keep, omit = "") {
  const kind = kindOf(key);
  const opts = listOptions(key).filter((o) => omit === "" || o.v !== omit);
  if (kind === "dsd") return opts;
  if (kind === "filters") {
    const kept = new Set(narrowOptions(rawOptions(key), stage, key).map((o) => o.label));
    return opts.filter((o) => o.v === keep || kept.has(o.v));
  }
  const st = { fav: nFavOnly.value, modTier: modTier.value, ditherRate: ditherRate.value };
  return opts.filter((o) => o.v === keep || shaperKeeps(o, kind, st));
}

/**
 * Whether an option of a key's list is starred; a dither never is.
 *
 * @param {string} key
 * @param {string} v
 * @returns {boolean}
 */
export function isListFavorite(key, v) {
  const kind = kindOf(key);
  if (kind === "filters") return favoriteFilters.value.has(v);
  return kind === "modulators" && favoriteModulators.value.has(v);
}

/**
 * Star an option of a key's list, or unstar it, in its kind's set; a dither has none.
 *
 * @param {string} key
 * @param {string} v
 * @returns {Promise<void>}
 */
export async function toggleListFavorite(key, v) {
  const kind = kindOf(key);
  if (kind === "filters") await toggleFavorite(v);
  else if (kind === "modulators") await toggleFavoriteModulator(v);
}
