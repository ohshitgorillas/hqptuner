// Behavioral suite for store/setup.js — the connection panel's own store: when
// the panel throws itself open, what discovery is allowed to write into the
// host field, what a save puts on the wire, and what closes the panel again.
//
// The seams are the ones the frontend policy names (docs/testing.md, Frontend):
// the `health` signal is assigned the readings a poll would have delivered, the
// panel's own exported signals are assigned to state the situation, `fetch` is
// faked at the real REST paths with the real response shapes, and no store
// function is stubbed. The clock is injected through `initSetup(now)` rather
// than waited on (rule 7), so every "at N ms" below is a reading of that
// function and never a duration this suite spends.
//
// Readings are fresh objects every time: writing the same reference to a signal
// does not notify and the auto-open effect would never run.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/setup.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../hqptuner/static/store/signals.js";
import {
  setupOpen,
  form,
  hostTouched,
  initSetup,
  runDiscovery,
  submitConnection,
} from "../../../hqptuner/static/store/setup.js";
import { staticWire, ok } from "../support/wire.js";

/** The globals a wire fake installs a `fetch` on. */
/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @typedef {Record<string, unknown>} Reading */

// The three health readings this suite drives with, in the shape
// /api/health serves (reachable, ready, connected, credentials_ok — the last
// tri-state: null is the 8088 lane's silence, false its refusal).
/** @type {Reading} */
const NEVER = { reachable: false, ready: false, connected: false, credentials_ok: null };
/** @type {Reading} */
const REFUSED = { reachable: true, ready: false, connected: false, credentials_ok: false };
/** @type {Reading} */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true };

// One daemon, in the shape /api/discover serves: address, name, version,
// product, platform.
const FOUND = [{ address: "10.0.0.9", name: "hqplayerd", version: "5.10.0", product: "Embedded", platform: "linux" }];

/** The injected clock, in milliseconds since the page loaded. */
let clock = 0;
/** @type {(() => void) | undefined} */
let dispose;

afterEach(() => {
  if (dispose) dispose();
  dispose = undefined;
  env.fetch = REAL_FETCH;
});

// A freshly loaded page: no reading seen, panel closed, host field holding the
// loopback address it opens with and not yet edited.
/** @param {number} [at] */
function start(at = 0) {
  clock = at;
  health.value = null;
  setupOpen.value = false;
  hostTouched.value = false;
  form.value = { host: "127.0.0.1", username: "", password: "", remember: false };
  dispose = initSetup(() => clock);
}

// One health poll landing at `at` ms, answered with what the panel then shows.
/**
 * @param {Reading} fields
 * @param {number} at
 * @returns {boolean}
 */
function reading(fields, at) {
  clock = at;
  health.value = { ...fields };
  return setupOpen.value;
}

// The REST fake: discovery's answer, the saved record GET /api/connection
// serves, and a 200 on the POST with the body recorded for the case to read.
/** @returns {Record<string, unknown>[]} */
function wire() {
  /** @type {Record<string, unknown>[]} */
  const posts = [];
  staticWire(undefined, (path, opts) => {
    if (path === "/api/discover") return ok(FOUND);
    if (path === "/api/connection" && opts.method === "POST") {
      posts.push(JSON.parse(String(opts.body)));
      return ok({ host: "10.0.0.9", username: "tuner", remember: true, has_password: true });
    }
    if (path === "/api/connection") {
      return ok({ host: "127.0.0.1", username: "", remember: false, has_password: false });
    }
    return undefined;
  });
  return posts;
}

// --- when the panel throws itself open --------------------------------------

/**
 * @typedef {{ name: string, readings: [Reading, number][], open: boolean }} AutoCase
 */

/** @type {AutoCase[]} */
const AUTO = [
  {
    name: "test_a_first_unreachable_reading_on_a_fresh_page_leaves_the_panel_closed",
    readings: [[NEVER, 0]],
    open: false,
  },
  {
    name: "test_a_daemon_still_unreachable_at_3500_ms_opens_the_panel",
    readings: [[NEVER, 3500]],
    open: true,
  },
  {
    name: "test_a_reading_with_credentials_ok_false_opens_the_panel_at_once",
    readings: [[REFUSED, 0]],
    open: true,
  },
  {
    name: "test_a_daemon_that_had_connected_going_unreachable_leaves_the_panel_closed",
    readings: [
      [HEALTHY, 0],
      [NEVER, 10000],
    ],
    open: false,
  },
];

for (const kase of AUTO) {
  test(kase.name, () => {
    start();
    let open = setupOpen.value;
    for (const [fields, at] of kase.readings) open = reading(fields, at);
    assert.equal(open, kase.open);
  });
}

// --- what discovery may write into the host field ---------------------------

test("test_discovery_fills_a_host_field_the_user_has_not_touched", async () => {
  start();
  wire();
  await runDiscovery();
  assert.equal(form.value.host, "10.0.0.9");
});

test("test_discovery_leaves_a_host_the_user_typed_alone", async () => {
  start();
  wire();
  form.value = { ...form.value, host: "192.168.1.5" };
  hostTouched.value = true;
  await runDiscovery();
  assert.equal(form.value.host, "192.168.1.5");
});

// --- what a save puts on the wire -------------------------------------------

for (const remember of [true, false]) {
  test(`test_a_save_with_remember_${remember}_carries_the_password`, async () => {
    start();
    const posts = wire();
    form.value = { host: "10.0.0.9", username: "tuner", password: "s3cret", remember };
    await submitConnection();
    const body = posts[0] ?? {};
    assert.deepEqual({ password: body.password, remember: body.remember }, { password: "s3cret", remember });
  });
}

// --- what closes the panel again --------------------------------------------

test("test_the_panel_stays_open_on_the_saves_own_200", async () => {
  start(10000);
  wire();
  setupOpen.value = true;
  form.value = { host: "10.0.0.9", username: "tuner", password: "s3cret", remember: true };
  await submitConnection();
  assert.equal(setupOpen.value, true);
});

test("test_a_ready_health_reading_after_a_save_closes_the_panel", async () => {
  start(10000);
  wire();
  setupOpen.value = true;
  form.value = { host: "10.0.0.9", username: "tuner", password: "s3cret", remember: true };
  await submitConnection();
  assert.equal(reading(HEALTHY, 10000), false);
});
