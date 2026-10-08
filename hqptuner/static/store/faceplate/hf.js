// The engine row's HF filter: HQPlayer's playback filter, which its interfaces call the junk filter. What runs is the
// `junk_filters` entry at the list index the engine reports; the options are that enumeration in the engine's order,
// each valued by its list index, which is what the setter writes. A pick is written live and nothing stages.

import { stateOf } from "../live/derive.js";
import { writeLive } from "../live/write.js";
import { enumOptions } from "../ui/options.js";
import { nameAt } from "./chain.js";

/**
 * One HF filter option.
 *
 * @typedef {object} HfOption
 * @property {string} value  its list index, what a pick writes
 * @property {string} label  its engine name
 * @property {boolean} cur  it is the one running
 */

/** The row's nothing-to-show placeholder. */
const DASH = "—";

/**
 * The running HF filter's name and the options, none while engine state or the enumeration is missing.
 *
 * @returns {{ txt: string, options: HfOption[] }}
 */
export function hfNow() {
  const at = stateOf("filter_junk");
  const options =
    at == null
      ? []
      : enumOptions("junk_filters").map((o) => ({
          value: String(o.value),
          label: o.label,
          cur: String(o.value) === String(at),
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
