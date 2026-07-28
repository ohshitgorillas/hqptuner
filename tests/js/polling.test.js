// Behavioral suite for store/state.js's polling layer — startPolling's initial
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
  startPolling,
  refreshConfig,
  refreshDevices,
  setVolume,
  health,
  metadata,
  volume,
  volumeRange,
  config,
  matrixConfig,
  engineState,
} from "../../hqptuner/static/store/state.js";
import { activeTab } from "../../hqptuner/static/store/ui.js";
import { quickSystemUpdates, fastVolumeUpdates, liveMode } from "../../hqptuner/static/store/prefs.js";
import { ok, bad } from "./wire.js";

// --- the timer seam, faked for the file's life (see header) -------------------

const intervals = []; // every setInterval registration, in order: {id, ms}
const cleared = []; // every clearInterval'd id
let nextId = 1;
globalThis.setInterval = (_fn, ms) => {
  const id = nextId++;
  intervals.push({ id, ms });
  return id;
};
globalThis.clearInterval = (id) => {
  cleared.push(id);
};

// --- the wire ------------------------------------------------------------------

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

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

function wire(routes = {}) {
  globalThis.fetch = async (path, opts = {}) => {
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
fastVolumeUpdates.value = false;
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

test("test_quick_updates_on_the_shown_page_drop_the_cadence_to_half_a_second", () => {
  activeTab.value = "system";
  quickSystemUpdates.value = true;
  assert.equal(intervals.at(-1).ms, 500);
});

test("test_the_reschedule_clears_the_previous_fast_timer", () => {
  assert.equal(cleared.includes(intervals[0].id), true);
});

test("test_a_quick_opt_in_for_a_page_not_shown_keeps_the_default_cadence", () => {
  activeTab.value = "volume"; // system's opt-in is still on, but system is not shown
  assert.equal(intervals.at(-1).ms, 2000);
});

test("test_the_volume_page_has_its_own_fast_opt_in", () => {
  fastVolumeUpdates.value = true; // volume page is the one shown
  assert.equal(intervals.at(-1).ms, 500);
});

test("test_leaving_the_quick_page_restores_the_default_cadence", () => {
  activeTab.value = "output";
  assert.equal(intervals.at(-1).ms, 2000);
});

// LIVE has no opt-in and needs none. It is a mode rather than a tab, so
// `activeTab` still names the tab the user left while LIVE is shown — the page
// polled at the default cadence no matter what until fastPollMs read the mode
// itself. `activeTab` is left on `output`, whose opt-in does not exist, so only
// the mode can account for the cadence below.

test("test_live_mode_polls_at_half_a_second", () => {
  liveMode.value = true;
  assert.equal(intervals.at(-1).ms, 500);
});

test("test_leaving_live_returns_the_page_underneath_to_its_own_cadence", () => {
  liveMode.value = false;
  assert.equal(intervals.at(-1).ms, 2000);
});

test("test_a_tab_opt_in_still_holds_after_live_is_switched_off", () => {
  activeTab.value = "system"; // system's opt-in went on further up and stayed on
  assert.equal(intervals.at(-1).ms, 500);
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
  const posts = [];
  wire();
  const inner = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    if (opts.method === "POST") posts.push(path);
    return inner(path, opts);
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
