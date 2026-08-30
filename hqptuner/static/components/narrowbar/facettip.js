// Facet rows and chips for the filter combobox's hover tip — the same
// narrowing facts the narrow bar filters on (store/narrow/facets.js), addressed by
// one filter name and rendered with the narrow bar's own labels so the tip
// and the chips never disagree on a spelling.
import { filterFacets } from "../../store/narrow/facets.js";
import { GENRES, FOCUS, PHASES, LENGTHS, RATIOS } from "./facet-data.js";
import { oneLabel } from "./labels.js";

/**
 * @typedef {import("../../store/narrow/facets.js").FilterFacet} FilterFacet
 *
 * @typedef {[string, string, string, string[]]} FacetRow
 *   One row of a filter's hover tip: the facet's key, its heading, the labelled
 *   value the reader sees, and the raw facet codes that value was built from.
 *   Key and codes are the facts; heading and value are words.
 */

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

// The same facts as `ratioValue`, before they are labelled and joined.
/**
 * @param {FilterFacet} f
 * @returns {string[]}
 */
function ratioCodes(f) {
  if (f.ratioPcm != null || f.ratioSdm != null) {
    return [f.ratioPcm, f.ratioSdm].filter((v) => v != null).map(String);
  }
  return f.ratio == null ? [] : [String(f.ratio)];
}

// The Length row carries the adaptive trait beside the bucket: "Short,
// adaptive" for a filter holding both, bare "Adaptive" when the trait is all
// it has. Codes carry the same pair raw.
/**
 * @param {FilterFacet} f
 * @returns {string}
 */
function lengthValue(f) {
  if (!f.adaptive) return lbl(LENGTHS, f.length);
  return f.length ? `${lbl(LENGTHS, f.length)}, adaptive` : lbl(LENGTHS, "adaptive");
}
/**
 * @param {FilterFacet} f
 * @returns {string[]}
 */
function lengthCodes(f) {
  const codes = f.length ? [String(f.length)] : [];
  if (f.adaptive) codes.push("adaptive");
  return codes;
}

// Rows appear only for facets that hold a value, in the narrow bar's own order.
// Each row leads with the facet's own key and ends with the raw facet codes it
// was built from, so a reader of the tip can be asked which facets it shows and
// what they hold without matching on either the heading or the labelled value.
/**
 * @param {FilterFacet} f
 * @returns {FacetRow[]}
 */
function facetRows(f) {
  /** @type {FacetRow[]} */
  const rows = [];
  if (f.quality != null) rows.push(["quality", "Quality", `${f.quality}/5`, [String(f.quality)]]);
  if (f.genre.length) rows.push(["genre", "Genre", f.genre.map((g) => lbl(GENRES, g)).join(", "), f.genre.map(String)]);
  if (f.focus.length) rows.push(["focus", "Focus", f.focus.map((v) => lbl(FOCUS, v)).join(", "), f.focus.map(String)]);
  if (f.phase) rows.push(["phase", "Phase", lbl(PHASES, f.phase), [String(f.phase)]]);
  if (f.length || f.adaptive) rows.push(["length", "Length", lengthValue(f), lengthCodes(f)]);
  const ratio = ratioValue(f);
  if (ratio) rows.push(["ratio", "Ratio", ratio, ratioCodes(f)]);
  return rows;
}

/**
 * Facet rows + boolean chips for one filter's hover tip; empty when the name
 * is unknown to the facet map.
 * @param {string} name
 * @returns {{ rows: FacetRow[], chips: [string, string][] }}
 */
export function filterTipFacets(name) {
  const f = filterFacets.value[name];
  if (!f) return { rows: [], chips: [] };
  /** @type {[string, string][]} */
  const chips = [];
  if (f.apodizingHalf) chips.push(["half-apodizing", "Half apodizing"]);
  else if (f.apodizing) chips.push(["apodizing", "Apodizing"]);
  if (f.upsampleOnly) chips.push(["upsample-only", "Upsample only"]);
  return { rows: facetRows(f), chips };
}
