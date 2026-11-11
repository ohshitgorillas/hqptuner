// The engine row's HF filter: HQPlayer's playback filter, which its interfaces call the junk filter. What runs is the
// `junk_filters` entry at the list index the engine reports; the options are that enumeration in the engine's order,
// each valued by its list index, which is what the setter writes. An option is grayed while the playing or paused
// source is content it does nothing on (model/shell/hf-reach.js, judged against the source rate, a DSD source at
// rate / 64); with the transport off, or no rate known, nothing is grayed. A pick is written live and nothing stages.

import { stateOf } from "../live/derive.js";
import { writeLive } from "../live/write.js";
import { enumOptions } from "../ui/options.js";
import { engineStatus } from "../signals.js";
import { actsOn, contentRate } from "../../model/shell/hf-reach.js";
import { nameAt } from "./chain.js";
import { sourceIsDsd, transportNow } from "./path.js";

/**
 * One HF filter option.
 *
 * @typedef {object} HfOption
 * @property {string} value  its list index, what a pick writes
 * @property {string} label  its engine name
 * @property {boolean} cur  it is the one running
 * @property {boolean} grayed  it does nothing on the content playing; `none` never
 */

/** The row's nothing-to-show placeholder. */
const DASH = "—";

/**
 * The content rate the options are judged against: the playing or paused source's, null while the transport is off or
 * no rate is known.
 *
 * @returns {number | null}
 */
function judgedRate() {
  if (transportNow() === "off") return null;
  const md = (engineStatus.value || {}).metadata || {};
  return contentRate(md.samplerate, sourceIsDsd(md));
}

/**
 * The running HF filter's name and the options, none while engine state or the enumeration is missing.
 *
 * @returns {{ txt: string, options: HfOption[] }}
 */
export function hfNow() {
  const at = stateOf("filter_junk");
  const rate = judgedRate();
  const options =
    at == null
      ? []
      : enumOptions("junk_filters").map((o) => ({
          value: String(o.value),
          label: o.label,
          cur: String(o.value) === String(at),
          grayed: !actsOn(o.label, rate),
        }));
  return { txt: nameAt("junk_filters", "filter_junk") || DASH, options };
}

/**
 * Write one HF filter option live, by its list index.
 *
 * @param {string} value
 * @returns {Promise<void>}
 */
export const pickHf = (value) => writeLive("junk_filter", value);
