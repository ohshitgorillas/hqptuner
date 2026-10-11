// The two lanes Easy Mode's presets can write on differ, and this is where that
// difference stops. The config lane STAGES an edit into the pending buffer; the
// live lane writes it straight through to the engine and never stages
// (store/live/write.js says why). The presets ask for a lane and get back the
// same three things either way: the output mode, the filter NAME currently in
// each of the four fields, and one way to write a name into one of them. The
// Filter presets popover (store/faceplate/page/presets.js) writes on the live lane.
//
// Names, not enum ids, because that is the domain the preset table speaks.
// Resolving a name to the id a lane wants is the last thing that happens,
// against the option list that lane is showing.
import { schema } from "../schema.js";
import { effective } from "../resolve.js";
import { optionsFor } from "../ui/options.js";
import { idFor, selectedLabel } from "../prose.js";
import { edit } from "../actions.js";
import { modeValue } from "../live/derive.js";
import { liveModel } from "../live/model.js";
import { writeLive } from "../live/write.js";

/**
 * @typedef {object} EasyLane
 *   One lane's answer to what Easy Mode needs to know and do.
 * @property {string} mode the output mode in force, "pcm" | "sdm" | "auto"
 * @property {Record<string, string>} values filter name per schema key
 * @property {(key: string, name: string) => Promise<void>} write one field, by filter name
 *
 * @typedef {object} FilterControl
 *   The part of one assembled live chain control (store/live/model.js) this
 *   module reads.
 * @property {string} field the live form field this control writes
 * @property {string} key its schema key
 * @property {string | number | boolean | undefined} value its current enum id
 * @property {import("../live/derive.js").MenuOption[]} optionsRaw its pre-narrow option list
 */

// The four filter fields, in chain order. Everything else on a chain — the
// dither, the modulator — is outside Easy Mode's reach by design: presets name
// filters and nothing else.
/** @type {string[]} */
const FILTER_KEYS = ["pcm_filter_1x", "pcm_filter_nx", "sdm_filter_1x", "sdm_filter_nx"];

/**
 * One filter field's option list on the config lane.
 * @param {string} key
 * @returns {OptionItem[]}
 */
const configOptions = (key) => optionsFor("config", (schema[key] || {}).field || "");

// The config lane answers two different questions out of the same four fields, and
// the reader handed in is the whole difference: `effective` folds the pending
// buffer in, so it says what the grid has picked; `runningValue` leaves it out,
// so it says what the engine is running (store/resolve.js). A page with nothing
// staged gets the same answer from both, which is why the live lane needs no such split.
/**
 * The config lane's output mode and four filter names, resolved through one reader.
 *
 * @param {(key: string) => string | number | boolean | undefined} read
 * @returns {{ mode: string, values: Record<string, string> }}
 */
function configShape(read) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const key of FILTER_KEYS) values[key] = selectedLabel(configOptions(key), read(key));
  return { mode: String(read("output_mode") ?? ""), values };
}

/** The config lane: the running configuration's own form, staged through the pending buffer. */
function configLane() {
  return {
    ...configShape(effective),
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

// The live lane reads its controls back off the view model, and that is deliberate: which of the two chains is loaded decides
// whether a control's list comes from the enumerations or from the running
// config's form (store/live/chains.js), and deciding that twice is how two
// views of one engine drift apart.
/**
 * The live lane's four filter controls, by schema key.
 * @returns {Record<string, FilterControl>}
 */
function liveControls() {
  const model = liveModel.value;
  /** @type {Record<string, FilterControl>} */
  const out = {};
  for (const c of [...model.pcmChain, ...model.sdmChain]) if (FILTER_KEYS.includes(c.key)) out[c.key] = c;
  return out;
}

/**
 * The live lane's output mode and four filter names. Nothing stages here, so
 * this is what the grid has picked and what the engine is running alike.
 *
 * @returns {{ mode: string, values: Record<string, string> }}
 */
function liveShape() {
  const controls = liveControls();
  /** @type {Record<string, string>} */
  const values = {};
  for (const key of FILTER_KEYS) {
    const c = controls[key];
    values[key] = c ? selectedLabel(c.optionsRaw, c.value) : "";
  }
  return { mode: modeValue(), values };
}

/** The live lane: the engine's own enumerations, written through on the spot. */
function liveLane() {
  return {
    ...liveShape(),
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
 * What Easy Mode's presets read and write on one of the two lanes.
 *
 * @param {string} lane "config" (staged) | "live" (written through)
 * @returns {EasyLane}
 */
export function easyLane(lane) {
  return lane === "live" ? liveLane() : configLane();
}
