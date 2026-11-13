// The schemas of the three drawers with output-mode tabs: DSD Processing, Resampling and Shaping. Each has a PCM out and
// an SDM out tab, since the engine keeps one chain per output mode whatever runs; a drawer opens on the mode running,
// and the other mode's tab reads idle. Resampling's tabs each place the FFT length row; the catalog entry decides which
// tab shows it (store/schema/dsp.js). Shaping's DAC type and DAC chip are browser-held local controls
// (store/schema/local.js), and its PCM tab notes the DAC bits the Output drawer holds, with the link there.

import { ditherNote, runningMode } from "../../../store/faceplate/drawers/modes.js";
import { local } from "../../../store/schema/local.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerTab} DrawerTab */
/** @typedef {import("../../../store/faceplate/drawer.js").BodyItem} BodyItem */

/**
 * The PCM out and SDM out tabs over their bodies, the one not running reading idle.
 *
 * @param {BodyItem[]} pcm
 * @param {BodyItem[]} sdm
 * @returns {DrawerTab[]}
 */
const modeTabs = (pcm, sdm) => [
  { id: "pcm", label: "PCM out", body: pcm, status: () => (runningMode() === "pcm" ? "" : "idle") },
  { id: "sdm", label: "SDM out", body: sdm, status: () => (runningMode() === "sdm" ? "" : "idle") },
];

/** @type {DrawerSchema} */
export const DSD_DRAWER = {
  id: "dsd",
  title: "DSD Processing",
  aria: "DSD Processing settings",
  opensOn: runningMode,
  tabs: modeTabs(
    [
      { row: { key: "dsd_gain_6db" } },
      { row: { key: "noise_filter", sub: "Removes ultrasonic noise" } },
      { row: { key: "pcm_conversion", label: "Decimation filter", sub: "SDM → PCM conversion" } },
    ],
    [
      { row: { key: "direct_sdm", label: "DSD playback", sub: "Direct SDM" } },
      { row: { key: "sdm_integrator", label: "Remodulator structure", sub: "Integrator" } },
    ],
  ),
};

/** @type {DrawerSchema} */
export const RESAMPLING_DRAWER = {
  id: "resampling",
  title: "Resampling",
  aria: "Resampling settings",
  opensOn: runningMode,
  tabs: modeTabs(
    [
      { row: { key: "pcm_filter_1x", sub: "Sources up to 50 kHz" } },
      { row: { key: "pcm_filter_nx", sub: "Sources above 50 kHz" } },
      { row: { key: "fft_size" } },
    ],
    [
      { head: "PCM sources" },
      { row: { key: "sdm_filter_1x", sub: "Sources up to 50 kHz" } },
      { row: { key: "sdm_filter_nx", sub: "Sources above 50 kHz" } },
      { row: { key: "fft_size" } },
      { head: "DSD sources" },
      { row: { key: "sdm_conversion", label: "Rate conversion", sub: "SDM → SDM conversion" } },
    ],
  ),
};

/** @type {DrawerSchema} */
export const SHAPING_DRAWER = {
  id: "shaping",
  title: "Shaping",
  aria: "Shaping settings",
  opensOn: runningMode,
  tabs: modeTabs(
    [
      { field: local.dactype },
      { row: { key: "pcm_dither", sub: "Low-level noise treatment" } },
      { note: () => ({ text: ditherNote(), to: "output" }) },
    ],
    [{ field: local.dacchip }, { row: { key: "sdm_modulator", sub: "Builds the 1-bit stream" } }],
  ),
};
