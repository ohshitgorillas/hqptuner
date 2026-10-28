// Fixtures the two store/matrix/profiles suites drive their trees from: the pipeline
// row and stored-profile shapes the matrix config carries, and the full reset
// each case starts from. Module-level signals outlive a test, so the reset
// reassigns every tree and clears the staged buffer via discardAll().

import { config, matrixConfig, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { readings } from "../../../hqptuner/static/store/core/readings.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { stagingWire, ok } from "./wire/wire.js";

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

/** @param {string} name */
export const profileReading = (name) => ({
  engine: { value: name, name, generation: 0 },
  file: null,
  staged: null,
  lane: "matrix",
  show: "engine",
  restarts: false,
  diverges: false,
  bounds: null,
});

/**
 * @param {unknown} value
 * @returns {import("../../../hqptuner/static/model/store/reading.js").FieldReading}
 */
const pendingReading = (value) => ({
  engine: null,
  file: { value: "", generation: 0 },
  staged: value ?? null,
  lane: "restore",
  show: "file",
  restarts: true,
  diverges: false,
  bounds: null,
});

// A faked staging wire plus a clean signal tree; `m` supplies the matrix
// config's own members on top of the empty form.
/**
 * @param {{
 *   live_profiles?: string[],
 *   live_active?: string,
 *   file_profiles?: Record<string, ReturnType<typeof PROF>>,
 *   preset_profiles?: Record<string, string[]>,
 * }} [options]
 */
export async function reset({ live_profiles = [], live_active = "", ...m } = {}) {
  const wire = stagingWire({
    routes: (path, _opts, w) =>
      path === "/api/config"
        ? ok({
            generation: 0,
            fields: {
              matrix_profile: profileReading(live_active),
              matrix_profile_save: pendingReading(w.staged.http.matrix_profile_save),
              matrix_profile_delete: pendingReading(w.staged.http.matrix_profile_delete),
            },
          })
        : undefined,
  });
  engineState.value = {};
  config.value = { fields: [], file: {}, active: "" };
  matrixConfig.value = { fields: [], rows: [], ...m };
  enums.value = { matrix_profiles: live_profiles };
  readings.value = { generation: 0, fields: { matrix_profile: profileReading(live_active) } };
  await discardAll();
  return wire;
}
