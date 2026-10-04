// Narrowing: one state for the Narrow filters drawer, the Resampling header tags and every list drawer, plus the
// matching rules (port of v1 store/narrow/match.js over the static facet overlay in data/option-lists.js).
// Facet defaults, tag text and the hint copy live in data/narrow-facets.js.

import { COLUMNS, DEFAULT_MODES, INITIAL, FAVORITES } from "../../data/lists/narrow-facets.js";
import { LISTS } from "../../data/lists/option-lists.js";

/** @typedef {import('../../model/shell/narrow-view.js').Facet} Facet */
/** @typedef {import('../../model/shell/narrow-view.js').Row} Row */
/** @typedef {import('../../model/shell/narrow-view.js').Item} Item */
/** @typedef {import('../../model/shell/option-list.js').Opt} Opt */
/** @typedef {import('../../model/shell/option-list.js').Facets} Facets */

/** @typedef {string | number | boolean | string[]} FacetValue  picked chips, a toggle or check, a row's value, a mode */

/**
 * The state keys the matching rules read.
 *
 * @typedef {object} Narrowing
 * @property {string[]} genre
 * @property {string} genreMode  and | or
 * @property {number} quality  the floor; 0 = any
 * @property {string[]} focus
 * @property {string} focusMode  and | or
 * @property {string[]} phase
 * @property {string[]} length
 * @property {string} apod1x  all | only | half
 * @property {string} apodNx  all | only | half
 * @property {string} lossy  both | lossless | lossy
 * @property {boolean} hideLimited
 * @property {boolean} downsafe
 * @property {boolean} odd
 * @property {boolean} fav
 * @property {string[]} modTier
 * @property {string[]} ditherRate
 */

/** @typedef {Record<string, FacetValue> & Narrowing} NarrowState  every facet's value by state key */

/** @typedef {keyof typeof LISTS} ListName */
/** @typedef {'filters' | 'modulators' | 'dithers'} Kind  the favorites set and group copy a list reads */

/** @type {Readonly<Record<ListName, readonly Opt[]>>} */
const ROWS = LISTS;

/**
 * Every facet, flattened from its clusters.
 *
 * @type {Facet[]}
 */
const FACETS = COLUMNS.flat();

/**
 * Fresh default state: every facet cleared. Always a new object (arrays are never shared).
 *
 * @returns {NarrowState}
 */
export function defaults() {
  /** @type {Record<string, unknown>} */
  const st = { ...DEFAULT_MODES };
  for (const f of FACETS) {
    if (f.kind === "chips") st[/** @type {string} */ (f.key)] = [];
    if (f.kind === "toggle") st[/** @type {string} */ (f.key)] = false;
    if (f.kind === "seg") for (const r of /** @type {Row[]} */ (f.rows)) st[r.key] = r.options[0].v;
    if (f.kind === "checks") for (const i of /** @type {Item[]} */ (f.items)) st[i.key] = false;
  }
  return /** @type {NarrowState} */ (st);
}

/** @type {NarrowState} */
let st = { ...defaults(), ...INITIAL };
/** @type {Set<(s: NarrowState) => void>} */
const subs = new Set();

/**
 * The narrowing state as it stands.
 *
 * @returns {NarrowState}
 */
export const state = () => st;

/**
 * Hear every change of the state (and of the favorites and the running chain).
 *
 * @param {(s: NarrowState) => void} fn
 * @returns {() => boolean}  unsubscribe
 */
export const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
const emit = () => {
  for (const fn of subs) fn(st);
};

/**
 * Set one state key.
 *
 * @param {string} key
 * @param {FacetValue} value
 */
export function change(key, value) {
  st = { ...st, [key]: value };
  emit();
}

/**
 * Reset: every facet, or only the given keys (a shaper list's Reset leaves the filter narrowing alone, and vice versa).
 *
 * @param {string[]} [keys]
 */
export function reset(keys) {
  const d = defaults();
  st = keys ? { ...st, ...Object.fromEntries(keys.map((k) => [k, d[k]])) } : d;
  emit();
}

// Favorites: filters and modulators, two sets (v1 favorites.js). Mock stars.
/** @type {Partial<Record<Kind, Set<string>>>} */
const favs = { filters: new Set(FAVORITES.filters), modulators: new Set(FAVORITES.modulators) };

/**
 * The kind a list belongs to: modulators and dithers are their own, every other list is a filter list.
 *
 * @param {string} list
 * @returns {Kind}
 */
export const kindOf = (list) => (list === "modulators" || list === "dithers" ? list : "filters");

/**
 * Whether option `v` of `list` is starred.
 *
 * @param {string} list
 * @param {string} v
 * @returns {boolean}
 */
export const isFav = (list, v) => favs[kindOf(list)]?.has(v) ?? false;

/**
 * Star option `v` of `list`, or unstar it; a kind with no favorites set (dithers) is left alone.
 *
 * @param {string} list
 * @param {string} v
 */
export function toggleFav(list, v) {
  const s = favs[kindOf(list)];
  if (!s) return;
  s.has(v) ? s.delete(v) : s.add(v);
  emit();
}

// ── Matching (v1 match.js) ────────────────────────────────────────────────────────────────────────────────────────
/** @typedef {NarrowState & { fam: string, apod: boolean, half: boolean, lossyOn: string }} Selection */

/**
 * @param {Facets} f
 * @param {string} fam
 */
const ratioOf = (f, fam) => (f.ratio != null ? f.ratio : fam === "sdm" ? f.ratioSdm : f.ratioPcm);
/**
 * @param {Facets} f
 * @param {string} fam
 */
const limited = (f, fam) => ratioOf(f, fam) === "2x" || ratioOf(f, fam) === "integer";
/**
 * @param {Facets} f
 * @param {string} fam
 */
const upOf = (f, fam) => (f.ratio != null ? f.up : fam === "sdm" ? false : f.up);
/**
 * @param {string[]} picked
 * @param {string[]} tagged
 * @param {string} mode
 */
const multi = (picked, tagged, mode) =>
  mode === "or" ? picked.some((x) => tagged.includes(x)) : picked.every((x) => tagged.includes(x));

/**
 * The selection one list sees: apodizing per stage, lossy at 1x only.
 *
 * @param {NarrowState} s
 * @param {string} stage
 * @param {string} fam
 * @returns {Selection}
 */
function sel(s, stage, fam) {
  const apod = stage === "1x" ? s.apod1x : s.apodNx;
  return {
    ...s,
    fam,
    apod: apod !== "all",
    half: apod === "half",
    lossyOn: stage === "1x" && s.lossy !== "both" ? s.lossy : "",
  };
}

/** @type {((f: Facets, s: Selection) => boolean)[]} */
const CHECKS = [
  (f, s) => !s.genre.length || f.genre.includes("any") || multi(s.genre, f.genre, s.genreMode),
  (f, s) => !s.quality || (f.q != null && f.q >= s.quality),
  (f, s) => !s.focus.length || multi(s.focus, f.focus, s.focusMode),
  (f, s) => !s.phase.length || s.phase.includes(f.phase),
  (f, s) => !s.length.length || s.length.includes(f.len) || (s.length.includes("adaptive") && !!f.adaptive),
  (f, s) => !s.hideLimited || !limited(f, s.fam),
  (f, s) => !s.odd || ratioOf(f, s.fam) !== "2x",
  (f, s) => !s.downsafe || !upOf(f, s.fam),
  (f, s) => !s.apod || f.apod === "full" || (s.half && f.apod === "half"),
  (f, s) => !s.lossyOn || (s.lossyOn === "lossy" ? !!f.hires : !f.hires),
];

/**
 * A dither's rate marker, from its plain-names leaf (`Ninth order, ≥4x` → `≥4x`); '' when it carries none.
 *
 * @param {{ leaf: string }} o
 * @returns {string}
 */
const ditherRate = (o) => (o.leaf.match(/≥\d+x/) || [""])[0];

/**
 * Whether option `o` survives a shaper list's own facets (rate floor / rate marker; OR across picks).
 *
 * @param {Opt} o
 * @param {string} list
 * @param {NarrowState} s
 */
function shaperPass(o, list, s) {
  if (list === "modulators" && s.modTier.length && !s.modTier.includes(o.tier || "")) return false;
  return !(list === "dithers" && s.ditherRate.length && !s.ditherRate.includes(ditherRate(o)));
}

/**
 * Whether option `o` survives the favorites switch; a kind with nothing starred is not narrowed (v1).
 *
 * @param {Opt} o
 * @param {string} list
 * @param {NarrowState} s
 */
function favPass(o, list, s) {
  if (!s.fav) return true;
  const stars = favs[kindOf(list)];
  return !(stars?.size && !stars.has(o.v));
}

/**
 * Does option `o` of list `list` survive narrowing state `s` at `stage`? The pass-through (`none`) always does.
 *
 * @param {Opt} o
 * @param {string} list
 * @param {string} stage
 * @param {NarrowState} s
 */
function pass(o, list, stage, s) {
  const fam = list.startsWith("sdm") ? "sdm" : "pcm";
  if (!shaperPass(o, list, s) || !favPass(o, list, s)) return false;
  if (!o.f || o.v === "none") return true;
  const x = sel(s, stage, fam);
  const f = o.f;
  return CHECKS.every((c) => c(f, x));
}

/**
 * The options a list keeps. `keep` (the current value) is never hidden.
 *
 * @param {ListName} list
 * @param {string} stage  1x | nx
 * @param {unknown} keep
 * @param {NarrowState} [s]
 * @returns {Opt[]}
 */
export function narrowed(list, stage, keep, s = st) {
  return ROWS[list].filter((o) => String(o.v) === String(keep) || pass(o, list, stage, s));
}

/**
 * How many options of a list survive the narrowing at `stage`.
 *
 * @param {ListName} list
 * @param {string} stage  1x | nx
 * @param {NarrowState} [s]
 * @returns {number}
 */
export const count = (list, stage, s = st) => ROWS[list].filter((o) => pass(o, list, stage, s)).length;

/** The filter list narrowing counts against: the running chain's (v1: the active chain). */
let chain = "sdm";

/**
 * Set the running chain (sdm | pcm); its filter list is the one counts read.
 *
 * @param {string} c
 */
export const setChain = (c) => {
  if (c === chain) return;
  chain = c;
  emit();
};

/**
 * The running chain's filter list.
 *
 * @returns {ListName}
 */
export const chainList = () => (chain === "sdm" ? "sdmFilters" : "pcmFilters");

/**
 * Preview counts "1x·Nx" for the state a click would produce.
 *
 * @param {Record<string, FacetValue>} over
 * @returns {string}
 */
export function preview(over) {
  const s = { ...st, ...over };
  return `${count(chainList(), "1x", s)}·${count(chainList(), "nx", s)}`;
}
