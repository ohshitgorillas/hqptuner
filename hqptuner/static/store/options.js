// Dropdown option builders. Filter/shaper/DSD selects take their options from
// the daemon's own form (/config or /matrix) — the sole authority for the
// per-field option set. Live-lane menus (mode/backend/rate) are fixed lists in
// schema.js; the mode segment is the http `mode` field, not the volatile live
// enumeration, so no enum-derived option building lives here anymore.

import { configByName, matrixByName, metadata, effective, enums } from "./state.js";
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
export function grayShapersByRate(options, kind) {
  const shapers = metadata.value && metadata.value.shapers;
  if (!shapers) return options;
  const db = kind === "sdm" ? shapers.sdm_modulators : shapers.pcm_dithers;
  const rate = Number(effective(kind === "sdm" ? "sdm_rate" : "pcm_rate"));
  if (!db || !rate) return options;
  return options.map((o) => {
    const e = db[o.label];
    if (e && e.min_rate_hz && rate < e.min_rate_hz) {
      // 3dp, not 1: the SDM floors are rates people recognise, and rounding
      // 40.96 MHz to "41 MHz" names a rate that does not exist.
      return { ...o, disabled: true, reason: `needs ≥ ${hz(e.min_rate_hz, 3)}` };
    }
    return o;
  });
}

// Live-enum option source (schema `optionsFrom: 'enum'` + `enumKey`), for the
// 4321-lane controls that have no /config form field to take options from. The
// running engine is the sole authority for names AND ordering (architecture §2), and
// Set* writes the LIST INDEX rather than the enum id (docs/protocol.md §9) — so
// `index` is the value, never a shipped constant.
export function enumOptions(name) {
  const list = (enums.value && enums.value[name]) || [];
  return list.map((o) => ({ value: o.index, label: o.name, disabled: false, reason: "" }));
}

// optionsFor(kind, field) -> [{value, label, disabled, reason}]
// kind: 'config' (a /config form field) | 'matrix' (a /matrix form field).
export function optionsFor(kind, field) {
  const map = kind === "matrix" ? matrixByName.value : configByName.value;
  const f = map[field];
  return ((f && f.options) || []).map((o) => ({ value: o.value, label: o.label, disabled: false, reason: "" }));
}
