// The mode drawers' store half (DSD Processing, Resampling, Shaping): the output mode a drawer opens on, its other mode
// reading idle, and the line Shaping's PCM tab prints under the dither, naming the DAC bits the Output drawer holds for
// the backend in use. A backend with no DAC bits row of its own (Combo) and a DAC bits of 0 read as auto-detect.

import { effective } from "../../resolve.js";
import { runningChain } from "../path.js";

/** The DAC bits key each backend's group holds. @type {Record<string, string>} */
const BITS_KEY = { alsa: "alsa_bits", network: "net_bits" };

/**
 * The output mode running now, `pcm` or `sdm`: the tab a mode drawer opens on.
 *
 * @returns {"pcm" | "sdm"}
 */
export const runningMode = () => runningChain();

/**
 * The line under the PCM dither: the DAC bits the dither targets, or that the DAC reports its own.
 *
 * @returns {string}
 */
export function ditherNote() {
  const key = BITS_KEY[String(effective("backend"))];
  const bits = key ? Number(effective(key)) : 0;
  return bits > 0
    ? `Dithers to ${bits} bits (DAC bits)`
    : "Dithers to the bit depth the DAC reports (DAC bits: auto-detect)";
}
