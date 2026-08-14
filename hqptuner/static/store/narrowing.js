// Client-side filter narrowing — HQPTuner's own feature (no daemon field): the
// filter menus are 60-77 entries, so the narrow bar filters which options show
// by facet. Purely presentational: it never changes a staged value, only what
// the dropdown offers. The current selection gets no exemption: it lists only
// when it passes the facets, so what the menu shows is exactly the batch the
// facets describe. Nothing is lost by that — dismissing the dropdown without
// picking a row leaves the selection where it was, and the closed control still
// names it (components/controls/Combobox.js `valueLabel`).
import { signal, computed } from "@preact/signals";
import { nFavOnly } from "./favorites.js";

export const nGenre = signal([]); // multi-select: pop | rock | jazz | … ([] = any)
export const nQuality = signal(0); // 0 = any, else minimum quality (3 | 4 | 5)
export const nFocus = signal([]); // multi-select: transients | timbre | space

// How the two multi-select facets combine their picks: "and" keeps only filters
// carrying every pick, "or" keeps filters carrying at least one. The defaults
// differ by facet (user decision) because the tag data does. 28 of 68 filters
// carry exactly one genre, so genre AND is the discriminating read of two picks;
// focus tags are sparser still and 21 filters carry exactly one, so focus AND on
// two picks answers with a near-empty list — focus reads OR. A mode narrows
// nothing on its own: with that facet unpicked it is inert.
export const GENRE_MODE_DEFAULT = "and";
export const FOCUS_MODE_DEFAULT = "or";
export const nGenreMode = signal(GENRE_MODE_DEFAULT);
export const nFocusMode = signal(FOCUS_MODE_DEFAULT);
export const nPhase = signal(""); // "" = any (linear | minimum | intermediate)
// Length is SINGLE-select, unlike genre and focus: a filter carries exactly
// one length, so an intersection of two picks is empty by construction and a
// multi-select would offer a choice it cannot honour. "" = any.
export const nLength = signal("");
// Rate-change narrowing. The manual's ratio column names LIMITATIONS (2x-only,
// integer-only, upsample-only), and nobody shops FOR a limitation — the user's
// scenario decides which limitation would bite, so the control is three
// scenario rules rather than a "show only class X" pick. Any-ratio filters and
// `none` (1:1) survive all three.
//
// The 2x and integer classes are one merged "rate-limited" rule: on
// HQPTuner's rate grid (power-of-two family tiers) the two classes pass and
// fail together for family-based sources, so they hide together. The one case
// they differ — an uncommon source rate like 32 kHz, which integer filters can
// still reach (3x48k) and 2x-only filters cannot — gets its own rule.
//
// The rate-limited rule is TRI-STATE: "auto" (default) follows the DAC — when
// the output mode is SDM and the device exposes no 48 kHz-family DSD rate,
// rate-limited filters cannot produce output from 48 kHz-family sources, so
// "auto" hides them (narrowmatch.js resolves it against the live rates enum).
// "on"/"off" are the user's explicit override either way. Only an explicit
// value reads as engaged — the auto default is not a changed field.
export const RATE_RULE_DEFAULT = "auto";
export const nHideLimited = signal(RATE_RULE_DEFAULT); // hide 2x- and integer-class filters: auto | on | off
export const nOddRateOnly = signal(false); // show only filters that resample uncommon source rates (hide 2x class)
export const nDownsafeOnly = signal(false); // show only downsampling-capable (hide upsample-only)

// Apodizing and hi-res narrowing are PER-STAGE, not per-chain (user decision):
// one state each for 1x and Nx, shared by PCM and SDM, driven by the segmented
// switches on the narrow bar. Apodizing values: "all" (no narrowing), "only"
// (full-apodizing filters only), "half" ("only" plus the ½-apodizing set). 1x
// defaults to "only" — the unfiltered 1x list is 60-77 entries and apodizing is
// the sane starting point; Nx defaults to "all" so its list starts untouched.
export const APOD_1X_DEFAULT = "only";
export const APOD_NX_DEFAULT = "all";
export const nApod1x = signal(APOD_1X_DEFAULT);
export const nApodNx = signal(APOD_NX_DEFAULT);

// Hi-res narrowing splits by stage: the 1x switch HIDES hi-res filters
// ("hide" | "show", default "hide" — 1x covers base rates where the
// hi-res/lossy-tuned filters are off-topic), the Nx switch does the inverse and
// restricts to the hi-res family ("all" | "only", default "all").
export const HIRES_1X_DEFAULT = "hide";
export const HIRES_NX_DEFAULT = "all";
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
      nHideLimited.value !== RATE_RULE_DEFAULT ||
      nOddRateOnly.value ||
      nDownsafeOnly.value ||
      nFavOnly.value ||
      stageTogglesEngaged()
    ),
);

/** Clear every narrow-bar facet, putting the per-stage switches back to their defaults rather than blank. */
export function resetNarrowing() {
  nGenre.value = [];
  nQuality.value = 0;
  nFocus.value = [];
  nPhase.value = "";
  nLength.value = "";
  nHideLimited.value = RATE_RULE_DEFAULT;
  nOddRateOnly.value = false;
  nDownsafeOnly.value = false;
  nFavOnly.value = false; // the switch only — reset clears narrowing, never the stars
  nApod1x.value = APOD_1X_DEFAULT; // back to per-stage defaults, not a bare clear
  nApodNx.value = APOD_NX_DEFAULT;
  nHires1x.value = HIRES_1X_DEFAULT; // 1x hi-res back to "hide", not cleared
  nHiresNx.value = HIRES_NX_DEFAULT;
  nGenreMode.value = GENRE_MODE_DEFAULT; // back to per-facet defaults, which differ
  nFocusMode.value = FOCUS_MODE_DEFAULT;
}
