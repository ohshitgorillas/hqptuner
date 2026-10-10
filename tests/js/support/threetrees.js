// The fake wire and the clean three-tree baseline the store-core suites
// (tests/js/store/resolve.test.js, tests/js/store/apply-summary.test.js) drive
// the store through.
//
// `route()` installs a globalThis.fetch that
// answers the real REST paths (lib/api.js) with real response shapes.

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok } from "./wire/wire.js";

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
/** @param {{ apply?: unknown, saved?: unknown, refusal?: unknown, staged?: { live: unknown, http: unknown } }} [seams] */
export function route({ apply = {}, saved = undefined, refusal = null, staged = { live: {}, http: {} } } = {}) {
  env.fetch = async (/** @type {string} */ path) => {
    if (path === "/api/config/apply") return refusal || ok(saved ? { report: apply, saved } : { report: apply });
    if (path === "/api/config/stage") return ok(staged);
    if (path === "/api/config/pending") return ok(staged);
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/matrix") return ok({ data: matrixConfig.value });
    if (path === "/api/enumerations") return ok({ data: null });
    return ok({});
  };
}

// A clean three-tree baseline. Every source signal is reassigned, not just the
// ones a case cares about — module-level signals outlive a test.
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
  config.value = { fields, file, active: "" };
  matrixConfig.value = { fields: matrix, active: "[Default]" };
  route();
  await discardAll();
}

/**
 * @param {string} name
 * @param {string | boolean} value
 * @returns {FormField}
 */
export const field = (name, value) => ({ name, value });
