// Shared pipeline-set fixture of the rendered DSP pipelines drawer suites (tests/js/components/faceplate-drawers/):
// rows as the config file's canonical JSON carries them, loaded into the store with the matrix engine's switch.

import { config, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { fieldReading, seedReadings } from "../readings.js";

/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} Row */

/** A row from one input to one output with no processing. @param {number} src @param {number} mix @returns {Row} */
export const plain = (src, mix) => ({
  gain: "0",
  gainunit: "dB",
  mixdown: String(mix),
  process: "",
  source: String(src),
});

/** A served reading showing `value` from the config file. @param {unknown} value */
const fromFile = (value) => fieldReading(value, { show: "file" });

/**
 * Load a pipeline set as the config file's, with the matrix engine's switch.
 *
 * @param {Row[]} rows
 * @param {boolean} [engaged]
 */
export function loadPipelines(rows, engaged = true) {
  config.value = { fields: [{ name: "channels", type: "number" }] };
  matrixConfig.value = { fields: [{ name: "enabled", type: "checkbox" }] };
  seedReadings({
    channels: fromFile(2),
    matrix_pipelines: fromFile(JSON.stringify(rows)),
    matrix_enabled: fromFile(engaged ? "1" : "0"),
  });
}
