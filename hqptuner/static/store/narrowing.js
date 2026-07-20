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
      !nApod.value ||
      nApodHalf.value
    ),
);

export function resetNarrowing() {
  nGenre.value = [];
  nQuality.value = 0;
  nFocus.value = [];
  nPhase.value = "";
  nApod.value = true; // matches the default above, not a bare clear
  nApodHalf.value = false;
}

// Filter a filter-field option list by the active facets. Options whose name
// carries no facet data (not in the active-mode enum) pass through — narrowing
// hides only what it can positively exclude. `current` is never hidden. The
// apodizing filter applies to 1x filters only (stage "1x"); Nx filters don't
// need apodizing, so it's ignored there. With nApod on, full-apodizing filters
// always pass; ½-apodizing ones pass only when nApodHalf is also on.
export function narrowOptions(options, current, stage) {
  const g = nGenre.value;
  const q = Number(nQuality.value);
  const fo = nFocus.value;
  const ph = nPhase.value;
  const ap = nApod.value && stage === "1x";
  const half = nApodHalf.value;
  if (!(g.length || q || fo.length || ph || ap)) return options;
  const facets = filterFacets.value;
  return options.filter((o) => {
    if (String(o.value) === String(current)) return true;
    const f = facets[o.label];
    if (!f) return true;
    if (g.length && !g.some((x) => f.genre.includes(x)) && !f.genre.includes("any")) return false;
    if (q && !(f.quality != null && f.quality >= q)) return false;
    if (fo.length && !fo.some((x) => f.focus.includes(x))) return false;
    if (ph && f.phase !== ph) return false;
    if (ap && !(f.apodizing || (half && f.apodizingHalf))) return false;
    return true;
  });
}
