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

// The DSD tier a modulator's rate floor names, as the row badge says it: "512+"
// for a modulator that needs DSD512 or higher. Derived from the SAME
// `min_rate_hz` the graying above reads rather than from the name, because four
// modulators (AHM5EC5L, AHM7EC5L, AHM5EC8B, AHM7EC8B) carry a 40.96 MHz floor
// and no rate in their name at all — a badge parsed out of the name would miss
// exactly the 1024+ ones.
//
// The floors are not all exact multiples of a DSD base (20480000 is neither
// 44.1k nor 48k times 512), so the tier is the nearest power of two to the
// floor in DSD64 terms rather than an equality: 10.24 MHz reads 256+, 20.48 and
// 22.5792 MHz read 512+, 40.96 MHz reads 1024+.
const DSD_BASE_HZ = 44100;
/**
 * The tier text a modulator's rate floor names, or null for a modulator with no
 * floor or no record in the shaper overlay.
 * @param {string} name the raw engine name, the overlay's own join key
 * @returns {string | null}
 */
export function modulatorTier(name) {
  const shapers = metadata.value && metadata.value.shapers;
  const entry = shapers && shapers.sdm_modulators && shapers.sdm_modulators[name];
  const floor = entry && entry.min_rate_hz;
  if (!floor) return null;
  return `${2 ** Math.round(Math.log2(floor / DSD_BASE_HZ))}+`;
}

// The generation a modulator belongs to, as the hover tip's own metadata row —
// read off the same shaper overlay, by the same name join, as the tier badge
// above. Generation is the manual's §4.5 column: the design lineage Signalyst
// states, NOT a rating, so the row says the ordinal and stops there.
//
// The suffix is a table rather than a general ordinal rule because the column
// is a closed 1-8 and a rule would have to handle teens and 21st for callers
// that do not exist. Index 0 is unused and empty, so a generation the overlay
// carries but this table does not know contributes no row at all.
const GENERATION_ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
/**
 * One metadata row naming a modulator's generation, or no row at all when the
 * overlay has no entry for the name and when the entry carries no generation.
 * The tuple is a tip row: facet key, heading, the value the reader sees, and the
 * raw code it was built from (components/narrowbar/facettip.js FacetRow).
 * @param {string} name the raw engine name, the overlay's own join key
 * @returns {[string, string, string, string[]][]}
 */
export function modulatorTipRows(name) {
  const shapers = metadata.value && metadata.value.shapers;
  const entry = shapers && shapers.sdm_modulators && shapers.sdm_modulators[name];
  const gen = entry && entry.generation;
  const ordinal = gen ? GENERATION_ORDINALS[gen] || "" : "";
  return ordinal ? [["generation", "Generation", ordinal, [String(gen)]]] : [];
}

// The trailing rate in a modulator's engine name ("ASDM7EC-super 512+fs"), which
// the row badge now says on its own. Stripped for DISPLAY only: `label` stays
// the raw engine name, because every join in the app is by that name, and the
// closed control keeps naming the selection in full.
const RATE_SUFFIX = / \d+\+fs$/;
/**
 * Set each option's display text to its name without the trailing rate suffix.
 * @template {{ label: string }} T
 * @param {T[]} options
 * @returns {(T | (T & { display: string }))[]}
 */
export function stripRateSuffix(options) {
  return options.map((o) => (RATE_SUFFIX.test(o.label) ? { ...o, display: o.label.replace(RATE_SUFFIX, "") } : o));
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

// Superseded single-stage filters, on the SDM chain only. A filter whose
// two-stage `-2s` twin is in the same list has no reason to be picked there, so
// it is not offered and not counted. The rule reads the list it was handed
// rather than a shipped name table: the running engine is the sole authority for
// which filters exist (architecture §2), and a `-2s` the engine stops
// enumerating brings its plain twin straight back.
//
// One name survives the prune: whatever the field is currently set to. The
// closed control and its prose read their label off this same list
// (store/prose.js selectedLabel), so dropping the running selection would leave
// the control naming nothing.
/**
 * A filter option list without the single-stage filters their own two-stage
 * variant supersedes, keeping the one the field is set to.
 * @template {{ value?: string | number, label: string }} T
 * @param {T[]} options
 * @param {string | number | boolean} keep the option VALUE that stays listed however it joins
 * @returns {T[]}
 */
export function dropSupersededTwoStage(options, keep) {
  const names = new Set(options.map((o) => o.label));
  return options.filter((o) => !names.has(`${o.label}-2s`) || String(o.value) === String(keep));
}

// The two SDM chain filter fields, by their /config form name, paired with the
// schema key holding the selection the prune spares. The PCM pair (filter1x,
// filter) is deliberately absent: both chains enumerate the same filters and the
// rule is the SDM chain's alone.
/** @type {Record<string, string>} */
const SDM_FILTER_FIELDS = { oversampling1x: "sdm_filter_1x", oversampling: "sdm_filter_nx" };

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
  const built = ((f && f.options) || []).map((o) => ({
    value: o.value,
    label: o.label,
    disabled: false,
    reason: "",
  }));
  const key = kind === "config" ? SDM_FILTER_FIELDS[field] : "";
  return key ? dropSupersededTwoStage(built, String(effective(key))) : built;
}
