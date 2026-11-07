// Shared running state of the Volume drawer's Range block suites (tests/js/components/faceplate-drawers/): each
// running field's value seeded into the served readings (tests/js/support/readings.js), the volume reading and the
// engine's VolumeRange report, put into the store signals the block reads.

import { config, matrixConfig, volume, volumeDrag, volumeRange } from "../../../../hqptuner/static/store/signals.js";
import { fieldReading, seedReadings } from "../readings.js";

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
 * Max 0, no loudness, the engine reporting the range enabled from -60 to 0, the volume at -12.5 and no drag. The
 * returned promise resolves once the readings are seeded.
 *
 * @param {Running} [r]
 */
export async function loadVolumeRange(r = {}) {
  const s = {
    fixed: false,
    min: "-60",
    startup: "-20",
    max: "0",
    loudness: false,
    report: { enabled: "1", min: "-60", max: "0" },
    ...r,
  };
  config.value = { fields: [] };
  matrixConfig.value = { fields: [] };
  /** @type {Record<string, unknown>} */
  const running = {
    fixed_volume_enabled: s.fixed,
    optimal_iso: "0",
    direct_sdm: false,
    volume_min: s.min,
    volume_max: s.max,
    startup_volume: s.startup,
    matrix_enabled: s.loudness,
    loudness_enabled: s.loudness,
    loudness_range_low: "-45",
    loudness_range_high: "-15",
  };
  await seedReadings(Object.fromEntries(Object.entries(running).map(([key, value]) => [key, fileReading(value)])));
  volume.value = "-12.5";
  volumeDrag.value = null;
  volumeRange.value = s.report;
}

/**
 * A File field's served reading: read from the File on the restore lane, restarting the engine.
 *
 * @param {unknown} value
 */
function fileReading(value) {
  return fieldReading(value, { show: "file", lane: "restore", restarts: true });
}
