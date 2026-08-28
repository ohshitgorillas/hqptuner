// The two pages Easy Mode renders on write differently, and this is where that
// difference stops. The Output tab STAGES an edit into the pending buffer; the
// LIVE page writes it straight through to the engine and never stages
// (store/live/write.js says why). One card renders on both, so the tiles ask for
// a lane and get back the same three things either way: the output mode, the
// filter NAME currently in each of the four fields, and one way to write a name
// into one of them.
//
// Names, not enum ids, because that is the domain the preset table speaks: the
// running engine is the sole authority for ids and ordering, and static data
// joins by name (architecture §2). Resolving a name to the id a lane wants is
// the last thing that happens, against the option list that lane is showing.
import { schema } from "./schema.js";
import { effective } from "./resolve.js";
import { optionsFor } from "./options.js";
import { selectedLabel } from "./prose.js";
import { edit } from "./actions.js";
import { modeValue } from "./live/derive.js";
import { liveModel } from "./live/model.js";
import { writeLive } from "./live/write.js";

/**
 * @typedef {object} EasyLane
 *   One page's answer to what Easy Mode needs to know and do.
 * @property {string} mode the output mode in force, "pcm" | "sdm" | "auto"
 * @property {Record<string, string>} values filter name per schema key
 * @property {(key: string, name: string) => Promise<void>} write one field, by filter name
 *
 * @typedef {object} FilterControl
 *   The part of one assembled LIVE chain control this module reads. Named here
 *   rather than imported: the full shape belongs to the page that renders it,
 *   and a store reaching into a component for a type is the wrong direction.
 * @property {string} field the live form field this control writes
 * @property {string} key its schema key
 * @property {string | number | boolean | undefined} value its current enum id
 * @property {import("./live/derive.js").MenuOption[]} optionsRaw its pre-narrow option list
 */

// The four filter fields, in chain order. Everything else on a chain card — the
// dither, the modulator — is outside Easy Mode's reach by design: presets name
// filters and nothing else.
/** @type {string[]} */
const FILTER_KEYS = ["pcm_filter_1x", "pcm_filter_nx", "sdm_filter_1x", "sdm_filter_nx"];

/**
 * One filter field's option list on the tabs lane.
 * @param {string} key
 * @returns {OptionItem[]}
 */
const configOptions = (key) => optionsFor("config", (schema[key] || {}).field || "");

/**
 * The enum id an option list carries under a filter name, "" when it carries none.
 *
 * @param {{ value: string | number | undefined, label: string }[]} options
 * @param {string} name
 * @returns {string}
 */
function idFor(options, name) {
  const hit = options.find((o) => o.label === name);
  return hit === undefined || hit.value === undefined ? "" : String(hit.value);
}

/** The tabs lane: the running configuration's own form, staged through the pending buffer. */
function configLane() {
  /** @type {Record<string, string>} */
  const values = {};
  for (const key of FILTER_KEYS) values[key] = selectedLabel(configOptions(key), effective(key));
  return {
    mode: String(effective("output_mode") ?? ""),
    values,
    /**
     * @param {string} key
     * @param {string} name
     * @returns {Promise<void>}
     */
    write: async (key, name) => {
      const id = idFor(configOptions(key), name);
      if (id) await edit(key, id);
    },
  };
}

// The LIVE lane reads its controls back off the view model rather than building
// its own, and that is deliberate: which of the two chains is loaded decides
// whether a control's list comes from the enumerations or from the running
// config's form (store/live/chains.js), and deciding that twice is how two
// views of one engine drift apart.
/**
 * The LIVE lane's four filter controls, by schema key.
 * @returns {Record<string, FilterControl>}
 */
function liveControls() {
  const model = liveModel.value;
  /** @type {Record<string, FilterControl>} */
  const out = {};
  for (const c of [...model.pcmChain, ...model.sdmChain]) if (FILTER_KEYS.includes(c.key)) out[c.key] = c;
  return out;
}

/** The LIVE lane: the engine's own enumerations, written through on the spot. */
function liveLane() {
  const controls = liveControls();
  /** @type {Record<string, string>} */
  const values = {};
  for (const key of FILTER_KEYS) {
    const c = controls[key];
    values[key] = c ? selectedLabel(c.optionsRaw, c.value) : "";
  }
  return {
    mode: modeValue(),
    values,
    /**
     * @param {string} key
     * @param {string} name
     * @returns {Promise<void>}
     */
    write: async (key, name) => {
      // Re-read rather than close over `controls`: a live write re-mirrors the
      // engine behind it (store/live/write.js), so a set written field by field
      // resolves each name against the lists the engine offers by then.
      const c = liveControls()[key];
      if (!c) return;
      const id = idFor(c.optionsRaw, name);
      if (id) await writeLive(c.field, id);
    },
  };
}

/**
 * What Easy Mode's tiles read and write on one of the two pages they render on.
 *
 * @param {string} lane "config" (the Output tab, staged) | "live" (the LIVE page, written through)
 * @returns {EasyLane}
 */
export function easyLane(lane) {
  return lane === "live" ? liveLane() : configLane();
}
