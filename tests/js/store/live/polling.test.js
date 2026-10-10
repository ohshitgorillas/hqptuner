// Behavioral suite for store/sync.js, the push layer: startSync's one stream on
// /api/push and the signal each of its events writes, the metadata it primes
// once over REST, and the write paths that ride the same signals: the mirror's
// keep-last-good-value contract (via the exported refreshConfig), setVolume's
// readback echo and refreshDevices' rescan-then-repull.
//
// The
// stream is the EventSource fake (tests/js/support/eventsource.js) carrying the
// bodies api/push.py sends, the page is the document fake
// (tests/js/support/page.js), and globalThis.fetch answers the real REST paths
// with real shapes.
//
// startSync is called exactly once, at module load, and every event case reads
// the one stream it opened.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/polling.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  health,
  metadata,
  volume,
  volumeRange,
  config,
  matrixConfig,
  engineState,
  engineStatus,
  enums,
  staged,
} from "../../../../hqptuner/static/store/signals.js";
import { startSync, refreshConfig, refreshDevices } from "../../../../hqptuner/static/store/sync.js";
import { setVolume } from "../../../../hqptuner/static/store/actions.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { usePage } from "../../support/page.js";
import { ok, bad } from "../../support/wire/wire.js";

// --- the wire ------------------------------------------------------------------

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares it returning a real `Response`, which these fakes do not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** @typedef {ReturnType<typeof ok>} FakeResponse */

/** @type {Record<string, FakeResponse>} */
const DEFAULTS = {
  "GET /api/metadata": ok({ filters: [] }),
  "GET /api/enumerations": ok({ data: null }),
  "GET /api/config": ok({ data: { fields: [], file: {}, active: "" } }),
  "GET /api/matrix": ok({ data: { fields: [] } }),
  "GET /api/config/pending": ok({ live: {}, http: {} }),
};

/** @param {Record<string, FakeResponse>} [routes] */
function wire(routes = {}) {
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string }} */ opts = {}) => {
    const key = `${opts.method || "GET"} ${path}`;
    return routes[key] || DEFAULTS[key] || ok({});
  };
}

// The fake wire resolves in microtasks only, so one macrotask turn drains the
// whole await chain — no wall-clock wait anywhere.
const drain = () => new Promise((resolve) => setImmediate(resolve));

useEventSource();
usePage();
wire();
startSync();
await drain();

// --- what startSync opens and primes ---------------------------------------------

test("test_sync_opens_its_stream_on_the_push_route", () => {
  assert.equal(lastStream()?.url, "/api/push");
});

test("test_sync_primes_the_static_metadata_once", () => {
  assert.deepEqual(metadata.value, { filters: [] });
});

// --- each event lands in the signal its route's poll wrote -----------------------
// The snapshot routes arrive wrapped as {stale, loaded_at, data} and land as their
// `data`; health, volume and pending arrive raw and land whole.

const EVENTS = [
  {
    event: "health",
    body: { reachable: true, ready: true, alarm: false, unreachable_since: 1700000000, info: {} },
    read: () => health.value?.unreachable_since,
    want: 1700000000,
  },
  {
    event: "state",
    body: { stale: false, loaded_at: 1, data: { adaptive: "1" } },
    read: () => engineState.value?.adaptive,
    want: "1",
  },
  {
    event: "status",
    body: { stale: false, loaded_at: 1, data: { status: { state: 2 } } },
    read: () => engineStatus.value?.status?.state,
    want: 2,
  },
  {
    event: "enumerations",
    body: { stale: false, loaded_at: 1, data: { mode: { name: "PCM" } } },
    read: () => enums.value?.mode?.name,
    want: "PCM",
  },
  {
    event: "config",
    body: { stale: false, loaded_at: 1, data: { fields: [], file: {}, active: "Desk" } },
    read: () => config.value?.active,
    want: "Desk",
  },
  {
    event: "matrix",
    body: { stale: false, loaded_at: 1, data: { fields: [], active: "Room" } },
    read: () => matrixConfig.value?.active,
    want: "Room",
  },
  {
    event: "pending",
    body: { live: {}, http: { filter: "staged-value" } },
    read: () => staged.value.http.filter,
    want: "staged-value",
  },
];

for (const c of EVENTS) {
  test(`test_a_push_event_lands_in_its_signal: ${c.event}`, () => {
    lastStream()?.emit(c.event, c.body);
    assert.equal(c.read(), c.want);
  });
}

const VOLUME = { volume: "-20.5", min: -60, max: 0, enabled: true, adaptive: false };

test("test_the_volume_event_feeds_the_level_signal", () => {
  lastStream()?.emit("volume", VOLUME);
  assert.equal(volume.value, "-20.5");
});

test("test_the_volume_event_feeds_the_range_signal_from_the_same_body", () => {
  lastStream()?.emit("volume", { ...VOLUME, min: -70 });
  assert.equal(volumeRange.value?.min, -70);
});

// --- the mirror: a failed fetch keeps the last good value -------------------------

test("test_a_failed_config_fetch_keeps_the_last_good_snapshot", async () => {
  config.value = { fields: [], file: {}, active: "LastGood" };
  wire({ "GET /api/config": bad(503, "daemon down") });
  await refreshConfig();
  assert.equal(config.value.active, "LastGood");
});

test("test_the_next_successful_fetch_replaces_the_held_snapshot", async () => {
  config.value = { fields: [], file: {}, active: "LastGood" };
  wire({ "GET /api/config": ok({ data: { fields: [], file: {}, active: "Fresh" } }) });
  await refreshConfig();
  assert.equal(config.value.active, "Fresh");
});

test("test_a_failed_matrix_fetch_keeps_the_last_good_form", async () => {
  matrixConfig.value = { fields: [], active: "Kept" };
  wire({ "GET /api/matrix": bad(503, "daemon down") });
  await refreshConfig();
  assert.equal(matrixConfig.value.active, "Kept");
});

// --- setVolume: the immediate write's readback echo -------------------------------

test("test_set_volume_echoes_the_readback_level_into_the_slider", async () => {
  engineState.value = {};
  wire({ "POST /api/volume": ok({ volume: "-22.0" }) });
  await setVolume("-22");
  assert.equal(volume.value, "-22.0");
});

test("test_set_volume_returns_the_daemons_answer", async () => {
  wire({ "POST /api/volume": ok({ volume: "-22.0" }) });
  assert.deepEqual(await setVolume("-22"), { volume: "-22.0" });
});

test("test_a_readback_without_a_level_keeps_the_current_slider_value", async () => {
  volume.value = "-30.0";
  wire({ "POST /api/volume": ok({ volume: null }) });
  await setVolume("-22");
  assert.equal(volume.value, "-30.0");
});

// --- refreshDevices: rescan, then repull the forms ---------------------------------

test("test_refresh_devices_triggers_a_daemon_rescan", async () => {
  /** @type {string[]} */
  const posts = [];
  wire();
  const inner = env.fetch;
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string }} */ opts = {}) => {
    if (opts.method === "POST") posts.push(path);
    return typeof inner === "function" ? inner(path, opts) : ok({});
  };
  await refreshDevices();
  assert.deepEqual(posts, ["/api/config/refresh"]);
});

test("test_refresh_devices_repulls_the_config_forms", async () => {
  config.value = { fields: [], file: {}, active: "Stale" };
  wire({ "GET /api/config": ok({ data: { fields: [], file: {}, active: "AfterRescan" } }) });
  await refreshDevices();
  assert.equal(config.value.active, "AfterRescan");
});
