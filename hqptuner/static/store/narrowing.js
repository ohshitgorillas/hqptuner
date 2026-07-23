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
// apodizing-only (1x filters only) — on by default: apodizing is the sane
// starting point for 1x, and the unfiltered 1x list is 60-77 entries deep.
export const nApod = signal(true);
export const nApodHalf = signal(false); // also show ½-apodizing (only with nApod)

// "narrowing is on" = the facets differ from their defaults, not merely that
// some facet is set. nApod defaults ON, so comparing it against `true` keeps a
// fresh page from reading as already-narrowed.
export const narrowingActive = computed(
  () =>
    !!(
      nGenre.value.length ||
      nQuality.value ||
      nFocus.value.length ||
      nPhase.value ||
      nLength.value.length ||
      !nApod.value ||
      nApodHalf.value
    ),
);

export function resetNarrowing() {
  nGenre.value = [];
  nQuality.value = 0;
  nFocus.value = [];
  nPhase.value = "";
  nLength.value = [];
  nApod.value = true; // matches the default above, not a bare clear
  nApodHalf.value = false;
}

// Filter a filter-field option list by the active facets. Options whose name
// carries no facet data (not in the active-mode enum) pass through — narrowing
// hides only what it can positively exclude. `current` is never hidden. The
// apodizing filter applies to 1x filters only (stage "1x"); Nx filters don't
// need apodizing, so it's ignored there. With nApod on, full-apodizing filters
// always pass; ½-apodizing ones pass only when nApodHalf is also on.
// Does this filter satisfy one facet? Each entry reads "facet not engaged, or
// the filter passes it", so an unset facet excludes nothing. A table rather than
// a chain of ifs: six inline `active && !passes` guards in one function is the
// shape that put this over the complexity ceiling.
//
// "any" is the genre escape hatch — a filter the manual marks as genre-agnostic
// survives every genre selection.
const FACET_CHECKS = [
  (f, s) => !s.genre.length || s.genre.some((x) => f.genre.includes(x)) || f.genre.includes("any"),
  (f, s) => !s.quality || (f.quality != null && f.quality >= s.quality),
  (f, s) => !s.focus.length || s.focus.some((x) => f.focus.includes(x)),
  (f, s) => !s.phase || f.phase === s.phase,
  (f, s) => !s.length.length || s.length.includes(f.length),
  (f, s) => !s.apod || f.apodizing || (s.half && f.apodizingHalf),
];

const facetPass = (f, sel) => FACET_CHECKS.every((check) => check(f, sel));

export function narrowOptions(options, current, stage) {
  const sel = {
    genre: nGenre.value,
    // Number() here and the raw signal in narrowingActive can disagree: a
    // non-numeric value reads as active in the bar but narrows nothing.
    quality: Number(nQuality.value),
    focus: nFocus.value,
    phase: nPhase.value,
    length: nLength.value,
    apod: nApod.value && stage === "1x",
    half: nApodHalf.value,
  };
  const engaged = sel.genre.length || sel.quality || sel.focus.length || sel.phase || sel.length.length || sel.apod;
  if (!engaged) return options;
  const facets = filterFacets.value;
  return options.filter((o) => {
    if (String(o.value) === String(current)) return true;
    const f = facets[o.label];
    return !f || facetPass(f, sel);
  });
}
