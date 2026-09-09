// Behavioral suite for the two poll ticks in store/sync.js viewed through what
// each one asks the wire for over a given /api/health reading: the fast tick,
// which may only ask beyond /api/health once the 4321 handshake is answering,
// and the config tick, which may only ask the credential routes once the whole
// load is up (`ready`). `reachable` and `ready` are separate members of the
// health frame and neither speaks for the other.
//
// Fakes go at the wire and the environment seams only (docs/testing.md rule 4):
// globalThis.fetch answers the real REST paths with real shapes, and
// globalThis.setInterval/clearInterval are captured the same way. Unlike
// polling.test.js the interval fake KEEPS the callback, because these cases
// drive a tick rather than reading a cadence; nothing here waits on the wall
// clock and no scheduled callback ever fires by itself.
//
// The timer fakes are installed for the life of this file, deliberately:
// startPolling registers a reactive effect it never disposes, so restoring the
// real setInterval mid-file would let that leak schedule a real repeating poll.
// Files run in their own child process, so nothing escapes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/pollgate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../hqptuner/static/store/signals.js";
import { startPolling } from "../../../hqptuner/static/store/sync.js";
import { activeTab } from "../../../hqptuner/static/store/ui.js";
import { quickSystemUpdates, liveMode } from "../../../hqptuner/static/store/prefs.js";
import { ok } from "../support/wire.js";

const INTERVAL = 2000;

// --- the timer seam, faked for the file's life (see header) -------------------

/** @typedef {{ id: number, ms: number, fn: () => unknown }} Registration */

/** @type {Registration[]} */
const intervals = [];
/** @type {number[]} */
const cleared = [];
let nextId = 1;

/**
 * The globals these fakes install over, viewed as optional members: the DOM
 * lib's signatures do not match these simplified fakes.
 *
 * @type {{ setInterval?: unknown, clearInterval?: unknown, fetch?: unknown }}
 */
const env = globalThis;
env.setInterval = (/** @type {() => unknown} */ fn, /** @type {number} */ ms) => {
  const id = nextId++;
  intervals.push({ id, ms, fn });
  return id;
};
env.clearInterval = (/** @type {number} */ id) => {
  cleared.push(id);
};

// --- the wire -----------------------------------------------------------------

/** @typedef {ReturnType<typeof ok>} FakeResponse */

/** @type {string[]} */
const requested = [];

/** @typedef {{ reachable: boolean, ready: boolean, credentials_ok: boolean }} Reading */

/** @type {Reading} */
let reading = { reachable: true, ready: true, credentials_ok: true };

// The rest of the poll's endpoints in their real shapes, so a tick that is
// allowed through gets a real answer rather than an empty bag.
/** @type {Record<string, FakeResponse>} */
const DEFAULTS = {
  "GET /api/state": ok({ stale: false, data: { adaptive: "0" } }),
  "GET /api/status": ok({ stale: false, data: { status: {} } }),
  "GET /api/volume": ok({ volume: "-20.5", min: -60, max: 0, enabled: true, adaptive: false }),
  "GET /api/metadata": ok({ filters: [] }),
  "GET /api/enumerations": ok({ data: null }),
  "GET /api/config": ok({ data: { fields: [], file: {}, active: "" } }),
  "GET /api/matrix": ok({ data: { fields: [] } }),
  "GET /api/config/pending": ok({ live: {}, http: {} }),
};

/** @param {Reading} r */
const frame = (r) => ({ ...r, alarm: false, unreachable_since: null, info: {} });

env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string }} */ opts = {}) => {
  requested.push(path);
  if (path === "/api/health") return ok(frame(reading));
  return DEFAULTS[`${opts.method || "GET"} ${path}`] || ok({});
};

// The fake wire resolves in microtasks only, so a handful of macrotask turns
// drains the whole await chain — event-loop turns, never a duration
// (docs/testing.md rule 7).
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

// --- one registration for the whole file ---------------------------------------
// The default fast cadence needs the default inputs, pinned here rather than
// assumed, so the fast lane stays at INTERVAL and the config lane at twice it
// (polling.test.js).

activeTab.value = "output";
quickSystemUpdates.value = false;
liveMode.value = false;
startPolling(INTERVAL);
await settle();

/**
 * The callback most recently registered at the given cadence: the fast lane's
 * effect re-registers on a cadence change, so the last one is the live timer.
 *
 * @param {number} ms
 * @returns {() => unknown}
 */
function lane(ms) {
  const reg = intervals.filter((entry) => entry.ms === ms).at(-1);
  if (reg === undefined) throw new Error(`no interval registered at ${ms} ms`);
  return reg.fn;
}

/**
 * Drive exactly one tick of the lane at `ms` over the given health reading, and
 * answer with the paths it asked the wire for, deduplicated and sorted: what a
 * tick asks for, not how many times or in what order.
 *
 * @param {number} ms
 * @param {Reading} r
 * @returns {Promise<string[]>}
 */
async function tick(ms, r) {
  reading = r;
  health.value = frame(r);
  await settle();
  const fn = lane(ms);
  requested.length = 0;
  await fn();
  await settle();
  return [...new Set(requested)].sort();
}

// --- the fast tick: /api/health always, the rest only over a reachable daemon ---
// `ready` is held false across both cases, so only `reachable` can account for
// the difference. A tick gated on the reading as a whole asks for nothing at
// reachable false, takes no further health reading, and so never un-gates.

const FAST = [
  { reachable: false, paths: ["/api/health"] },
  { reachable: true, paths: ["/api/health", "/api/state", "/api/status", "/api/volume"] },
];

for (const c of FAST) {
  test(`test_the_fast_tick_asks_beyond_health_only_over_a_reachable_daemon: reachable=${c.reachable}`, async () => {
    const paths = await tick(INTERVAL, { reachable: c.reachable, ready: false, credentials_ok: false });
    assert.deepEqual(paths, [...c.paths].sort());
  });
}

// --- the config tick: the credential routes only over a ready daemon -----------
// `reachable` is held true across both cases, so only `ready` can account for
// the difference: reachable true with ready false is the reading a wrong
// management credential produces, where the 8088 lane is refused.

const CONFIG = [
  { ready: false, paths: /** @type {string[]} */ ([]) },
  { ready: true, paths: ["/api/enumerations", "/api/config", "/api/matrix", "/api/config/pending"] },
];

for (const c of CONFIG) {
  test(`test_the_config_tick_asks_the_credential_routes_only_over_a_ready_daemon: ready=${c.ready}`, async () => {
    const paths = await tick(INTERVAL * 2, { reachable: true, ready: c.ready, credentials_ok: c.ready });
    assert.deepEqual(paths, [...c.paths].sort());
  });
}
