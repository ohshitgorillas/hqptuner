// Facet rows and chips for the filter combobox's hover tip — the same
// narrowing facts the narrow bar filters on (store/narrow/facets.js), addressed by
// one filter name and rendered with the narrow bar's own labels so the tip
// and the chips never disagree on a spelling.
import { filterFacets } from "../../store/narrow/facets.js";
import { GENRES, FOCUS, PHASES, LENGTHS, RATIOS } from "./facet-data.js";
import { oneLabel } from "./labels.js";

/** @typedef {import("../../store/narrow/facets.js").FilterFacet} FilterFacet */

// oneLabel's return is as wide as its option tables (string | number | null);
// every value this module looks up labels as a string.
/**
 * @param {import("./facet-data.js").FacetItems} items
 * @param {string} v
 * @returns {string}
 */
const lbl = (items, v) => String(oneLabel(items, v, v));

// "any" is a real ratio class (the manual's any-ratio filters), but the narrow
// table has no row for it — its "" row means "not narrowed" — so it is
// labeled here rather than falling through as the raw lowercase token.
/**
 * @param {string} v
 * @returns {string}
 */
const ratioLbl = (v) => (v === "any" ? "Any" : lbl(RATIOS, v));

// The mode-split filters (mqa/mp3) carry a ratio class per chain instead of
// one; the pair renders as a single row so the tip keeps one line per facet.
/**
 * @param {FilterFacet} f
 * @returns {string}
 */
function ratioValue(f) {
  if (f.ratioPcm != null || f.ratioSdm != null) {
    const parts = [];
    if (f.ratioPcm != null) parts.push(`PCM ${ratioLbl(f.ratioPcm)}`);
    if (f.ratioSdm != null) parts.push(`SDM ${ratioLbl(f.ratioSdm)}`);
    return parts.join(" · ");
  }
  return f.ratio == null ? "" : ratioLbl(f.ratio);
}

// Rows appear only for facets that hold a value, in the narrow bar's own order.
/**
 * @param {FilterFacet} f
 * @returns {[string, string][]}
 */
function facetRows(f) {
  /** @type {[string, string][]} */
  const rows = [];
  if (f.quality != null) rows.push(["Quality", `${f.quality}/5`]);
  if (f.genre.length) rows.push(["Genre", f.genre.map((g) => lbl(GENRES, g)).join(", ")]);
  if (f.focus.length) rows.push(["Focus", f.focus.map((v) => lbl(FOCUS, v)).join(", ")]);
  if (f.phase) rows.push(["Phase", lbl(PHASES, f.phase)]);
  if (f.length) rows.push(["Length", lbl(LENGTHS, f.length)]);
  const ratio = ratioValue(f);
  if (ratio) rows.push(["Ratio", ratio]);
  return rows;
}

/**
 * Facet rows + boolean chips for one filter's hover tip; empty when the name
 * is unknown to the facet map.
 * @param {string} name
 * @returns {{ rows: [string, string][], chips: string[] }}
 */
export function filterTipFacets(name) {
  const f = filterFacets.value[name];
  if (!f) return { rows: [], chips: [] };
  const chips = [];
  if (f.apodizingHalf) chips.push("Half apodizing");
  else if (f.apodizing) chips.push("Apodizing");
  if (f.upsampleOnly) chips.push("Upsample only");
  return { rows: facetRows(f), chips };
}
