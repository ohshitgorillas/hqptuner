// Fixtures the two store/matrix/profiles suites drive their trees from: the pipeline
// row and stored-profile shapes the matrix config carries, and the full reset
// each case starts from. Module-level signals outlive a test, so the reset
// reassigns every tree and clears the staged buffer via discardAll().

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { stagingWire } from "./wire.js";

/**
 * One pipeline row, every value a string.
 *
 * @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} PipelineRow
 */

// A canonical pipeline row, the shape rows travel in everywhere.
/**
 * @param {string} gain
 * @returns {PipelineRow}
 */
export const ROW = (gain) => ({ gain, gainunit: "dB", mixdown: "0", process: "", source: "0" });

// A stored profile as the config carries it: pipeline rows plus the profile's
// own <post_process> chain, which nests inside <matrix> and so travels with it.
/**
 * @param {PipelineRow[]} rows
 * @param {Record<string, string>} [post]
 */
export const PROF = (rows, post = {}) => ({ rows, post });

// A faked staging wire plus a clean signal tree; `m` supplies the matrix
// config's own members on top of the empty form.
export async function reset(m = {}) {
  stagingWire();
  engineState.value = {};
  config.value = { fields: [], file: {}, active: "" };
  matrixConfig.value = { fields: [], rows: [], ...m };
  await discardAll();
}
