// Where a control's words come from. One control's prose has three possible
// sources and none of them are written here:
//
//   settings.json   label + tooltip per control, keyed by tab group, each entry
//                   citing the manual or readme section it was taken from
//   filters.json    per-filter description, joined by the ENGINE's own filter
//   shapers.json    name (architecture §2: enumerations are the sole authority
//                   for names, static data joins by name)
//
// This module was lifted out of components/Field.js when the LIVE page needed
// the same words for the same controls. Two pages rendering one control from two
// different strings is how a UI ends up disagreeing with itself, so both read
// from here and neither writes prose of its own.

import { metadata } from "./signals.js";
import { schema } from "./schema.js";
import { notesVisible } from "./prefs.js";

// Static per-control prose from settings.json, keyed by tab group. `entry.note`
// names the settings.json key when it differs from the control key (e.g.
// alsa_bits + net_bits both -> "dac_bits", the rate split -> "rate"); it
// defaults to the control key.
/**
 * @typedef {object} ControlProse
 *   One control's settings.json row.
 * @property {string} label
 * @property {string} tooltip
 * @property {Record<string, string>} [options] per-VALUE prose (`desc: "config"`)
 *
 * @typedef {object} OverlayEntry
 *   One filters.json / shapers.json row, as far as this module reads it.
 * @property {string} [description]
 * @property {string} [notes]
 *
 * @typedef {object} Metadata
 *   The static overlay bundle /api/metadata serves.
 * @property {{ filters?: Record<string, OverlayEntry>, aliases?: Record<string, string>,
 *   two_stage_note?: string }} [filters]
 * @property {{ sdm_modulators?: Record<string, OverlayEntry>,
 *   pcm_dithers?: Record<string, OverlayEntry> }} [shapers]
 * @property {Record<string, Record<string, ControlProse>>} [settings]
 */

/**
 * @param {SchemaField} entry
 * @param {string} key
 * @returns {ControlProse}
 */
export function describe(entry, key) {
  const g = (metadata.value && metadata.value.settings && metadata.value.settings[entry.group]) || {};
  return g[entry.note || key] || { label: key, tooltip: "" };
}

// A card gate's note, addressed by control key, for that card's subtitle. The
// subtitle is the same prose a row note carries, so it follows the same pref:
// with the manual text switched off there is no subtitle either. Returns ''
// rather than null so a call site can pass it
// straight to Card (an empty subtitle renders nothing).
/**
 * @param {string} key
 * @returns {string}
 */
export function noteFor(key) {
  if (!notesVisible.value) return "";
  const entry = schema[key];
  return entry ? describe(entry, key).tooltip : "";
}

// The overlays are keyed by the ENGINE's own name, which reaches us as the
// selected option's label.
/**
 * @param {{ value: string | number | undefined, label: string }[] | undefined} options
 * @param {string | number | boolean | undefined} value
 * @returns {string}
 */
function selectedLabel(options, value) {
  const opt = (options || []).find((o) => String(o.value) === String(value));
  return (opt && opt.label) || "";
}

// Filter join rules (data/filters.json _join_rules): exact -> alias -> strip a
// '-2s' suffix and retry, which flags the two-stage variant. Returns the joined
// entry (null on a miss) plus that flag.
/**
 * @param {string} name
 * @param {Record<string, OverlayEntry>} fdb
 * @param {Record<string, string>} aliases
 * @returns {{ entry: OverlayEntry | null, twoStage: boolean }}
 */
function joinFilter(name, fdb, aliases) {
  let n = name;
  let twoStage = false;
  for (;;) {
    const e = fdb[n] || fdb[aliases[n]];
    if (e) return { entry: e, twoStage };
    if (!n.endsWith("-2s")) return { entry: null, twoStage };
    n = n.slice(0, -3);
    twoStage = true;
  }
}

// An overlay entry's prose is its description plus its `notes`, which carry the
// manual's own caveats — "Not recommended.", "Only suitable for highest technical
// quality source materials.", NS1's ultrasonic-noise warning. Those sentences sat
// unread in the data until this joined them, so the UI stayed silent where the
// manual warns. Empty parts drop out rather than leaving a stray separator.
// Parts may be absent — an overlay entry carries `notes` only sometimes — which
// is exactly what the filter drops.
const joinProse = (/** @type {(string | undefined)[]} */ ...parts) => parts.filter(Boolean).join(" ");

// A two-stage filter reads as its base prose plus the shared two-stage note, which
// describes the variant rather than the filter and so comes last.
/**
 * @param {string} name
 * @param {Metadata} md
 * @returns {string}
 */
function filterDescription(name, md) {
  const f = md.filters || {};
  const { entry, twoStage } = joinFilter(name, f.filters || {}, f.aliases || {});
  if (!entry) return "";
  return joinProse(entry.description, entry.notes, twoStage ? f.two_stage_note : "");
}

// desc = dither|modulator -> name-keyed prose from the shapers overlay.
/**
 * @param {string} kind "dither" | "modulator"
 * @param {string} name
 * @param {Metadata} md
 * @returns {string}
 */
function shaperDescription(kind, name, md) {
  const shapers = md.shapers || {};
  const db = kind === "modulator" ? shapers.sdm_modulators : shapers.pcm_dithers;
  const e = db && db[name];
  return e ? joinProse(e.description, e.notes) : "";
}

// Inline manual description for the current selection.
//   desc = filter|dither|modulator -> name-keyed prose from the metadata overlay
//     (filters.json / shapers.json), joined by the selected option's label.
//   desc = config -> per-value prose from this control's settings.json `options`
//     map, keyed by the selected form value (integrator, noise filter, SDM/PCM
//     conversion — enums whose meaning is per-value, not per-control).
/**
 * @param {SchemaField} entry
 * @param {string | number | boolean | undefined} value
 * @param {{ value: string | number | undefined, label: string }[] | undefined} options absent on the non-list widgets
 * @param {ControlProse} meta
 * @returns {string}
 */
export function selectionDescription(entry, value, options, meta) {
  if (!entry.desc) return "";
  if (entry.desc === "config") return (meta && meta.options && meta.options[String(value)]) || "";
  const name = selectedLabel(options, value);
  if (!name) return "";
  const md = metadata.value || {};
  if (entry.desc === "filter") return filterDescription(name, md);
  return shaperDescription(entry.desc, name, md);
}

// Same joins, addressed by one option instead of the current selection — the
// per-option hover tip in the combobox reads each row's prose through this.
/**
 * @param {SchemaField} entry
 * @param {{ value: string | number | undefined, label: string }} option
 * @param {ControlProse} meta
 * @returns {string}
 */
export function optionDescription(entry, option, meta) {
  if (!entry.desc) return "";
  if (entry.desc === "config") return (meta && meta.options && meta.options[String(option.value)]) || "";
  if (!option.label) return "";
  const md = metadata.value || {};
  if (entry.desc === "filter") return filterDescription(option.label, md);
  return shaperDescription(entry.desc, option.label, md);
}
