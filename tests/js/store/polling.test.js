// Behavioral suite for store/sync.js, the polling layer — startPolling's initial
// prime, the reactive fast-cadence reschedule (store/ui.js fastPollMs), the
// mirror's keep-last-good-value contract (via the exported refreshConfig), and
// the two immediate write paths that ride the same signals: setVolume's
// readback echo and refreshDevices' rescan-then-repull.
//
// Fakes go at the wire and the environment seams only (docs/testing.md):
// globalThis.fetch answers the real REST paths with real shapes, and
// globalThis.setInterval/clearInterval are captured the same way — no test
// waits on the wall clock, and no store function is stubbed.
//
// The timer fakes are installed for the LIFE OF THIS FILE, deliberately:
// startPolling registers a reactive effect it never disposes, so any later
// fastPollMs change would re-fire it — restoring the real setInterval mid-file
// would let that leak schedule a real repeating poll that keeps the process
// alive. The fakes never execute a scheduled callback, so every case below is
// deterministic. Files run in their own child process, so nothing escapes.
//
// Like health.test.js's initHealth, startPolling is called exactly once, at
// module load; the cadence cases below share that one registration in sequence.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/polling.test.js

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
} from "../../../hqptuner/static/store/signals.js";
import { startPolling, refreshConfig, refreshDevices } from "../../../hqptuner/static/store/sync.js";
import { setVolume } from "../../../hqptuner/static/store/actions.js";
import { activeTab } from "../../../hqptuner/static/store/ui.js";
import { quickSystemUpdates, liveMode } from "../../../hqptuner/static/store/prefs.js";
import { ok, bad } from "../support/wire.js";

// --- the timer seam, faked for the file's life (see header) -------------------

/** @type {{ id: number, ms: number }[]} */
const intervals = []; // every setInterval registration, in order: {id, ms}
/** @type {number[]} */
const cleared = []; // every clearInterval'd id
let nextId = 1;
/**
 * The globals these fakes install over: setInterval/clearInterval as the
 * store calls them, and fetch, all viewed as optional members since the DOM
 * lib's own signatures don't match these fakes' simplified ones.
 *
 * @type {{ setInterval?: unknown, clearInterval?: unknown, fetch?: unknown }}
 */
const env = globalThis;
env.setInterval = (/** @type {unknown} */ _fn, /** @type {number} */ ms) => {
  const id = nextId++;
  intervals.push({ id, ms });
  return id;
};
env.clearInterval = (/** @type {number} */ id) => {
  cleared.push(id);
};

// `Array.prototype.at` types its result as possibly undefined for any array;
// the cases below know the registration list is never empty by the time they
// run, and read this rather than the array method to say so once instead of
// at every call site.
/**
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function last(arr) {
  const v = arr.at(-1);
  if (v === undefined) throw new Error("last() called on an empty array");
  return v;
}

// --- the wire ------------------------------------------------------------------

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** @typedef {ReturnType<typeof ok>} FakeResponse */

/** @type {Record<string, FakeResponse>} */
const DEFAULTS = {
  "GET /api/health": ok({ reachable: true, alarm: false, unreachable_since: null, info: {} }),
  "GET /api/state": ok({ stale: false, data: { adaptive: "0" } }),
  "GET /api/status": ok({ stale: false, data: { status: {} } }),
  "GET /api/volume": ok({ volume: "-20.5", min: -60, max: 0, enabled: true, adaptive: false }),
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

// One registration for the whole file; the default fast cadence needs the
// default inputs, pinned here rather than assumed.
activeTab.value = "output";
quickSystemUpdates.value = false;
liveMode.value = false;
wire();
startPolling(2000);
await drain();

// --- what startPolling schedules ------------------------------------------------

test("test_polling_starts_the_fast_lane_at_the_default_cadence", () => {
  assert.equal(intervals[0].ms, 2000);
});

test("test_the_config_poll_runs_at_twice_the_interval", () => {
  assert.equal(intervals[1].ms, 4000);
});

// --- what startPolling primes immediately ---------------------------------------

test("test_polling_primes_health_before_the_first_tick", () => {
  assert.equal(health.value.reachable, true);
});

test("test_polling_primes_the_static_metadata_once", () => {
  assert.deepEqual(metadata.value, { filters: [] });
});

test("test_the_volume_endpoint_feeds_the_level_signal", () => {
  assert.equal(volume.value, "-20.5");
});

test("test_the_volume_endpoint_feeds_the_range_signal_from_the_same_answer", () => {
  assert.equal(volumeRange.value.min, -60);
});

// --- the reactive fast cadence (store/ui.js fastPollMs) --------------------------
// Sequence-dependent by design: each case advances the shared registration the
// way the app would (the user changes page / flips the opt-in).

test("test_quick_updates_on_the_shown_system_page_poll_every_second", () => {
  activeTab.value = "system";
  quickSystemUpdates.value = true;
  assert.equal(last(intervals).ms, 1000);
});

test("test_the_reschedule_clears_the_previous_fast_timer", () => {
  assert.equal(cleared.includes(intervals[0].id), true);
});

test("test_a_quick_opt_in_for_a_page_not_shown_keeps_the_default_cadence", () => {
  activeTab.value = "output"; // system's opt-in is still on, but system is not shown
  assert.equal(last(intervals).ms, 2000);
});

// The volume page is fast unconditionally: there is no opt-in gating it, so the
// system opt-in is switched OFF first — nothing but the tab itself can account
// for the cadence below.

test("test_the_volume_page_polls_every_second_with_no_opt_in_at_all", () => {
  quickSystemUpdates.value = false;
  activeTab.value = "volume";
  assert.equal(last(intervals).ms, 1000);
});

test("test_the_system_page_without_its_opt_in_polls_at_the_default_cadence", () => {
  activeTab.value = "system"; // the opt-in went off just above
  assert.equal(last(intervals).ms, 2000);
});

// LIVE has no opt-in and needs none. It is a mode rather than a tab, so
// `activeTab` still names the tab the user left while LIVE is shown — the page
// polled at the default cadence no matter what until fastPollMs read the mode
// itself. `activeTab` is left on `system` with its opt-in off, so only the mode
// can account for the cadence below.

test("test_live_mode_polls_every_second", () => {
  liveMode.value = true;
  assert.equal(last(intervals).ms, 1000);
});

test("test_leaving_live_returns_the_page_underneath_to_its_own_cadence", () => {
  liveMode.value = false;
  assert.equal(last(intervals).ms, 2000);
});

test("test_a_tab_opt_in_still_holds_after_live_is_switched_off", () => {
  quickSystemUpdates.value = true; // the system page is the one shown
  assert.equal(last(intervals).ms, 1000);
});

// --- the mirror: a failed fetch keeps the last good value -------------------------

test("test_a_failed_config_fetch_keeps_the_last_good_snapshot", async () => {
  config.value = { fields: [], file: {}, active: "LastGood" };
  wire({ "GET /api/config": bad(503, "daemon down") });
  await refreshConfig();
  assert.equal(config.value.active, "LastGood");
});

test("test_the_next_successful_poll_replaces_the_held_snapshot", async () => {
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
