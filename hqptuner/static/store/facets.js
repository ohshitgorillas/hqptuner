// Per-filter facet map for the narrowing UI. Joins the live filter enumeration
// (the authority for names/arg/description — outline §2) with the static genre
// overlay the backend already merged onto each item (`static.genre`). Facets:
//   genre     - array from filters.json ("any" matches every genre filter)
//   quality   - integer 1-5 parsed from the live description ("Q/5 … ⥮ ratio")
//   focus     - transients/timbre/space tokens between the quality and "⥮"
//   phase     - linear / minimum / intermediate, encoded in the filter name
//   apodizing - arg bit 0 (full apodizing); apodizingHalf - arg bit 1 (½ apodizing)
import { computed } from "@preact/signals";
import { enums } from "./state.js";

function quality(desc) {
  const m = /(\d+)\s*\/\s*5/.exec(desc || "");
  return m ? Number(m[1]) : null;
}

// "4/5 space, transients ⥮ Any" -> ["space", "transients"]; "1/5 ⥮ 1:1" -> []
function focus(desc) {
  const m = /^\s*\d+\/5\s*(.*?)\s*⥮/.exec(desc || "");
  if (!m || !m[1]) return [];
  return m[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function phase(name) {
  const n = name || "";
  if (/-ip\b|-ip$/.test(n)) return "intermediate";
  if (/-mp\b|-mp$|min/i.test(n)) return "minimum";
  if (/-lp\b|-lp$/.test(n)) return "linear";
  return "";
}

// length — short / medium / long / xlong. Letter-coded names don't carry a
// readable token, so they get explicit entries grounded in the manual /
// filters.json tap counts: the sinc letter series (S=4096×ratio, M/Mx/MG/MGa =
// million taps and "variants of poly-sinc-ext2-xla / gauss-xl(a)" → xlong,
// L=131070×, Ls=4096×, Lm/Lh=16384×, Ll=65536×), the million-tap closed-forms
// (xlong), gauss-halfband-s ("Short … Gaussian"), the polynomial interpolators
// and minringFIR ("ringing between polynomial and poly-sinc-short"). Everything
// else classifies by name token — xl/xla ("8-times-longer" variants) are xlong;
// short / long / hb-s / hb-xs / hb-l as written — with the -2s two-stage suffix
// stripped first; unmarked names read as medium.
const LENGTH_OVERRIDES = {
  "sinc-S": "short",
  "sinc-M": "xlong",
  "sinc-Mx": "xlong",
  "sinc-MG": "xlong",
  "sinc-MGa": "xlong",
  "sinc-L": "long",
  "sinc-Ls": "short",
  "sinc-Lm": "medium",
  "sinc-Ll": "long",
  "sinc-Lh": "medium",
  "closed-form-M": "xlong",
  "closed-form-16M": "xlong",
  "poly-sinc-gauss-halfband-s": "short",
  "polynomial-1": "short",
  "polynomial-2": "short",
  "minringFIR-lp": "short",
  "minringFIR-mp": "short",
};
function length(name) {
  const n = name || "";
  const base = n.endsWith("-2s") ? n.slice(0, -3) : n;
  if (LENGTH_OVERRIDES[base]) return LENGTH_OVERRIDES[base];
  if (/short|shrt|-hb-xs$|-hb-s$/.test(base)) return "short";
  if (/-xla?$/.test(base)) return "xlong";
  if (/long|-hb-l$/.test(base)) return "long";
  return "medium";
}

// name -> {genre:[], quality:int|null, focus:[], phase:string, apodizing:bool}
export const filterFacets = computed(() => {
  const map = {};
  for (const it of (enums.value && enums.value.filters) || []) {
    map[it.name] = {
      genre: (it.static && it.static.genre) || [],
      quality: quality(it.description),
      focus: focus(it.description),
      phase: phase(it.name),
      length: length(it.name),
      apodizing: !!it.apodizing,
      apodizingHalf: (Number(it.arg) & 2) === 2,
    };
  }
  return map;
});
