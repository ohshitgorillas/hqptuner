// The fetch fake the header and loadPreset suites share: the REST paths a station load and an apply touch, answered in
// their real shapes, and the log of every request it was handed.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { readings } from "../../../../hqptuner/static/store/core/readings.js";
import { ok } from "../wire/wire.js";

/** @typedef {import("../wire/wire.js").FakeResponse} FakeResponse */

/** @type {{ fetch?: unknown }} */
const env = globalThis;

/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
export const CALLS = [];

/**
 * The answer to a path of the station load and its apply, or undefined for any other path: the preset read, the
 * served readings, the staging reads, the apply and the live presets.
 *
 * @param {string} path
 * @returns {FakeResponse | undefined}
 */
export function presetAnswer(path) {
  if (path === "/api/preset/Night") return ok({ name: "Night", config: { volume_max: "-9" } });
  if (path === "/api/config") return ok(readings.value);
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  if (path === "/api/config/apply") return ok({ report: {} });
  if (path === "/api/livepresets") return ok({ presets: [], stations: {} });
  return undefined;
}

/**
 * Install a `fetch` that logs every request in `CALLS` and answers it with `answer`.
 *
 * @param {(path: string) => FakeResponse} answer
 */
export function recordFetch(answer) {
  CALLS.length = 0;
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    CALLS.push({ path, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
    return answer(path);
  };
}
