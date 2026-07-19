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

// name -> {genre:[], quality:int|null, focus:[], phase:string, apodizing:bool}
export const filterFacets = computed(() => {
  const map = {};
  for (const it of (enums.value && enums.value.filters) || []) {
    map[it.name] = {
      genre: (it.static && it.static.genre) || [],
      quality: quality(it.description),
      focus: focus(it.description),
      phase: phase(it.name),
      apodizing: !!it.apodizing,
      apodizingHalf: (Number(it.arg) & 2) === 2,
    };
  }
  return map;
});
