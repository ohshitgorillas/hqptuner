// Behavioral suite for store/connpanel.js — the connection panel's own store: when
// the panel throws itself open, what discovery is allowed to write into the
// host field, what a save puts on the wire, and what closes the panel again.
//
// The `health` signal is assigned the readings a poll would have delivered, the
// panel's own exported signals are assigned to state the situation, and `fetch` is
// faked at the real REST paths with the real response shapes.
// The suite's fake clock (tests/js/support/clock.js) is handed in through `createConnPanel`,
// so every "at N ms" below is a reading of that clock and never a duration this
// suite spends.
//
// Readings are fresh objects every time: writing the same reference to a signal
// does not notify and the auto-open effect would never run.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/connpanel.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../hqptuner/static/store/signals.js";
import { createConnPanel } from "../../../hqptuner/static/store/connpanel.js";
import { panelOpen } from "../../../hqptuner/static/store/faceplate/view.js";
import { staticWire, ok } from "../support/wire/wire.js";
import { fakeClock } from "../support/clock.js";

/** The globals a wire fake installs a `fetch` on. */
/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @typedef {Record<string, unknown>} Reading */

// The three health readings this suite drives with, in the shape
// /api/health serves (phase, credentials_ok, address_found — the verdicts are
// tri-state: null is no conclusive dial, false is rejection).
/** @type {Reading} */
const NEVER = { phase: "Down", credentials_ok: null, address_found: null };
/** @type {Reading} */
const REFUSED = { phase: "Reachable", credentials_ok: false, address_found: true };
/** @type {Reading} */
const HEALTHY = { phase: "Ready", credentials_ok: true, address_found: true };

// One daemon, in the shape /api/discover serves: address, name, version,
// product, platform.
const FOUND = [{ address: "10.0.0.9", name: "hqplayerd", version: "5.10.0", product: "Embedded", platform: "linux" }];

/** The fake clock the page reads, in milliseconds since the page loaded. */
let fake = fakeClock();
let panel = createConnPanel({ clock: fake.clock });
/** @type {(() => void) | undefined} */
let dispose;

// Moves the fake clock on to `at` ms since the page loaded.
/** @param {number} at */
function moveTo(at) {
  fake.advance(at - fake.clock.now());
}

afterEach(() => {
  if (dispose) dispose();
  dispose = undefined;
  env.fetch = REAL_FETCH;
});

// A freshly loaded page: no reading seen, panel closed, host field holding the
// loopback address it opens with and not yet edited.
/** @param {number} [at] */
function start(at = 0) {
  fake = fakeClock();
  panel = createConnPanel({ clock: fake.clock });
  moveTo(at);
  health.value = null;
  panelOpen.value = false;
  panel.hostTouched.value = false;
  panel.form.value = { host: "127.0.0.1", username: "", password: "", remember: false, hasPassword: false };
  dispose = panel.initPanel();
}

// One health poll landing at `at` ms, answered with what the panel then shows.
/**
 * @param {Reading} fields
 * @param {number} at
 * @returns {boolean}
 */
function reading(fields, at) {
  moveTo(at);
  health.value = { ...fields };
  return panelOpen.value;
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
    wire();
    let open = panelOpen.value;
    for (const [fields, at] of kase.readings) open = reading(fields, at);
    assert.equal(open, kase.open);
  });
}

// --- what discovery may write into the host field ---------------------------

test("test_discovery_fills_a_host_field_the_user_has_not_touched", async () => {
  start();
  wire();
  await panel.runDiscovery();
  assert.equal(panel.form.value.host, "10.0.0.9");
});

test("test_discovery_leaves_a_host_the_user_typed_alone", async () => {
  start();
  wire();
  panel.form.value = { ...panel.form.value, host: "192.168.1.5" };
  panel.hostTouched.value = true;
  await panel.runDiscovery();
  assert.equal(panel.form.value.host, "192.168.1.5");
});

// --- what closes the panel again --------------------------------------------

test("test_the_panel_stays_open_on_the_saves_own_200", async () => {
  start(10000);
  wire();
  panelOpen.value = true;
  panel.form.value = { host: "10.0.0.9", username: "tuner", password: "s3cret", remember: true, hasPassword: false };
  await panel.submitConnection();
  assert.equal(panelOpen.value, true);
});
