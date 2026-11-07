// Behavioral suite for store/setup.js — the connection panel's own store: when
// the panel throws itself open, what discovery is allowed to write into the
// host field, what a save puts on the wire, and what closes the panel again —
// and, at the end, the page's logged-out state: what puts the page at the login
// screen, what its timers ask the wire for while it sits there, and what Save
// sends and concludes then.
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
// The logged-out cases also fake the timer: globalThis.setInterval is captured the way
// live/pollgate.test.js captures it, so a tick is driven by the case and no scheduled callback
// fires by itself. The fake stays for the file's life because startPolling registers an effect it
// never disposes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/setup.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../hqptuner/static/store/signals.js";
import { startPolling } from "../../../hqptuner/static/store/sync.js";
import { api } from "../../../hqptuner/static/lib/api.js";
import {
  setupOpen,
  form,
  hostTouched,
  loggedOut,
  verdict,
  initSetup,
  runDiscovery,
  submitConnection,
} from "../../../hqptuner/static/store/setup.js";
import { staticWire, ok } from "../support/wire/wire.js";

/** The globals a wire fake installs a `fetch` and a timer on. */
/** @type {{ fetch?: unknown, setInterval?: unknown, clearInterval?: unknown }} */
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
  loggedOut.value = false;
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

// --- the logged-out state ---------------------------------------------------

const INTERVAL = 2000;

/** @typedef {{ ms: number, fn: () => unknown }} Registration */
/** @type {Registration[]} */
const intervals = [];
env.setInterval = (/** @type {() => unknown} */ fn, /** @type {number} */ ms) => {
  intervals.push({ ms, fn });
  return intervals.length;
};
env.clearInterval = () => {};

/** @typedef {{ ok: boolean, status: number, json: () => Promise<unknown> }} Answer */

/** The gate's 401 as the wire carries it: the sentence and the code beside it. */
/** @param {string} code @returns {Answer} */
const refused = (code) => ({ ok: false, status: 401, json: async () => ({ detail: "a sentence", code }) });

/** What each case wants the wire to say to `POST /api/login`. */
/** @type {Answer} */
let loginAnswer = ok({});
/** @type {string[]} */
const requested = [];
/** @type {Record<string, unknown>[]} */
const logins = [];

/** The health frame the daemon serves, over a reachable and ready engine. */
const REACHABLE = {
  reachable: true,
  ready: true,
  credentials_ok: true,
  alarm: false,
  unreachable_since: null,
  info: {},
};

/** The wire for the logged-out cases: health, the login, and an empty 200 for the rest. */
function loginWire() {
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    requested.push(`${opts.method || "GET"} ${path}`);
    if (path === "/api/health") return ok(REACHABLE);
    if (path === "/api/login") {
      logins.push(JSON.parse(String(opts.body)));
      return loginAnswer;
    }
    return ok({});
  };
}

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

loginWire();
startPolling(INTERVAL);
await settle();

/** A page with the panel closed and a username typed, over a fresh login wire. */
function loginPage() {
  start();
  loggedOut.value = false;
  verdict.value = null;
  form.value = { host: "", username: "tuner", password: "", remember: false, hasPassword: false };
  loginAnswer = ok({});
  requested.length = 0;
  logins.length = 0;
  loginWire();
}

/**
 * Drive one tick of the lane at `ms` over a reachable, ready daemon, and answer with the paths it
 * asked the wire for, deduplicated and sorted.
 *
 * @param {number} ms
 * @returns {Promise<string[]>}
 */
async function tick(ms) {
  health.value = { ...REACHABLE };
  await settle();
  const reg = intervals.filter((entry) => entry.ms === ms).at(-1);
  if (reg === undefined) throw new Error(`no interval registered at ${ms} ms`);
  requested.length = 0;
  await reg.fn();
  await settle();
  return [...new Set(requested.map((r) => r.replace(/^GET /, "")))].sort();
}

/** Make one gated request that the wire refuses with `code`, and let it land. @param {string} code */
async function refusedWith(code) {
  const saved = env.fetch;
  env.fetch = async () => refused(code);
  await api.volume().catch(() => {});
  env.fetch = saved;
}

// --- what puts the page at the login screen ---------------------------------

test("test_a_request_refused_for_want_of_a_login_leaves_the_page_logged_out", async () => {
  loginPage();
  await refusedWith("login_required");
  assert.equal(loggedOut.value, true);
});

test("test_a_request_refused_for_want_of_a_login_opens_the_panel", async () => {
  loginPage();
  await refusedWith("login_required");
  assert.equal(setupOpen.value, true);
});

test("test_a_401_that_is_not_the_logins_leaves_the_page_logged_in", async () => {
  loginPage();
  await refusedWith("login_refused");
  assert.equal(loggedOut.value, false);
});

// --- what the timers ask for while it sits there ----------------------------

test("test_the_fast_tick_asks_only_for_health_while_logged_out", async () => {
  loginPage();
  loggedOut.value = true;
  assert.deepEqual(await tick(INTERVAL), ["/api/health"]);
});

test("test_the_config_tick_asks_for_nothing_while_logged_out", async () => {
  loginPage();
  loggedOut.value = true;
  assert.deepEqual(await tick(INTERVAL * 2), []);
});

test("test_the_fast_tick_asks_beyond_health_while_logged_in", async () => {
  loginPage();
  assert.notDeepEqual(await tick(INTERVAL), ["/api/health"]);
});

// --- what Save sends while logged out ---------------------------------------

test("test_save_while_logged_out_sends_the_login_with_a_blank_password", async () => {
  loginPage();
  loggedOut.value = true;
  await submitConnection(true);
  assert.equal(logins[0]?.password, "");
});

test("test_save_while_logged_out_names_no_host_the_user_did_not_type", async () => {
  loginPage();
  loggedOut.value = true;
  await submitConnection(true);
  assert.deepEqual(
    logins.map((l) => Object.hasOwn(l, "host")),
    [false],
  );
});

test("test_save_while_logged_out_sends_the_host_the_user_typed", async () => {
  loginPage();
  loggedOut.value = true;
  form.value = { ...form.value, host: " 10.0.0.9 " };
  await submitConnection(true);
  assert.equal(logins[0]?.host, "10.0.0.9");
});

test("test_save_while_logged_out_never_saves_the_connection", async () => {
  loginPage();
  loggedOut.value = true;
  form.value = { ...form.value, host: "10.0.0.9" };
  await submitConnection(true);
  assert.equal(requested.includes("POST /api/connection"), false);
});

test("test_save_while_logged_in_sends_no_login", async () => {
  loginPage();
  form.value = { ...form.value, host: "10.0.0.9" };
  await submitConnection(true);
  assert.equal(requested.includes("POST /api/login"), false);
});

// --- what the answer to the login does --------------------------------------

test("test_a_login_the_backend_accepts_leaves_the_logged_out_state", async () => {
  loginPage();
  loggedOut.value = true;
  await submitConnection(true);
  assert.equal(loggedOut.value, false);
});

const REFUSALS = [
  { code: "login_refused", verdict: "refused" },
  { code: "login_not_answered", verdict: "not-answered" },
];

for (const r of REFUSALS) {
  test(`test_a_login_refused_with_${r.code}_sets_the_${r.verdict}_verdict`, async () => {
    loginPage();
    loggedOut.value = true;
    loginAnswer = { ok: false, status: 401, json: async () => ({ detail: "a sentence", code: r.code }) };
    await submitConnection(true);
    assert.equal(verdict.value, r.verdict);
  });
}

test("test_a_refused_login_leaves_the_page_logged_out", async () => {
  loginPage();
  loggedOut.value = true;
  loginAnswer = refused("login_refused");
  await submitConnection(true);
  assert.equal(loggedOut.value, true);
});
