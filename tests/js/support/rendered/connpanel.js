// The fetch fake the header and loadPreset suites share: the REST paths a station load and an apply touch, answered in
// their real shapes, and the log of every request it was handed. It also carries the connection panel suites' rig: the
// panel under a fake clock, the health readings that drive it and the REST fake it saves over.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { readings } from "../../../../hqptuner/static/store/core/readings.js";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { createConnPanel } from "../../../../hqptuner/static/store/connpanel.js";
import { ok, staticWire } from "../wire/wire.js";
import { fakeClock } from "../clock.js";

/** @typedef {import("../wire/wire.js").FakeResponse} FakeResponse */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

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

/** @typedef {Record<string, unknown>} Reading */

// The health readings the panel suites drive with, in the shape /api/health serves. `credentials_ok` is tri-state: null
// is the 8088 lane's silence, false is rejection.
/** @type {Reading} */
export const SILENT = { phase: "Down", credentials_ok: null, address_found: null };
/** @type {Reading} */
export const CONTROL_ONLY = { phase: "Reachable", credentials_ok: null, address_found: true };
/** @type {Reading} */
export const HEALTHY = { phase: "Ready", credentials_ok: true, address_found: true };

/** The fake clock the page reads, in milliseconds since the page loaded. */
export let fake = fakeClock();
export let panel = createConnPanel({ clock: fake.clock });
/** @type {(() => void) | undefined} */
let dispose;

// Moves the fake clock on to `at` ms since the page loaded.
/** @param {number} at */
function moveTo(at) {
  fake.advance(at - fake.clock.now());
}

// A freshly loaded page: no reading seen, no verdict, host field holding the loopback address it opens with and not yet
// edited.
/** @param {number} [at] */
export function start(at = 0) {
  fake = fakeClock();
  panel = createConnPanel({ clock: fake.clock });
  moveTo(at);
  health.value = null;
  panel.hostTouched.value = false;
  panel.verdict.value = null;
  panel.form.value = { host: "127.0.0.1", username: "", password: "", remember: false, hasPassword: false };
  dispose = panel.initPanel();
}

// The panel taken down and the real `fetch` put back.
export function stop() {
  if (dispose) dispose();
  dispose = undefined;
  env.fetch = REAL_FETCH;
}

// Turns of the event loop, never a duration: enough for the fake's immediate answers and the store's continuations off
// them to have run.
/**
 * @param {number} [turns]
 * @returns {Promise<void>}
 */
export async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

// One health poll landing at `at` ms. Readings are fresh objects every time: writing the same reference to a signal does
// not notify.
/**
 * @param {Reading} fields
 * @param {number} at
 * @returns {void}
 */
export function reading(fields, at) {
  moveTo(at);
  health.value = { ...fields };
}

// The REST fake: discovery answering `found`, the saved record GET /api/connection serves — `has_password` says whether
// the install already holds one — and a 200 on the POST carrying the lane the route reached, with the body recorded for
// the case to read.
/**
 * @param {{ found?: unknown[], hasPassword?: boolean, lane?: string }} [answers]
 * @returns {Record<string, unknown>[]}
 */
export function connectionWire({ found = [], hasPassword = false, lane = "ok" } = {}) {
  /** @type {Record<string, unknown>[]} */
  const posts = [];
  staticWire(undefined, (path, opts) => {
    if (path === "/api/discover") return ok(found);
    if (path === "/api/connection" && opts.method === "POST") {
      posts.push(JSON.parse(String(opts.body)));
      return ok({ host: "10.0.0.9", username: "tuner", remember: false, has_password: true, lane });
    }
    if (path === "/api/connection") {
      return ok({ host: "10.0.0.9", username: "tuner", remember: false, has_password: hasPassword });
    }
    return undefined;
  });
  return posts;
}

// The panel opened over the REST fake `answers` describes and the form saved with `typed` laid over the fields it opens
// with; resolves to the bodies the fake recorded.
/**
 * @param {{ found?: unknown[], hasPassword?: boolean, lane?: string }} answers
 * @param {{ host: string, username: string, password: string }} typed
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function submitForm(answers, typed) {
  const posts = connectionWire(answers);
  panel.openPanel();
  await settle();
  panel.form.value = { ...panel.form.value, ...typed };
  await panel.submitConnection();
  return posts;
}
