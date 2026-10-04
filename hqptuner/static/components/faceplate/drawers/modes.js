// The schemas of the three drawers with output-mode tabs: DSD Processing, Resampling and Shaping. Each has a PCM out and
// an SDM out tab, since the engine keeps one chain per output mode whatever runs; a drawer opens on the mode running,
// and the other mode's tab reads idle. Resampling's FFT length row shows on a tab while that tab's 1x or Nx filter is
// FFT-family. Shaping's DAC type and DAC chip are browser-held fields, and its PCM tab notes the DAC bits the Output
// drawer holds, with the link there.

import { rowOptions, rowValue } from "../../../store/faceplate/drawer.js";
import { ditherNote, runningMode } from "../../../store/faceplate/drawers/modes.js";
import { dacChip, dacType, setDacChip, setDacType } from "../../../store/ui/faceplate.js";

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

/**
 * The engine name of a filter row's effective option.
 *
 * @param {string} key
 */
const pickedName = (key) => rowOptions(key).find((o) => String(o.value) === rowValue(key))?.label ?? "";

/**
 * Whether a chain's 1x or Nx filter is FFT-family.
 *
 * @param {string} oneX
 * @param {string} nX
 * @returns {() => boolean}
 */
const fftPicked = (oneX, nX) => () => [oneX, nX].some((k) => /\bFFT\b/.test(pickedName(k)));

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
      { row: { key: "fft_size", when: fftPicked("pcm_filter_1x", "pcm_filter_nx") } },
    ],
    [
      { head: "PCM sources" },
      { row: { key: "sdm_filter_1x", sub: "Sources up to 50 kHz" } },
      { row: { key: "sdm_filter_nx", sub: "Sources above 50 kHz" } },
      { row: { key: "fft_size", when: fftPicked("sdm_filter_1x", "sdm_filter_nx") } },
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
      {
        field: {
          id: "dactype",
          label: "DAC type",
          man: [
            "Also when a suitable noise-shaper, such as LNS15, NS9 or NS5 is used in combination with high output rates, linearity errors inherent to all R2R DACs can be corrected. This will lower distortion of especially low level signals and reduce zero-crossing distortions.",
            "R-2R collapses the Additive family in the dither list.",
          ],
          options: [
            { value: "other", label: "Other" },
            { value: "r2r", label: "R-2R" },
          ],
          value: () => dacType.value,
          set: setDacType,
        },
      },
      { row: { key: "pcm_dither", sub: "Low-level noise treatment" } },
      { note: () => ({ text: ditherNote(), to: "output" }) },
    ],
    [
      {
        field: {
          id: "dacchip",
          label: "DAC chip",
          man: [
            "For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal.",
            "ESS Sabre collapses the seventh order variants in the modulator list.",
          ],
          options: [
            { value: "other", label: "Other" },
            { value: "ess", label: "ESS Sabre" },
          ],
          value: () => dacChip.value,
          set: setDacChip,
        },
      },
      { row: { key: "sdm_modulator", sub: "Builds the 1-bit stream" } },
    ],
  ),
};
