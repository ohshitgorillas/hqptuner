// Narrowing: one state for the Narrow filters drawer, the Resampling header tags and every list drawer, plus the
// matching rules (port of v1 store/narrow/match.js over the static facet overlay in data/option-lists.js).
// Facet defaults, tag text and the hint copy live in data/narrow-facets.js.

import { COLUMNS, DEFAULT_MODES, INITIAL, FAVORITES } from "../data/narrow-facets.js";
import { LISTS } from "../data/option-lists.js";

export const FACETS = COLUMNS.flat();

/** Fresh default state: every facet cleared. Always a new object (arrays are never shared). */
export function defaults() {
  const st = { ...DEFAULT_MODES };
  for (const f of FACETS) {
    if (f.kind === "chips") st[f.key] = [];
    if (f.kind === "toggle") st[f.key] = false;
    if (f.kind === "seg") for (const r of f.rows) st[r.key] = r.options[0].v;
    if (f.kind === "checks") for (const i of f.items) st[i.key] = false;
  }
  return st;
}

let st = { ...defaults(), ...INITIAL };
const subs = new Set();
export const state = () => st;
export const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
const emit = () => {
  for (const fn of subs) fn(st);
};
export function change(key, value) {
  st = { ...st, [key]: value };
  emit();
}
/** Reset: every facet, or only the given keys (a shaper list's Reset leaves the filter narrowing alone, and vice versa). */
export function reset(keys) {
  const d = defaults();
  st = keys ? { ...st, ...Object.fromEntries(keys.map((k) => [k, d[k]])) } : d;
  emit();
}

// Favorites: filters and modulators, two sets (v1 favorites.js). Mock stars.
const favs = { filters: new Set(FAVORITES.filters), modulators: new Set(FAVORITES.modulators) };
export const kindOf = (list) => (list === "modulators" || list === "dithers" ? list : "filters");
export const isFav = (list, v) => favs[kindOf(list)]?.has(v) ?? false;
export function toggleFav(list, v) {
  const s = favs[kindOf(list)];
  if (!s) return;
  s.has(v) ? s.delete(v) : s.add(v);
  emit();
}

// ── Matching (v1 match.js) ────────────────────────────────────────────────────────────────────────────────────────
const ratioOf = (f, fam) => (f.ratio != null ? f.ratio : fam === "sdm" ? f.ratioSdm : f.ratioPcm);
const limited = (f, fam) => ratioOf(f, fam) === "2x" || ratioOf(f, fam) === "integer";
const upOf = (f, fam) => (f.ratio != null ? f.up : fam === "sdm" ? false : f.up);
const multi = (picked, tagged, mode) =>
  mode === "or" ? picked.some((x) => tagged.includes(x)) : picked.every((x) => tagged.includes(x));

/** The selection one list sees: apodizing per stage, lossy at 1x only. */
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

const CHECKS = [
  (f, s) => !s.genre.length || f.genre.includes("any") || multi(s.genre, f.genre, s.genreMode),
  (f, s) => !s.quality || (f.q != null && f.q >= s.quality),
  (f, s) => !s.focus.length || multi(s.focus, f.focus, s.focusMode),
  (f, s) => !s.phase.length || s.phase.includes(f.phase),
  (f, s) => !s.length.length || s.length.includes(f.len) || (s.length.includes("adaptive") && f.adaptive),
  (f, s) => !s.hideLimited || !limited(f, s.fam),
  (f, s) => !s.odd || ratioOf(f, s.fam) !== "2x",
  (f, s) => !s.downsafe || !upOf(f, s.fam),
  (f, s) => !s.apod || f.apod === "full" || (s.half && f.apod === "half"),
  (f, s) => !s.lossyOn || (s.lossyOn === "lossy" ? f.hires : !f.hires),
];

/** Does option `o` of list `list` survive narrowing state `s` at `stage`? The pass-through (`none`) always does. */
// A dither's rate marker, from its plain-names leaf (`Ninth order, ≥4x` → `≥4x`); '' when it carries none.
export const ditherRate = (o) => (o.leaf.match(/≥\d+x/) || [""])[0];

function pass(o, list, stage, s) {
  const fam = list.startsWith("sdm") ? "sdm" : "pcm";
  // Shaper lists: their own facets (rate floor / rate marker; OR across picks).
  if (list === "modulators" && s.modTier.length && !s.modTier.includes(o.tier || "")) return false;
  if (list === "dithers" && s.ditherRate.length && !s.ditherRate.includes(ditherRate(o))) return false;
  if (s.fav) {
    const stars = favs[kindOf(list)];
    if (stars?.size && !stars.has(o.v)) return false; // a kind with nothing starred is not narrowed (v1)
  }
  if (!o.f || o.v === "none") return true;
  const x = sel(s, stage, fam);
  return CHECKS.every((c) => c(o.f, x));
}

/** The options a list keeps. `keep` (the current value) is never hidden. */
export function narrowed(list, stage, keep, s = st) {
  return LISTS[list].filter((o) => String(o.v) === String(keep) || pass(o, list, stage, s));
}
export const count = (list, stage, s = st) => LISTS[list].filter((o) => pass(o, list, stage, s)).length;

/** The filter list narrowing counts against: the running chain's (v1: the active chain). */
let chain = "sdm";
export const setChain = (c) => {
  if (c === chain) return;
  chain = c;
  emit();
};
export const chainList = () => (chain === "sdm" ? "sdmFilters" : "pcmFilters");

/** Preview counts "1x·Nx" for the state a click would produce. */
export function preview(over) {
  const s = { ...st, ...over };
  return `${count(chainList(), "1x", s)}·${count(chainList(), "nx", s)}`;
}
export const readout = () => ({
  x1: `${count(chainList(), "1x")} of ${LISTS[chainList()].length}`,
  nx: `${count(chainList(), "nx")} of ${LISTS[chainList()].length}`,
});
