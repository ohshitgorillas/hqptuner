// The fake wire and the clean three-tree baseline the store-core suites
// (tests/js/store/resolve.test.js, tests/js/store/apply-summary.test.js) drive
// the store through.
//
// `route()` installs a globalThis.fetch that
// answers the real REST paths (lib/api.js) with real response shapes.

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { readings } from "../../../hqptuner/static/store/core/readings.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok } from "./wire/wire.js";
import { fieldReading, seedReadings } from "./readings.js";

/**
 * One /config or /matrix form field, as `field()` below builds it. `value` is a
 * union because the form answers a checkbox with a real bool and everything
 * else with a string.
 *
 * @typedef {{ name: string, value: string | boolean }} FormField
 */

/**
 * The globals a fake wire installs a `fetch` on, viewed as an optional member:
 * the DOM lib declares it returning a real `Response`, which these fakes do not
 * build.
 *
 * @type {{ fetch?: unknown }}
 */
export const env = globalThis;

// Fake wire. `apply` is the report /api/config/apply answers with and `saved`
// the preset save beside it, or `refusal` the refusal it answers instead; every
// other path gets a minimal valid response so the surrounding flow completes.
// /api/config answers the field readings the store already holds, in their
// served shape, so a refetch puts back what
// it found.
/** @param {{ apply?: unknown, saved?: unknown, refusal?: unknown, staged?: { live: unknown, http: unknown } }} [seams] */
export function route({ apply = {}, saved = undefined, refusal = null, staged = { live: {}, http: {} } } = {}) {
  env.fetch = async (/** @type {string} */ path) => {
    if (path === "/api/config/apply") return refusal || ok(saved ? { report: apply, saved } : { report: apply });
    if (path === "/api/config/stage") return ok(staged);
    if (path === "/api/config/pending") return ok(staged);
    if (path === "/api/config") return ok(readings.value);
    if (path === "/api/matrix") return ok({ data: matrixConfig.value });
    if (path === "/api/enumerations") return ok({ data: null });
    return ok({});
  };
}

/**
 * A served reading of a File-kept field, on the restore lane: the config file
 * is what it shows.
 *
 * @param {unknown} value
 */
const fromFile = (value) => fieldReading(value, { show: "file", lane: "restore" });

// A clean three-tree baseline. Every source signal is reassigned, not just the
// ones a case cares about — module-level signals outlive a test. A form field's
// value and a `file` entry are seeded as field readings under their /config
// form name, a matrix form field's under `matrix_` and its name;
// the form signals keep only the field names.
/**
 * @param {{
 *   fields?: FormField[],
 *   file?: Record<string, string>,
 *   matrix?: FormField[],
 *   engine?: Record<string, string>,
 * }} [trees]
 */
export async function trees({ fields = [], file = {}, matrix = [], engine = {} } = {}) {
  engineState.value = engine;
  config.value = { fields: fields.map(({ name }) => ({ name })) };
  matrixConfig.value = { fields: matrix.map(({ name }) => ({ name })) };
  route();
  await discardAll();
  await seedReadings({
    ...Object.fromEntries(Object.entries(file).map(([name, value]) => [name, fromFile(value)])),
    ...Object.fromEntries(fields.map(({ name, value }) => [name, fromFile(value)])),
    ...Object.fromEntries(matrix.map(({ name, value }) => [`matrix_${name}`, fromFile(value)])),
  });
}

/**
 * @param {string} name
 * @param {string | boolean} value
 * @returns {FormField}
 */
export const field = (name, value) => ({ name, value });
