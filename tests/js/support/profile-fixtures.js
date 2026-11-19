// Fixtures the two store/matrix/profiles suites drive their trees from: the pipeline
// row and stored-profile shapes the matrix config carries, and the full reset
// each case starts from. Module-level signals outlive a test, so the reset
// reassigns every tree and clears the staged buffer via discardAll().

import { isDeepStrictEqual } from "node:util";

import { config, matrixConfig, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { NEW } from "../../../hqptuner/static/model/builders/builder.js";
import { cur, staged, ask, refused } from "../../../hqptuner/static/store/faceplate/builders/shell.js";
import { openProfileBuilder } from "../../../hqptuner/static/store/faceplate/builders/profile.js";
import { fieldReading, seedReadings } from "./readings.js";
import { stagingWire, ok, quiesce } from "./wire/wire.js";

/** @typedef {import("./wire/wire.js").StagingWire} StagingWire */

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
export const profileReading = (name) => fieldReading(name, { name, generation: 0, lane: "matrix" });

/** @param {unknown} value */
const pendingReading = (value) =>
  fieldReading("", { show: "file", generation: 0, staged: value ?? null, lane: "restore", restarts: true });

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
  config.value = { fields: [] };
  matrixConfig.value = { fields: [], ...m };
  enums.value = { matrix_profiles: live_profiles };
  await seedReadings({ matrix_profile: profileReading(live_active) }, 0);
  await discardAll();
  return wire;
}

/** The Bauer presets the matrix form offers, each with the fixture's own label. */
export const BAUER = [
  { value: "default", label: "fx-Default" },
  { value: "cmoy", label: "fx-Moy" },
  { value: "jmeier", label: "fx-Meier" },
  { value: "custom", label: "fx-Custom" },
];

/** The DAC models the matrix form offers: none, and two models. */
export const MODELS = [
  { value: "", label: "" },
  { value: "fx-dac-a", label: "fx-dac-a" },
  { value: "fx-dac-b", label: "fx-dac-b" },
];

/** A fresh /config form: Fixed volume. */
export const configTree = () => ({
  fields: [{ name: "fixed_volume_enabled", options: [] }],
});

/**
 * The File values the wire serves at the post-process form's own settings, by schema key: every gate off, the
 * pipeline `rows` and Fixed volume.
 *
 * @param {PipelineRow[]} rows
 * @param {string} [fixed]
 * @returns {Record<string, unknown>}
 */
export const fileValues = (rows, fixed = "0") => ({
  crossfeed_enabled: "0",
  crossfeed_preset: "cmoy",
  dac_correction_enabled: "0",
  dac_correction_profile: "fx-dac-a",
  loudness_enabled: "0",
  loudness_range_low: "-40",
  loudness_range_high: "-10",
  matrix_pipelines: rows,
  fixed_volume_enabled: fixed,
});

/**
 * Each served schema key's `/config` form field name, as the field register names the post-process plugin fields and
 * the codec fields; the staging buffer's http lane is keyed by these.
 *
 * @type {Record<string, string>}
 */
const FORM_NAME = {
  crossfeed_enabled: "post_bauer_enabled",
  crossfeed_preset: "post_bauer_preset",
  dac_correction_enabled: "post_correction_enabled",
  dac_correction_profile: "post_correction_dac0",
  loudness_enabled: "post_loudness_enabled",
  loudness_low_level: "post_loudness_lowlevel",
  loudness_range_low: "post_loudness_rangelow",
  loudness_range_high: "post_loudness_rangehigh",
  matrix_pipelines: "matrix_pipelines",
  fixed_volume_enabled: "fixed_volume_enabled",
};

/**
 * What the staging buffer holds for the field at schema key `key`, by its form field name; null when it holds nothing,
 * and null when the File already holds that value, compared in the File's domain: a
 * JSON-encoded staged value against a File value that is not a string is compared decoded.
 *
 * @param {Record<string, unknown>} pending
 * @param {string} key
 * @param {unknown} held  the File value
 * @returns {unknown}
 */
function pendingOf(pending, key, held) {
  const name = FORM_NAME[key];
  if (!(name in pending)) return null;
  const value = pending[name];
  const asFile = typeof value === "string" && typeof held !== "string" ? JSON.parse(value) : value;
  return isDeepStrictEqual(asFile, held) ? null : value;
}

/**
 * The served config readings of the File values: each read from the File on the restore lane and restarting the
 * engine, carrying what the staging wire holds for it.
 *
 * @param {Record<string, unknown>} file
 * @param {StagingWire | undefined} at
 * @returns {Record<string, unknown>}
 */
export function fileReadings(file, at) {
  const pending = at ? at.staged.http : {};
  return Object.fromEntries(
    Object.entries(file).map(([key, value]) => [
      key,
      fieldReading(value, {
        show: "file",
        generation: 0,
        lane: "restore",
        restarts: true,
        staged: pendingOf(pending, key, value),
      }),
    ]),
  );
}

/**
 * Start the Profile builder from scratch: nothing staged or stashed, no question or refusal, a new record open, and
 * the wire `w` settled.
 *
 * @param {StagingWire} w
 */
export async function freshBuilder(w) {
  await discardAll();
  staged.value = new Map();
  ask.value = null;
  refused.value = false;
  cur.value = { st: "", name: NEW };
  await openProfileBuilder();
  await quiesce(w);
}
