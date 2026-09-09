// Behavioral suite for store/setup.js — what a save puts on the wire when the
// panel was opened over a connection that already holds a password, and what
// the panel then concludes the save did.
//
// The seams are the ones the frontend policy names (docs/testing.md, Frontend):
// `fetch` is faked at the real REST paths with the real response shapes, the
// `health` signal is assigned the readings a poll would have delivered, the
// panel's own exported signals are assigned to state the situation, and no
// store function is stubbed. The clock is injected through `initSetup(now)`
// (rule 7), so every "at N ms" below is a reading of that function and never a
// duration this suite spends; `settle()` turns the event loop rather than
// waiting on one.
//
// Readings are fresh objects every time: writing the same reference to a signal
// does not notify.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/setup-verdict.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../hqptuner/static/store/signals.js";
import {
  setupOpen,
  form,
  hostTouched,
  verdict,
  initSetup,
  openSetup,
  submitConnection,
} from "../../../hqptuner/static/store/setup.js";
import { staticWire, ok } from "../support/wire.js";

/** The globals a wire fake installs a `fetch` on. */
/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @typedef {Record<string, unknown>} Reading */

// The health readings this suite drives with, in the shape /api/health serves.
// `credentials_ok` is tri-state: null is the 8088 lane's silence.
/** @type {Reading} */
const SILENT = { reachable: false, ready: false, connected: false, credentials_ok: null };
/** @type {Reading} */
const CONTROL_ONLY = { reachable: true, ready: false, connected: true, credentials_ok: null };

/** The injected clock, in milliseconds since the page loaded. */
let clock = 0;
/** @type {(() => void) | undefined} */
let dispose;

afterEach(() => {
  if (dispose) dispose();
  dispose = undefined;
  env.fetch = REAL_FETCH;
});

// A freshly loaded page: no reading seen, no verdict, panel closed, host field
// holding the loopback address it opens with and not yet edited.
/** @param {number} [at] */
function start(at = 0) {
  clock = at;
  health.value = null;
  setupOpen.value = false;
  hostTouched.value = false;
  verdict.value = null;
  form.value = { host: "127.0.0.1", username: "", password: "", remember: false };
  dispose = initSetup(() => clock);
}

// Turns of the event loop, never a duration: enough for the fake's immediate
// answers and the store's continuations off them to have run.
/**
 * @param {number} [turns]
 * @returns {Promise<void>}
 */
async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

// One health poll landing at `at` ms.
/**
 * @param {Reading} fields
 * @param {number} at
 * @returns {void}
 */
function reading(fields, at) {
  clock = at;
  health.value = { ...fields };
}

// The REST fake: discovery answering nobody, the saved record GET
// /api/connection serves — `has_password` says whether the install already
// holds one — and a 200 on the POST carrying the lane the route reached, with
// the body recorded for the case to read.
/**
 * @param {{ hasPassword?: boolean, lane?: string }} [answers]
 * @returns {Record<string, unknown>[]}
 */
function wire({ hasPassword = false, lane = "ok" } = {}) {
  /** @type {Record<string, unknown>[]} */
  const posts = [];
  staticWire(undefined, (path, opts) => {
    if (path === "/api/discover") return ok([]);
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

// What the save asked the route to do with the password: the value it sent, or
// `undefined` where it sent no `password` key at all and left the held one be.
/**
 * @param {Record<string, unknown>} body
 * @returns {unknown}
 */
function sentPassword(body) {
  return Object.prototype.hasOwnProperty.call(body, "password") ? body.password : undefined;
}

// --- what a save does with the password field -------------------------------

/**
 * @typedef {{ name: string, held: boolean, typed: string, sent: unknown }} SaveCase
 */

/** @type {SaveCase[]} */
const SAVES = [
  {
    name: "test_a_blank_password_field_over_a_held_password_sends_no_password_at_all",
    held: true,
    typed: "",
    sent: undefined,
  },
  {
    name: "test_a_typed_password_over_a_held_password_sends_what_was_typed",
    held: true,
    typed: "s3cret",
    sent: "s3cret",
  },
  {
    name: "test_a_blank_password_field_over_an_install_holding_none_also_sends_no_password_at_all",
    held: false,
    typed: "",
    sent: undefined,
  },
];

for (const kase of SAVES) {
  test(kase.name, async () => {
    start();
    const posts = wire({ hasPassword: kase.held });
    openSetup();
    await settle();
    form.value = { ...form.value, host: "10.0.0.9", username: "tuner", password: kase.typed };
    await submitConnection();
    assert.equal(sentPassword(posts[0] ?? {}), kase.sent);
  });
}

// --- what the panel concludes the save did ----------------------------------

/**
 * @typedef {{ name: string, host: string, lane: string, reading: Reading | null, at: number, verdict: string }} SaidCase
 */

/** @type {SaidCase[]} */
const SAID = [
  {
    name: "test_a_save_with_an_empty_host_field_says_so_and_asks_nothing_of_the_wire",
    host: "",
    lane: "ok",
    reading: null,
    at: 0,
    verdict: "no-host",
  },
  {
    name: "test_a_silent_lane_one_second_after_an_accepted_save_is_still_connecting",
    host: "10.0.0.9",
    lane: "ok",
    reading: SILENT,
    at: 1000,
    verdict: "connecting",
  },
  {
    name: "test_a_silent_lane_four_seconds_after_an_accepted_save_is_unreachable",
    host: "10.0.0.9",
    lane: "ok",
    reading: SILENT,
    at: 4000,
    verdict: "unreachable",
  },
  {
    name: "test_a_reachable_daemon_after_a_save_the_route_reported_refused_says_refused",
    host: "10.0.0.9",
    lane: "refused",
    reading: CONTROL_ONLY,
    at: 0,
    verdict: "refused",
  },
];

for (const kase of SAID) {
  test(kase.name, async () => {
    start();
    wire({ lane: kase.lane });
    form.value = { ...form.value, host: kase.host, username: "tuner", password: "s3cret" };
    await submitConnection();
    if (kase.reading) reading(kase.reading, kase.at);
    await settle();
    assert.equal(verdict.value, kase.verdict);
  });
}
