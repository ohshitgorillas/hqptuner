// Shared running state of the Volume drawer's Range block suites (tests/js/components/faceplate-drawers/): the daemon's
// /config form, the matrix form, the volume reading and the engine's VolumeRange report, put into the store signals
// the block reads.

import { config, matrixConfig, volume, volumeDrag, volumeRange } from "../../../../hqptuner/static/store/signals.js";

/**
 * @typedef {object} Running
 * @property {boolean} [fixed]     running fixed_volume_enabled
 * @property {string} [min]        running volume_min
 * @property {string} [startup]    running defaults_volume
 * @property {string} [max]        running volume_max
 * @property {boolean} [loudness]  running matrix engine and loudness both
 * @property {Record<string, string>} [report]  VolumeRange as the engine reports it
 */

/**
 * Load the running state `r` describes, each field it leaves out at its default: not fixed, Min -60, Startup -20,
 * Max 0, no loudness, the engine reporting the range enabled from -60 to 0, the volume at -12.5 and no drag.
 *
 * @param {Running} [r]
 */
export function loadVolumeRange(r = {}) {
  const s = {
    fixed: false,
    min: "-60",
    startup: "-20",
    max: "0",
    loudness: false,
    report: { enabled: "1", min: "-60", max: "0" },
    ...r,
  };
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: s.fixed },
      { name: "volume_fixed", value: false },
      { name: "direct_sdm", value: false },
      { name: "volume_min", value: s.min },
      { name: "volume_max", value: s.max },
      { name: "defaults_volume", value: s.startup },
    ],
    file: { volume_fixed: "0" },
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: s.loudness },
      { name: "post_loudness_enabled", value: s.loudness },
      { name: "post_loudness_rangelow", value: "-45" },
      { name: "post_loudness_rangehigh", value: "-15" },
    ],
  };
  volume.value = "-12.5";
  volumeDrag.value = null;
  volumeRange.value = s.report;
}
