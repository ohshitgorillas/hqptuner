// Shared pipeline-set fixture of the rendered DSP pipelines drawer suites (tests/js/components/faceplate-drawers/):
// rows as the config file's canonical JSON carries them, loaded into the store with the matrix engine's switch.

import { config, matrixConfig } from "../../../../hqptuner/static/store/signals.js";

/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} Row */

/** A row from one input to one output with no processing. @param {number} src @param {number} mix @returns {Row} */
export const plain = (src, mix) => ({
  gain: "0",
  gainunit: "dB",
  mixdown: String(mix),
  process: "",
  source: String(src),
});

/**
 * Load a pipeline set as the config file's, with the matrix engine's switch.
 *
 * @param {Row[]} rows
 * @param {boolean} [engaged]
 */
export function loadPipelines(rows, engaged = true) {
  config.value = {
    fields: [{ name: "channels", type: "number", value: 2 }],
    file: { matrix_pipelines: JSON.stringify(rows) },
    active: "",
  };
  matrixConfig.value = { fields: [{ name: "enabled", type: "checkbox", value: engaged }], rows: [] };
}
