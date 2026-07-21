// Dropdown option builders. Filter/shaper/DSD selects take their options from
// the daemon's own form (/config or /matrix) — the sole authority for the
// per-field option set. Live-lane menus (mode/backend/rate) are fixed lists in
// schema.js; the mode segment is the http `mode` field, not the volatile live
// enumeration, so no enum-derived option building lives here anymore.

import { configByName, matrixByName, metadata, effective } from "./state.js";

// Gray shaper (dither/modulator) options the selected output rate can't reach.
// Only the minimum-rate floor is enforced (min_rate_hz in the static shapers
// overlay): those are the meaningful "needs a higher rate" cases the user can
// fix by raising the ceiling. A max-rate cap is deliberately NOT grayed — a
// shaper whose max is below any realistic ceiling (e.g. Gauss1 at 96 kHz) would
// be permanently unselectable, which is worse than leaving it pickable. The
// target rate is the per-family ceiling (pcm_rate / sdm_rate). Native <option
// disabled> — the Dropdown appends the reason to the option label (title attrs
// on <option> don't hover reliably cross-browser).
function fmtRate(hz, kind) {
  return kind === "sdm" ? `${(hz / 1e6).toFixed(1)} MHz` : `${(hz / 1000).toFixed(1)} kHz`;
}

export function grayShapersByRate(options, kind) {
  const shapers = metadata.value && metadata.value.shapers;
  if (!shapers) return options;
  const db = kind === "sdm" ? shapers.sdm_modulators : shapers.pcm_dithers;
  const rate = Number(effective(kind === "sdm" ? "sdm_rate" : "pcm_rate"));
  if (!db || !rate) return options;
  return options.map((o) => {
    const e = db[o.label];
    if (e && e.min_rate_hz && rate < e.min_rate_hz) {
      return { ...o, disabled: true, reason: `needs ≥ ${fmtRate(e.min_rate_hz, kind)}` };
    }
    return o;
  });
}

// optionsFor(kind, field) -> [{value, label, disabled, reason}]
// kind: 'config' (a /config form field) | 'matrix' (a /matrix form field).
export function optionsFor(kind, field) {
  const map = kind === "matrix" ? matrixByName.value : configByName.value;
  const f = map[field];
  return ((f && f.options) || []).map((o) => ({ value: o.value, label: o.label, disabled: false, reason: "" }));
}
