// Where a control's words come from. One control's prose has three possible
// sources and none of them are written here:
//
//   settings.json   label + tooltip per control, keyed by tab group, each entry
//                   citing the manual or readme section it was taken from
//   filters.json    per-filter description, joined by the ENGINE's own filter
//   shapers.json    name (architecture §2: enumerations are the sole authority
//                   for names, static data joins by name)
//
// Two pages rendering one control from two
// different strings is how a UI ends up disagreeing with itself, so both read
// from here and neither writes prose of its own.

import { metadata } from "./signals.js";
import { schema } from "./schema.js";
import { notesVisible, plainNames } from "./prefs.js";

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
 *   One filters.json / shapers.json row. This module reads the prose; the rate
 *   floor belongs to the same row and `store/options.js` reads it, so the shape
 *   names it rather than describing a record narrower than the one served.
 * @property {string} [description]
 * @property {string} [notes]
 * @property {boolean} [sdm_two_stage] oversampling runs in two stages for SDM output
 * @property {number | null} [min_rate_hz]
 * @property {string} [min_rate_label]
 * @property {number} [generation] SDM modulator only; `store/options.js` reads it
 *
 * @typedef {object} Metadata
 *   The static overlay bundle /api/metadata serves.
 * @property {{ filters?: Record<string, OverlayEntry>, aliases?: Record<string, string>,
 *   two_stage_note?: string, sdm_two_stage_note?: string }} [filters]
 * @property {{ sdm_modulators?: Record<string, OverlayEntry>,
 *   pcm_dithers?: Record<string, OverlayEntry> }} [shapers]
 * @property {Record<string, Record<string, ControlProse>>} [settings]
 * @property {Record<string, unknown>} [easy] Easy Mode's tile copy, a nested tree keyed by preset id
 *   and knob id (data/easy-presets.json). Deliberately not typed further: the tiles that read the
 *   leaves arrive in a later phase, and a shape written before them would be a guess.
 */

/**
 * One control's label and tooltip from settings.json, falling back to the key
 * itself and no tooltip.
 *
 * @param {SchemaField} entry
 * @param {string} key
 * @returns {ControlProse}
 */
export function describe(entry, key) {
  const g = (metadata.value && metadata.value.settings && metadata.value.settings[entry.group]) || {};
  return g[entry.note || key] || { label: key, tooltip: "" };
}

// Easy Mode's copy comes through the same door as every other string the UI
// says: data/easy-presets.json rides in the same /api/metadata bundle, and the
// cards read it from here rather than fetching the file themselves.
/**
 * Easy Mode's copy, addressed by its path through data/easy-presets.json —
 * `easyProse("notice")`, `easyProse("purist", "title")`. Empty when
 * anything on the path is missing or is not a string, so a card renders without
 * the sentence rather than with the word "undefined" where it should have been.
 *
 * @param {...string} keys
 * @returns {string}
 */
export function easyProse(...keys) {
  /** @type {unknown} */
  let node = (metadata.value || {}).easy;
  for (const key of keys) {
    if (!node || typeof node !== "object") return "";
    node = /** @type {Record<string, unknown>} */ (node)[key];
  }
  return typeof node === "string" ? node : "";
}

// Easy Mode's copy carries its own breaks: a blank line in an approved string is
// a paragraph boundary, so moving where a warning parts from the description it
// follows is an edit to the text and nothing else. Splitting here rather than
// storing one field per paragraph keeps one approved string per thing that
// speaks (data/easy-presets.json), and the tiles and the help panel divide
// theirs by the same rule.
/**
 * One approved string's paragraphs, in order — one entry for copy with no break.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function paragraphs(text) {
  return text
    .split(/\n[ \t]*\n+/)
    .map((para) => para.trim())
    .filter(Boolean);
}

// A card gate's note, addressed by control key, for that card's subtitle. The
// subtitle is the same prose a row note carries, so it follows the same pref:
// with the manual text switched off there is no subtitle either. Returns ''
// rather than null so a call site can pass it
// straight to Card (an empty subtitle renders nothing).
/**
 * A card gate's tooltip for use as the card subtitle, empty when the manual text
 * pref is off.
 *
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
 * The label of the option carrying `value`, empty when the list does not carry it.
 *
 * @param {{ value: string | number | undefined, label: string }[] | undefined} options
 * @param {string | number | boolean | undefined} value
 * @returns {string}
 */
export function selectedLabel(options, value) {
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
//
// Two unrelated notes both say "two stage" and both can appear on one string.
// `two_stage_note` belongs to the '-2s' NAME variant, so it is keyed by the
// filter. `sdm_two_stage_note` describes what the engine does with this filter
// when it feeds the SDM chain, so it is keyed by the CHAIN the control sits on:
// the same filter is offered in both chains at once (four persistent dropdowns,
// store/schema.js), and the sentence is only true of the SDM pair. It reads as
// part of the filter's own description and so sits directly after it.
/**
 * @param {string} name
 * @param {Metadata} md
 * @param {boolean} sdm whether the control sits on the SDM chain
 * @returns {string}
 */
function filterDescription(name, md, sdm) {
  const f = md.filters || {};
  const { entry, twoStage } = joinFilter(name, f.filters || {}, f.aliases || {});
  if (!entry) return "";
  // Simplified mode says nothing about the two-stage variant: its names drop the
  // clause (store/plainnames.js), so both notes go with them and the description
  // keeps the filter's own prose alone. Standard mode is unchanged.
  const twoStageNotes = !plainNames.value;
  const sdmNote = twoStageNotes && sdm && entry.sdm_two_stage ? f.sdm_two_stage_note : "";
  return joinProse(entry.description, sdmNote, entry.notes, twoStageNotes && twoStage ? f.two_stage_note : "");
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
//   desc = filter|sdm_filter|dither|modulator -> name-keyed prose from the
//     metadata overlay (filters.json / shapers.json), joined by the selected
//     option's label. filter vs sdm_filter names the chain the control sits on,
//     the way dither vs modulator names the shaper database.
//   desc = config -> per-value prose from this control's settings.json `options`
//     map, keyed by the selected form value (integrator, noise filter, SDM/PCM
//     conversion — enums whose meaning is per-value, not per-control).
/**
 * The inline manual prose for a control's current selection, empty when the
 * control carries no `desc` source or nothing joins.
 *
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
  if (entry.desc === "filter" || entry.desc === "sdm_filter")
    return filterDescription(name, md, entry.desc === "sdm_filter");
  return shaperDescription(entry.desc, name, md);
}

// Same joins, addressed by one option instead of the current selection — the
// per-option hover tip in the combobox reads each row's prose through this.
/**
 * The same manual prose addressed by one option rather than the current
 * selection, for the combobox's per-row hover tip.
 *
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
  if (entry.desc === "filter" || entry.desc === "sdm_filter")
    return filterDescription(option.label, md, entry.desc === "sdm_filter");
  return shaperDescription(entry.desc, option.label, md);
}
