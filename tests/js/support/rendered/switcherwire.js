// The wire the junk-filter and Setting Switcher suites share: the fetch fake that records every request body and
// answers the real REST paths in their real shapes, the running engine's junk-filter enumeration, and the switcher's
// own reset.
//
// `loadSwitcher` loads the switcher's stores on demand, so a suite that never calls it loads none of them.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { engineState, enums, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { readings } from "../../../../hqptuner/static/store/core/readings.js";
import { ok } from "../wire/wire.js";

/** @typedef {import("../wire/wire.js").FakeResponse} FakeResponse */

/** Every target the switcher offers. */
export const ALL = ["1x filter", "Nx filter", "Modulator", "Matrix profile", "Output mode", "Volume"];

/** The `junk_filters` names, in the engine's order, which is not their sorted order. */
export const NAMES = ["none", "20k", "2x"];

/**
 * One `junk_filters` entry as the daemon sends it: every attribute a string, its value the index of another entry.
 *
 * @param {string} name
 * @param {number} i
 */
const item = (name, i) => ({ index: String(i), value: String((i + 2) % NAMES.length), name });

/**
 * Write one running engine onto the wire-side signals.
 *
 * @param {string} junk  the running junk filter's index
 */
export function running(junk) {
  engineState.value = { state: "2", active_chain: "pcm", filter_junk: junk, filter1x: "0", filterNx: "0", shaper: "0" };
  enums.value = { junk_filters: NAMES.map(item), filters: [], shapers: [] };
}

/** @type {{ path: string, body: unknown }[]} */
const posts = [];

/** Forget every request recorded so far. */
export const forgetPosts = () => void (posts.length = 0);

/** The bodies posted to one path. @param {string} path */
export const sent = (path) => posts.filter((p) => p.path === path).map((p) => p.body);

/** The paths of the switcher's reads, beyond the engine's own. */
export const SWITCHER_READS = {
  "/api/config": () => ok({ ...readings.value }),
  "/api/matrix": () => ok({ data: { ...matrixConfig.value } }),
  "/api/matrix/profile": () => ok({ ok: true }),
};

/** The engine's own reads and its live write, as the daemon answers them. */
/** @type {Record<string, () => FakeResponse>} */
const ENGINE = {
  "/api/config/live": () => ok({ report: { live: [], stored: {} } }),
  "/api/state": () => ok({ data: { ...engineState.value } }),
  "/api/enumerations": () => ok({ data: { ...enums.value } }),
  "/api/config/pending": () => ok({ live: {}, http: {} }),
};

/**
 * The answer to one request, each body recorded first. `extra` answers the paths beyond the engine's own; `gate`, when
 * a promise, holds every write's answer until it settles.
 *
 * @param {string} path
 * @param {{ body?: string }} [opts]
 * @param {Record<string, () => FakeResponse>} [extra]
 * @param {Promise<void> | null} [gate]
 */
export async function answer(path, opts = {}, extra = {}, gate = null) {
  if (opts.body) posts.push({ path, body: JSON.parse(opts.body) });
  if (opts.body && gate) await gate;
  return (ENGINE[path] ?? extra[path] ?? (() => ok({})))();
}

/** The wire's requests handed over and not yet answered. */
export const wire = { inflight: new Set() };

/**
 * A fetch fake answering as `answer` does with `extra`, keeping each request in `wire.inflight` until it is.
 *
 * @param {Record<string, () => FakeResponse>} [extra]
 */
export const tracked =
  (extra = {}) =>
  (/** @type {string} */ path, /** @type {{ body?: string }} */ opts) => {
    const req = answer(path, opts, extra);
    wire.inflight.add(req);
    req.then(
      () => wire.inflight.delete(req),
      () => wire.inflight.delete(req),
    );
    return req;
  };

/**
 * Put the switcher on a stated start: the SDM chain loaded with Simplified names, two matrix profiles with the second
 * running, the switcher bar showing, every target's slots empty and the Modulator the target.
 */
export async function loadSwitcher() {
  const { loadLists, resetLists } = await import("../listsfixture.js");
  const { seedReadings } = await import("../readings.js");
  const { profileReading } = await import("../profile-fixtures.js");
  const { setBottomBar } = await import("../../../../hqptuner/static/store/ui/prefs.js");
  const { setSwitcherTarget, setSlot } = await import("../../../../hqptuner/static/store/faceplate/bottom/switcher.js");
  await loadLists({ chain: "sdm", plain: true });
  resetLists();
  matrixConfig.value = { fields: [] };
  enums.value = { ...enums.value, matrix_profiles: ["Desk", "Lounge"] };
  await seedReadings({ ...readings.value?.fields, matrix_profile: profileReading("Lounge") });
  setBottomBar("switcher");
  for (const t of ALL) {
    setSwitcherTarget(t);
    setSlot(0, "");
    setSlot(1, "");
  }
  setSwitcherTarget("Modulator");
}
