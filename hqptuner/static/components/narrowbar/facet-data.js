// The narrowing bar's facet option tables — the [value, label] rows each
// dropdown renders. Its own module because these are static data the manual
// dictates, read by both the facet assembly and the label helpers; keeping them
// apart from the widgets means a manual-driven data edit never touches render
// code.

/**
 * @typedef {(string | number)[][]} FacetItems
 *   A facet's rows as [value, label] pairs.
 */

export const GENRES = [
  ["pop", "Pop & rock"],
  ["jazz", "Jazz & blues"],
  ["classical", "Classical"],
  ["electronic", "Electronic"],
  // the manual's genre-agnostic tag — a real facet value ("this filter suits
  // ALL genres"), distinct from the empty selection the button calls "Any
  // genre", which means "not narrowed by genre at all"
  ["any", "All genres"],
];
export const QUALITY = [
  [0, "Any quality"],
  [3, "Quality: ≥ 3/5"],
  [4, "Quality: ≥ 4/5"],
  [5, "Quality: 5/5"],
];
export const FOCUS = [
  ["transients", "Transients"],
  ["timbre", "Timbre"],
  ["space", "Space"],
];
export const PHASES = [
  ["minimum", "Minimum"],
  ["intermediate", "Intermediate"],
  ["linear", "Linear"],
  // the filters the phase taxonomy does not reach (store/narrow/facets.js `phase`) —
  // a real facet value, distinct from the empty selection the button calls
  // "Any phase", which means "not narrowed by phase at all"
  ["", "Unspecified"],
];
export const LENGTHS = [
  ["xshort", "Extra-short"],
  ["short", "Short"],
  ["medium", "Medium"],
  ["long", "Long"],
  ["xlong", "Extra-long"],
  ["stupid", "Stupid long"],
  // a trait rather than one more bucket — matching reads the filter's adaptive
  // flag, held alongside its length (store/narrow/match.js), so this row keeps
  // sinc-S even though its length is short
  ["adaptive", "Adaptive"],
  // the filters no name token or description classifies (store/narrow/facets.js
  // `length`) — a real facet value, distinct from the empty selection the button
  // calls "Any length", which means "not narrowed by length at all". Picking it
  // beside named lengths is what keeps an unclassified filter in a list narrowed
  // to exclude one length.
  ["", "Unspecified"],
];
// Ratio-class display names — no longer a dropdown's rows (the rate-change
// facet is three hide rules, Facets.js), but facettip.js still labels a
// filter's own ratio class through this table.
export const RATIOS = [
  ["", "Any ratio"],
  ["integer", "Integer"],
  ["2x", "2x"],
  ["1:1", "1:1"],
];
