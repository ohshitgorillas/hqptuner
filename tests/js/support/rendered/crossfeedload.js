// Shared load of the Crossfeed drawer suites (tests/js/components/faceplate-drawers/drawers-crossfeed.test.js and
// tests/js/store/faceplate/drawers-crossfeed.test.js): the /matrix form, the file tree's readings and the picked mode.
// Not a *.test.js file on purpose: the runner glob would execute it.

import { config, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { xfMode } from "../../../../hqptuner/static/store/xfeed/mode.js";
import { fieldReading, seedReadings } from "../readings.js";

/** The Post-Bauer corner frequency the file tree holds. */
export const FC = 900;

/** The Post-Bauer feed level the file tree holds. */
export const FEED = 7;

/**
 * Load one state of the trees: the /matrix form, the pipeline rows and the Post-Bauer settings as readings showing the
 * config file's values, and the picked mode. The Post-Bauer settings and the rows restart the engine when `restarts`.
 *
 * @param {{ rows: import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").PipelineRow[], matrix: boolean,
 *   enabled: string, iir2fir: string, preset: string, restarts: boolean, picked: "bauer" | "structural" | null }} s
 */
export async function loadCrossfeed({ rows, matrix, enabled, iir2fir, preset, restarts, picked }) {
  matrixConfig.value = {
    fields: [
      { name: "enabled" },
      { name: "iir2fir" },
      { name: "post_bauer_enabled" },
      {
        name: "post_bauer_preset",
        options: [
          { value: "default", label: "default" },
          { value: "custom", label: "custom" },
        ],
      },
      { name: "post_bauer_frequency" },
      { name: "post_bauer_level" },
    ],
  };
  config.value = { fields: [] };
  await discardAll();
  /** @param {unknown} value @param {boolean} [restarting] */
  const fromFile = (value, restarting = false) => fieldReading(value, { show: "file", restarts: restarting });
  await seedReadings({
    matrix_enabled: fromFile(matrix ? "1" : "0"),
    matrix_iir2fir: fromFile(iir2fir),
    post_bauer_enabled: fromFile(enabled, restarts),
    post_bauer_preset: fromFile(preset, restarts),
    post_bauer_frequency: fromFile(String(FC), restarts),
    post_bauer_level: fromFile(String(FEED), restarts),
    matrix_pipelines: fromFile(JSON.stringify(rows), restarts),
  });
  xfMode.value = picked;
}
