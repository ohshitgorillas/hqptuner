// Where a control's words come from. One control's prose has three possible
// sources and none of them are written here:
//
//   settings.json   label + tooltip per control, keyed by tab group, each entry
//                   citing the manual or readme section it was taken from
//   filters.json    per-filter description, joined by the ENGINE's own filter
//   shapers.json    name
//
// Two pages rendering one control from two
// different strings is how a UI ends up disagreeing with itself, so both read
// from here and neither writes prose of its own.

import { computed } from "@preact/signals";
import { metadata } from "./signals.js";
import { plate } from "./faceplate/view.js";

// Static per-control prose from settings.json, keyed by tab group. `entry.note`
// names the settings.json key when it differs from the control key (e.g.
// alsa_bits + net_bits both -> "dac_bits", the rate split -> "rate"); it
// defaults to the control key.
/**
 * @typedef {object} ControlProse
 *   One control's settings.json row.
 * @property {string} label
 * @property {string} tooltip  the start of the paragraph
 * @property {string} [more]  the rest of the paragraph, then any paragraphs after it, a blank line between each
 * @property {Record<string, string>} [options] per-VALUE prose (`desc: "config"`)
 *
 * @typedef {object} Fold
 *   An explanation split by the plate: what reads in place and what waits behind "see more".
 * @property {string} text    the first paragraph in place; "see more" follows it where `more` holds any
 * @property {string[]} rest  the paragraphs in place after it, each its own
 * @property {string[]} more  the paragraphs held behind "see more", none where nothing is held
 *
 * @typedef {object} Described
 *   One control's prose as a surface shows it.
 * @property {string} label
 * @property {string} tooltip  the start of the paragraph, alone
 * @property {Record<string, string> | undefined} options  per-VALUE prose (`desc: "config"`)
 * @property {Fold} fold  the whole paragraph, split by the plate
 *
 * @typedef {Pick<ControlProse, "label" | "tooltip" | "options">} ValueProse  a control's prose, read for its per-VALUE
 *   prose
 *
 * @typedef {object} OverlayEntry
 *   One filters.json / shapers.json row. This module reads the prose; the rate
 *   floor belongs to the same row and `store/ui/options.js` reads it, so the shape
 *   names it rather than describing a record narrower than the one served.
 * @property {string} [description]
 * @property {string} [notes]
 * @property {boolean} [sdm_two_stage] oversampling runs in two stages for SDM output
 * @property {number | null} [min_rate_hz]
 * @property {string} [min_rate_label]
 * @property {number} [generation] SDM modulator only; `store/ui/options.js` reads it
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

/** Whether the plate holds every explanation whole in place. */
const inPlace = computed(() => plate.value.both);

/**
 * One control's label, tooltip and paragraph from settings.json, falling back to
 * the key itself and no tooltip.
 *
 * @param {SchemaField} entry
 * @param {string} key
 * @returns {Described}
 */
export function describe(entry, key) {
  const g = (metadata.value && metadata.value.settings && metadata.value.settings[entry.group]) || {};
  /** @type {ControlProse} */
  const row = g[entry.note || key] || { label: key, tooltip: "" };
  return {
    label: row.label,
    tooltip: row.tooltip,
    options: row.options,
    fold: fold(row.tooltip, row.more || "", "", inPlace.value),
  };
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

/**
 * The form value an option list carries under an engine name, "" when it carries none.
 *
 * @param {{ value: string | number | undefined, label: string }[]} options
 * @param {string} name
 * @returns {string}
 */
export function idFor(options, name) {
  const hit = options.find((o) => o.label === name);
  return hit === undefined || hit.value === undefined ? "" : String(hit.value);
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
 * @typedef {{ base: string, note: string }} ProseParts  a description's own prose and the two-stage note after it,
 *   "" where the name is no '-2s' variant
 */

/**
 * @param {string} name
 * @param {Metadata} md
 * @param {boolean} sdm whether the control sits on the SDM chain
 * @returns {ProseParts}
 */
function filterParts(name, md, sdm) {
  const f = md.filters || {};
  const { entry, twoStage } = joinFilter(name, f.filters || {}, f.aliases || {});
  if (!entry) return { base: "", note: "" };
  const sdmNote = sdm && entry.sdm_two_stage ? f.sdm_two_stage_note : "";
  return { base: joinProse(entry.description, sdmNote, entry.notes), note: (twoStage && f.two_stage_note) || "" };
}

/** @param {ProseParts} p */
const whole = (p) => joinProse(p.base, p.note);

/**
 * What of an explanation reads in place and what waits behind "see more". On a plate that holds everything nothing
 * waits: the held part follows the lead, its first paragraph joined to it and each paragraph after its own. On a
 * smaller plate the held part waits, one entry per paragraph, and only `inline` follows the lead.
 *
 * @param {string} lead    what always reads in place
 * @param {string} held    what may wait, a blank line between its paragraphs
 * @param {string} inline  what reads in place after the lead while `held` waits
 * @param {boolean} all    whether the plate holds everything in place
 * @returns {Fold}
 */
function fold(lead, held, inline, all) {
  const paras = paragraphs(held);
  if (!all) return { text: joinProse(lead, inline), rest: [], more: paras };
  return { text: joinProse(lead, paras[0]), rest: paras.slice(1), more: [] };
}

/**
 * The parts folded for a surface that can hold the note behind "see more": while it waits, the note's lead, its words
 * before the first colon, reads in place after the prose.
 *
 * @param {ProseParts} p
 * @returns {Fold}
 */
function heldBack(p) {
  const colon = p.note.indexOf(":");
  const lead = colon > 0 ? p.note.slice(0, colon) : "";
  return fold(p.base, p.note, lead, inPlace.value);
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

// Same joins, addressed by one option instead of the current selection — the
// per-option hover tip in the combobox reads each row's prose through this.
/**
 * The same manual prose addressed by one option rather than the current
 * selection, for the combobox's per-row hover tip.
 *
 * @param {SchemaField} entry
 * @param {{ value: string | number | undefined, label: string }} option
 * @param {ValueProse} meta
 * @returns {string}
 */
export function optionDescription(entry, option, meta) {
  return whole(optionParts(entry, option, meta));
}

/**
 * The same prose as optionDescription, folded for a surface that can hold the two-stage note behind "see more".
 *
 * @param {SchemaField} entry
 * @param {{ value: string | number | undefined, label: string }} option
 * @param {ValueProse} meta
 * @returns {Fold}
 */
export const optionProse = (entry, option, meta) => heldBack(optionParts(entry, option, meta));

/**
 * @param {SchemaField} entry
 * @param {{ value: string | number | undefined, label: string }} option
 * @param {ValueProse} meta
 * @returns {ProseParts}
 */
function optionParts(entry, option, meta) {
  if (!entry.desc) return { base: "", note: "" };
  if (entry.desc === "config")
    return { base: (meta && meta.options && meta.options[String(option.value)]) || "", note: "" };
  if (!option.label) return { base: "", note: "" };
  const md = metadata.value || {};
  if (entry.desc === "filter" || entry.desc === "sdm_filter")
    return filterParts(option.label, md, entry.desc === "sdm_filter");
  return { base: shaperDescription(entry.desc, option.label, md), note: "" };
}
