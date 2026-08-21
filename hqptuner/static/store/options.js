// Dropdown option builders. Filter/shaper/DSD selects take their options from
// the daemon's own form (/config or /matrix) — the sole authority for the
// per-field option set. Live-lane menus (mode/backend/rate) are fixed lists in
// schema.js; the mode segment is the http `mode` field, not the volatile live
// enumeration, so no enum-derived option building lives here anymore.

import { metadata, enums } from "./signals.js";
import { configByName, matrixByName, effective } from "./resolve.js";
import { hz } from "../lib/units.js";

// Gray shaper (dither/modulator) options the selected output rate can't reach.
// Only the minimum-rate floor is enforced (min_rate_hz in the static shapers
// overlay): those are the meaningful "needs a higher rate" cases the user can
// fix by raising the ceiling. A max-rate cap is deliberately NOT grayed — a
// shaper whose max is below any realistic ceiling (e.g. Gauss1 at 96 kHz) would
// be permanently unselectable, which is worse than leaving it pickable. The
// target rate is the per-family ceiling (pcm_rate / sdm_rate). Native <option
// disabled> — the Dropdown appends the reason to the option label (title attrs
// on <option> don't hover reliably cross-browser).
/**
 * Disable the shaper options whose minimum rate is above the selected output rate,
 * with that floor as the reason.
 * @template {{ label: string }} T
 * @param {T[]} options
 * @param {string} kind "pcm" | "sdm"
 * @returns {(T | (T & { disabled: boolean, reason: string }))[]}
 */
export function grayShapersByRate(options, kind) {
  const shapers = metadata.value && metadata.value.shapers;
  if (!shapers) return options;
  const db = kind === "sdm" ? shapers.sdm_modulators : shapers.pcm_dithers;
  const rate = Number(effective(kind === "sdm" ? "sdm_rate" : "pcm_rate"));
  if (!db || !rate) return options;
  return options.map((o) => {
    const e = db[o.label];
    if (e && e.min_rate_hz && rate < e.min_rate_hz) {
      // 3dp, not 1: the SDM floors are rates people recognize, and rounding
      // 40.96 MHz to "41 MHz" names a rate that does not exist.
      return { ...o, disabled: true, reason: `needs ≥ ${hz(e.min_rate_hz, 3)}` };
    }
    return o;
  });
}

// Live-enum option source (schema `optionsFrom: 'enum'` + `enumKey`), for the
// 4321-lane controls that have no /config form field to take options from. The
// running engine is the sole authority for names AND ordering (architecture §2), and
// Set* writes the LIST INDEX rather than the enum id (docs/protocol.md §4) — so
// `index` is the value, never a shipped constant.
/**
 * A named live enumeration as menu options, each valued by its list index.
 * @param {string} name
 * @returns {OptionItem[]}
 */
export function enumOptions(name) {
  /** @type {import("./narrow/facets.js").EnumItem[]} */
  const list = (enums.value && enums.value[name]) || [];
  return list.map((o) => ({ value: o.index, label: o.name, disabled: false, reason: "" }));
}

// kind: 'config' (a /config form field) | 'matrix' (a /matrix form field).
/**
 * One daemon form field's own options, as menu options — empty when the form has no
 * such field.
 * @param {string} kind
 * @param {string} field
 * @returns {OptionItem[]}
 */
export function optionsFor(kind, field) {
  /** @type {Record<string, import("./resolve.js").FormField>} */
  const map = kind === "matrix" ? matrixByName.value : configByName.value;
  const f = map[field];
  return ((f && f.options) || []).map((o) => ({ value: o.value, label: o.label, disabled: false, reason: "" }));
}
