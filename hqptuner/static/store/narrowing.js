// Client-side filter narrowing — HQPTuner's own feature (no daemon field): the
// filter menus are 60-77 entries, so the narrow bar filters which options show
// by facet. Purely presentational: it never changes a staged value, only what
// the dropdown offers. The currently-selected option is always kept visible.
import { signal, computed } from "@preact/signals";
import { filterFacets } from "./facets.js";

export const nGenre = signal([]); // multi-select: pop | rock | jazz | … ([] = any)
export const nQuality = signal(0); // 0 = any, else minimum quality (3 | 4 | 5)
export const nFocus = signal([]); // multi-select: transients | timbre | space
export const nPhase = signal(""); // "" = any (linear | minimum | intermediate)
export const nLength = signal([]); // multi-select: short | medium | long ([] = any)
export const nRatio = signal([]); // multi-select: integer | 2x | 1:1 ([] = any)
// ratio-dropdown extra: the manual fuses "up" (upsample-only) INTO the ratio
// column ("Integer up"). Not a ratio class — orthogonal — so it rides as a
// checkbox in the ratio popover, ANDing with any ratio class picked.
export const nUpsampleOnly = signal(false);

// Apodizing narrowing is PER 1x-DROPDOWN, not global (user decision 2026-07-24):
// the two 1x filter chains — PCM (`pcm_filter_1x`) and SDM (`sdm_filter_1x`) —
// each own an independent apod state, keyed by the schema field key. On by
// default for both: the unfiltered 1x list is 60-77 entries and apodizing is the
// sane starting point. ½-apodizing sub-toggle is off by default, also per chain.
const APOD_KEYS = ["pcm_filter_1x", "sdm_filter_1x"];
const apodDefaults = () => ({ pcm_filter_1x: true, sdm_filter_1x: true });
const halfDefaults = () => ({ pcm_filter_1x: false, sdm_filter_1x: false });
export const nApod = signal(apodDefaults());
export const nApodHalf = signal(halfDefaults());

// Hi-res narrowing is ALSO per-dropdown, and splits by stage. On the two 1x
// chains it HIDES hi-res filters (`nHideHires`, default ON — 1x covers base
// rates where the hi-res/lossy-tuned filters are off-topic). On the two Nx
// chains it does the inverse — SHOW ONLY hi-res (`nHiresOnly`, default OFF). Two
// separate maps because the stages never share a key: the 1x fields carry the
// hide flag, the Nx fields the show-only flag. Same per-chain independence and
// identity-swap setters as apodizing above.
const HIDE_HIRES_KEYS = ["pcm_filter_1x", "sdm_filter_1x"];
const HIRES_ONLY_KEYS = ["pcm_filter_nx", "sdm_filter_nx"];
const hideHiresDefaults = () => ({ pcm_filter_1x: true, sdm_filter_1x: true });
const hiresOnlyDefaults = () => ({ pcm_filter_nx: false, sdm_filter_nx: false });
export const nHideHires = signal(hideHiresDefaults());
export const nHiresOnly = signal(hiresOnlyDefaults());

// Flip one chain's flag without mutating the signal object in place (signals only
// react to identity changes).
export function setApod(field, on) {
  nApod.value = { ...nApod.value, [field]: on };
}
export function setApodHalf(field, on) {
  nApodHalf.value = { ...nApodHalf.value, [field]: on };
}
export function setHideHires(field, on) {
  nHideHires.value = { ...nHideHires.value, [field]: on };
}
export function setHiresOnly(field, on) {
  nHiresOnly.value = { ...nHiresOnly.value, [field]: on };
}

// "narrowing is on" = the facets differ from their defaults, not merely that
// some facet is set. Apod defaults ON for both chains, so a chain reads as
// narrowing only when its apod is OFF or its ½-toggle is ON.
// Whether ANY per-chain toggle departs from its default. Apod and hide-hires
// default ON (so OFF = engaged); ½-apod and show-only-hires default OFF (so ON =
// engaged). Split out of narrowingActive to keep that predicate's branch count
// under the complexity gate.
function chainTogglesEngaged() {
  return (
    APOD_KEYS.some((k) => !nApod.value[k]) ||
    APOD_KEYS.some((k) => nApodHalf.value[k]) ||
    HIDE_HIRES_KEYS.some((k) => !nHideHires.value[k]) ||
    HIRES_ONLY_KEYS.some((k) => nHiresOnly.value[k])
  );
}

export const narrowingActive = computed(
  () =>
    !!(
      nGenre.value.length ||
      nQuality.value ||
      nFocus.value.length ||
      nPhase.value ||
      nLength.value.length ||
      nRatio.value.length ||
      nUpsampleOnly.value ||
      chainTogglesEngaged()
    ),
);

export function resetNarrowing() {
  nGenre.value = [];
  nQuality.value = 0;
  nFocus.value = [];
  nPhase.value = "";
  nLength.value = [];
  nRatio.value = [];
  nUpsampleOnly.value = false;
  nApod.value = apodDefaults(); // matches the default above, not a bare clear
  nApodHalf.value = halfDefaults();
  nHideHires.value = hideHiresDefaults(); // hide-hires back ON, not cleared
  nHiresOnly.value = hiresOnlyDefaults();
}

// pcm_filter_1x / pcm_filter_nx → "pcm"; sdm_* → "sdm". Selects which side of a
// mode-split ratio (mqa/mp3) to test; null for non-chain callers.
function family(field) {
  if (!field) return null;
  if (field.startsWith("pcm")) return "pcm";
  if (field.startsWith("sdm")) return "sdm";
  return null;
}

// Ratio is the one chain-dependent facet: mqa/mp3 filters upsample-only on PCM
// but any-ratio on SDM, so their facet carries ratioPcm/ratioSdm instead of a
// single ratio. Every other filter has a single `ratio`.
function ratioOf(f, fam) {
  if (f.ratio != null) return f.ratio;
  return fam === "sdm" ? f.ratioSdm : f.ratioPcm;
}

// Filter a filter-field option list by the active facets. Options whose name
// carries no facet data pass through — narrowing hides only what it can
// positively exclude. `current` is never hidden. The apodizing filter applies to
// 1x filters only (stage "1x") and reads THAT dropdown's own state (keyed by
// `field`); Nx filters ignore it. With apod on, full-apodizing filters pass;
// ½-apodizing ones pass only when that chain's ½-toggle is also on.
// Each entry reads "facet not engaged, or the filter passes it", so an unset
// facet excludes nothing. "any" is the escape hatch for genre and ratio — a
// filter the manual marks agnostic survives every selection of that facet.
const FACET_CHECKS = [
  (f, s) => !s.genre.length || s.genre.some((x) => f.genre.includes(x)) || f.genre.includes("any"),
  (f, s) => !s.quality || (f.quality != null && f.quality >= s.quality),
  (f, s) => !s.focus.length || s.focus.some((x) => f.focus.includes(x)),
  (f, s) => !s.phase || f.phase === s.phase,
  (f, s) => !s.length.length || s.length.includes(f.length),
  (f, s) => !s.ratio.length || ratioPass(f, s),
  (f, s) => !s.upsampleOnly || f.upsampleOnly === true,
  (f, s) => !s.apod || f.apodizing || (s.half && f.apodizingHalf),
  // hide-hires (1x): drop the strict *-hires-* set — the mqa/mp3 filters stay,
  // they belong at 1x for lossy sources. show-only-hires (Nx): keep the whole
  // hi-res family, mqa/mp3 included. Each engages only when its flag is set, so
  // an untouched stage excludes nothing.
  (f, s) => !s.hideHires || !f.hires,
  (f, s) => !s.hiresOnly || f.hiresFamily === true,
];

function ratioPass(f, s) {
  const r = ratioOf(f, s.family);
  return r != null && (r === "any" || s.ratio.includes(r));
}

// A filter with no facet record passes untouched — narrowing hides only what it
// can positively exclude (an option not in the active-mode enum nor the static
// overlay carries no facets).
const facetPass = (f, sel) => !f || FACET_CHECKS.every((check) => check(f, sel));

// The active selection snapshot. Number() on quality — the raw signal in
// narrowingActive and this can disagree: a non-numeric value reads as active in
// the bar but narrows nothing. Apod is 1x-only and reads the given chain's own
// keyed state.
function buildSel(stage, field) {
  return {
    genre: nGenre.value,
    quality: Number(nQuality.value),
    focus: nFocus.value,
    phase: nPhase.value,
    length: nLength.value,
    ratio: nRatio.value,
    upsampleOnly: nUpsampleOnly.value,
    family: family(field),
    apod: stage === "1x" && field != null && nApod.value[field] === true,
    half: field != null && nApodHalf.value[field] === true,
    // keyed by the dropdown's own field; the maps only hold each stage's keys,
    // so the flags are inert on the stage they do not belong to.
    hideHires: stage === "1x" && field != null && nHideHires.value[field] === true,
    hiresOnly: field != null && nHiresOnly.value[field] === true,
  };
}

// Any facet actually narrowing? An unset facet excludes nothing, so an
// all-default snapshot returns the option list untouched (same object).
function anyEngaged(s) {
  return (
    s.genre.length ||
    s.quality ||
    s.focus.length ||
    s.phase ||
    s.length.length ||
    s.ratio.length ||
    s.upsampleOnly ||
    s.apod ||
    s.hideHires ||
    s.hiresOnly
  );
}

export function narrowOptions(options, current, stage, field) {
  const sel = buildSel(stage, field);
  if (!anyEngaged(sel)) return options;
  const facets = filterFacets.value;
  return options.filter((o) => String(o.value) === String(current) || facetPass(facets[o.label], sel));
}

// ---- result counts (narrowing UI) -----------------------------------------
// How many options a selection would keep. PURE: unlike narrowOptions it does
// NOT force `current` visible — this is an honest "how many MATCH", the number
// the live badge and the per-option popover previews report, not the dropdown's
// rendered length. An all-default snapshot short-circuits to the full length.
function countPass(options, sel) {
  if (!anyEngaged(sel)) return options.length;
  const facets = filterFacets.value;
  return options.reduce((n, o) => (facetPass(facets[o.label], sel) ? n + 1 : n), 0);
}

// Live badge for one filter dropdown: { n, total } against the ACTIVE facets.
export function narrowCount(options, stage, field) {
  return { n: countPass(options, buildSel(stage, field)), total: options.length };
}

// Per-option popover preview: how many options survive if `overrides` were
// merged onto the current selection (e.g. { genre: [...current, "rock"] }).
export function previewCount(options, stage, field, overrides) {
  return countPass(options, { ...buildSel(stage, field), ...overrides });
}
