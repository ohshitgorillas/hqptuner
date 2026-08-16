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
// Minimum quality. 0 = any, else the floor (3 | 4 | 5). The default is a floor
// rather than "any": 13 of the 68 rated filters sit below 3, and none of them is
// what a first look at the menu should be offering. Like the stage switches, an
// explicit "Any quality" reads as narrowing — the user asked for the wide list.
export const QUALITY_DEFAULT = 3;
export const nQuality = signal(QUALITY_DEFAULT);
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

// Apodizing narrowing is PER-STAGE, not per-chain (user decision): one state
// each for 1x and Nx, shared by PCM and SDM, driven by the segmented switches
// on the narrow bar. Values: "all" (no narrowing), "only" (full-apodizing
// filters only), "half" ("only" plus the ½-apodizing set). Both stages default
// to "all" so neither list starts narrowed.
export const APOD_1X_DEFAULT = "all";
export const APOD_NX_DEFAULT = "all";
export const nApod1x = signal(APOD_1X_DEFAULT);
export const nApodNx = signal(APOD_NX_DEFAULT);

// Lossy narrowing is 1x ONLY. The filters it groups on reduce ultrasonic noise
// where the source has any: at 1x that is lossy material, since a 44.1/48 kHz
// lossless source carries nothing above its own Nyquist for them to act on. At
// Nx every source has an ultrasonic band, so the manual's Ratio "Any" applies
// and there is no narrowing advice to give — the Nx list is never narrowed on
// this axis. Values: "both" (no narrowing), "lossless" (drop the family),
// "lossy" (keep only the family).
export const LOSSY_1X_DEFAULT = "both";
export const nLossy1x = signal(LOSSY_1X_DEFAULT);

// Source format is the one facet that narrows no dropdown: it discloses the DSD
// Sources subsections of the two chain cards rather than filtering options.
// Those subsections carry no facet data — only the four filter dropdowns do
// (store/schema.js `narrow:`) — so this never reaches narrowmatch. It lives here
// anyway because it is a narrow-bar control: it belongs to the same reset, the
// same active state and the same store as the facets beside it. Values: "pcm"
// (the DSD sections stay shut) and "both".
export const SRC_FORMAT_DEFAULT = "pcm";
export const nSrcFormat = signal(SRC_FORMAT_DEFAULT);

// "narrowing is on" = the facets differ from their defaults, not merely that
// some facet is set. Every switch defaults to its own neutral value, so a fresh
// bar narrows nothing and reads as inactive. The whole switch row answers here
// rather than term by term in narrowingActive, which keeps that predicate under
// the complexity gate as the row grows.
function switchesEngaged() {
  return (
    nApod1x.value !== APOD_1X_DEFAULT ||
    nApodNx.value !== APOD_NX_DEFAULT ||
    nLossy1x.value !== LOSSY_1X_DEFAULT ||
    nSrcFormat.value !== SRC_FORMAT_DEFAULT
  );
}

export const narrowingActive = computed(
  () =>
    !!(
      nGenre.value.length ||
      nQuality.value !== QUALITY_DEFAULT ||
      nFocus.value.length ||
      nPhase.value ||
      nLength.value ||
      nHideLimited.value !== RATE_RULE_DEFAULT ||
      nOddRateOnly.value ||
      nDownsafeOnly.value ||
      nFavOnly.value ||
      switchesEngaged()
    ),
);

/** Clear every narrow-bar facet, putting the per-stage switches back to their defaults rather than blank. */
export function resetNarrowing() {
  nGenre.value = [];
  nQuality.value = QUALITY_DEFAULT; // back to the 3/5 floor, not to "any"
  nFocus.value = [];
  nPhase.value = "";
  nLength.value = "";
  nHideLimited.value = RATE_RULE_DEFAULT;
  nOddRateOnly.value = false;
  nDownsafeOnly.value = false;
  nFavOnly.value = false; // the switch only — reset clears narrowing, never the stars
  nApod1x.value = APOD_1X_DEFAULT; // back to per-stage defaults, not a bare clear
  nApodNx.value = APOD_NX_DEFAULT;
  nLossy1x.value = LOSSY_1X_DEFAULT;
  nSrcFormat.value = SRC_FORMAT_DEFAULT; // shuts the DSD Sources sections again

  nGenreMode.value = GENRE_MODE_DEFAULT; // back to per-facet defaults, which differ
  nFocusMode.value = FOCUS_MODE_DEFAULT;
}
