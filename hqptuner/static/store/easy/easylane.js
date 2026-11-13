// Easy Mode's presets write straight through to the engine and never stage
// (store/live/write.js says why). They get back three things: the output mode,
// the filter NAME currently in each of the four fields, and one way to write a
// name into one of them. The Filter presets popover
// (store/faceplate/page/presets.js) writes this way.
//
// Names, not enum ids, because that is the domain the preset table speaks.
// Resolving a name to the id the engine wants is the last thing that happens,
// against the option list the engine is showing.
import { idFor, selectedLabel } from "../prose.js";
import { modeValue } from "../live/derive.js";
import { liveModel } from "../live/model.js";
import { writeLive } from "../live/write.js";

/**
 * @typedef {object} EasyLane
 *   The answer to what Easy Mode needs to know and do.
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

// Controls are read back off the view model, and that is deliberate: which of the two chains is loaded decides
// whether a control's list comes from the enumerations or from the running
// config's form (store/live/chains.js), and deciding that twice is how two
// views of one engine drift apart.
/**
 * The four filter controls, by schema key.
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
 * The output mode and four filter names. Nothing stages here, so this is what
 * the grid has picked and what the engine is running alike.
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

/**
 * What Easy Mode's presets read and write: the engine's own enumerations,
 * written through on the spot.
 *
 * @returns {EasyLane}
 */
export function easyLane() {
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
