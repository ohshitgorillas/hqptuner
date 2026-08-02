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
// Length and ratio are SINGLE-select, unlike genre and focus: a filter carries
// exactly one length and one ratio class, so an intersection of two picks is
// empty by construction and a multi-select would offer a choice it cannot
// honour. "" = any.
export const nLength = signal("");
export const nRatio = signal("");
// ratio-dropdown extra: the manual fuses "up" (upsample-only) INTO the ratio
// column ("Integer up"). Not a ratio class — orthogonal — so it rides as a
// checkbox in the ratio popover, ANDing with any ratio class picked.
export const nUpsampleOnly = signal(false);

// Apodizing and hi-res narrowing are PER-STAGE, not per-chain (user decision):
// one state each for 1x and Nx, shared by PCM and SDM, driven by the segmented
// switches on the narrow bar. Apodizing values: "all" (no narrowing), "only"
// (full-apodizing filters only), "half" ("only" plus the ½-apodizing set). 1x
// defaults to "only" — the unfiltered 1x list is 60-77 entries and apodizing is
// the sane starting point; Nx defaults to "all" so its list starts untouched.
const APOD_1X_DEFAULT = "only";
const APOD_NX_DEFAULT = "all";
export const nApod1x = signal(APOD_1X_DEFAULT);
export const nApodNx = signal(APOD_NX_DEFAULT);

// Hi-res narrowing splits by stage: the 1x switch HIDES hi-res filters
// ("hide" | "show", default "hide" — 1x covers base rates where the
// hi-res/lossy-tuned filters are off-topic), the Nx switch does the inverse and
// restricts to the hi-res family ("all" | "only", default "all").
const HIRES_1X_DEFAULT = "hide";
const HIRES_NX_DEFAULT = "all";
export const nHires1x = signal(HIRES_1X_DEFAULT);
export const nHiresNx = signal(HIRES_NX_DEFAULT);

// "narrowing is on" = the facets differ from their defaults, not merely that
// some facet is set — each stage switch reads as narrowing only when it departs
// from its own default (1x apod defaults "only", 1x hi-res defaults "hide").
function stageTogglesEngaged() {
  return (
    nApod1x.value !== APOD_1X_DEFAULT ||
    nApodNx.value !== APOD_NX_DEFAULT ||
    nHires1x.value !== HIRES_1X_DEFAULT ||
    nHiresNx.value !== HIRES_NX_DEFAULT
  );
}

export const narrowingActive = computed(
  () =>
    !!(
      nGenre.value.length ||
      nQuality.value ||
      nFocus.value.length ||
      nPhase.value ||
      nLength.value ||
      nRatio.value ||
      nUpsampleOnly.value ||
      stageTogglesEngaged()
    ),
);

export function resetNarrowing() {
  nGenre.value = [];
  nQuality.value = 0;
  nFocus.value = [];
  nPhase.value = "";
  nLength.value = "";
  nRatio.value = "";
  nUpsampleOnly.value = false;
  nApod1x.value = APOD_1X_DEFAULT; // back to per-stage defaults, not a bare clear
  nApodNx.value = APOD_NX_DEFAULT;
  nHires1x.value = HIRES_1X_DEFAULT; // 1x hi-res back to "hide", not cleared
  nHiresNx.value = HIRES_NX_DEFAULT;
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
// positively exclude. `current` is never hidden. The apodizing check reads the
// dropdown's STAGE switch (1x or Nx): on "only", full-apodizing filters pass;
// ½-apodizing ones pass only on "half".
// Each entry reads "facet not engaged, or the filter passes it", so an unset
// facet excludes nothing. "any" is the escape hatch for genre and ratio — a
// filter the manual marks agnostic survives every selection of that facet.
//
// Multi-select facets (genre, focus) INTERSECT: every value picked must hold, so
// each further pick narrows. Picking Transients then Space leaves the filters
// tagged both, which is what the per-option counts promise.
const FACET_CHECKS = [
  (f, s) => !s.genre.length || s.genre.every((x) => f.genre.includes(x)) || f.genre.includes("any"),
  (f, s) => !s.quality || (f.quality != null && f.quality >= s.quality),
  (f, s) => !s.focus.length || s.focus.every((x) => f.focus.includes(x)),
  (f, s) => !s.phase || f.phase === s.phase,
  (f, s) => !s.length || f.length === s.length,
  (f, s) => !s.ratio || ratioPass(f, s),
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
  return r != null && (r === "any" || r === s.ratio);
}

// A filter with no facet record passes untouched — narrowing hides only what it
// can positively exclude (an option not in the active-mode enum nor the static
// overlay carries no facets).
const facetPass = (f, sel) => !f || FACET_CHECKS.every((check) => check(f, sel));

// The active selection snapshot. Number() on quality — the raw signal in
// narrowingActive and this can disagree: a non-numeric value reads as active in
// the bar but narrows nothing. Apod and hi-res read the dropdown's STAGE
// switch; `field` only selects the ratio family (pcm vs sdm).
function buildSel(stage, field) {
  const apod = stage === "1x" ? nApod1x.value : nApodNx.value;
  return {
    genre: nGenre.value,
    quality: Number(nQuality.value),
    focus: nFocus.value,
    phase: nPhase.value,
    length: nLength.value,
    ratio: nRatio.value,
    upsampleOnly: nUpsampleOnly.value,
    family: family(field),
    apod: apod !== "all",
    half: apod === "half",
    hideHires: stage === "1x" && nHires1x.value === "hide",
    hiresOnly: stage === "nx" && nHiresNx.value === "only",
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
    s.length ||
    s.ratio ||
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
