// Behavioral suite for store/connpanel.js — what a save puts on the wire when the
// panel was opened over a connection that already holds a password, and what
// the panel then concludes the save did.
//
// `fetch` is faked at the real REST paths with the real response shapes, the
// `health` signal is assigned the readings a poll would have delivered, and the
// panel's own exported signals are assigned to state the situation.
// The suite's fake clock (tests/js/support/clock.js) is handed in through `createConnPanel`,
// so every "at N ms" below is a reading of that clock and never a
// duration this suite spends; `settle()` turns the event loop rather than
// waiting on one.
//
// Readings are fresh objects every time: writing the same reference to a signal
// does not notify.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/connpanel-verdict.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { panelOpen } from "../../../hqptuner/static/store/faceplate/view.js";
import {
  CONTROL_ONLY,
  SILENT,
  panel,
  reading,
  settle,
  start as startPanel,
  stop,
  submitForm,
} from "../support/rendered/connpanel.js";

/** @typedef {import("../support/rendered/connpanel.js").Reading} Reading */

/** A freshly loaded page with the panel closed. */
/** @param {number} [at] */
function start(at = 0) {
  panelOpen.value = false;
  startPanel(at);
}

afterEach(stop);

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
    name: "test_a_typed_password_over_a_held_password_sends_what_was_typed",
    held: true,
    typed: "s3cret",
    sent: "s3cret",
  },
];

for (const kase of SAVES) {
  test(kase.name, async () => {
    start();
    const posts = await submitForm(
      { hasPassword: kase.held },
      { host: "10.0.0.9", username: "tuner", password: kase.typed },
    );
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
    name: "test_a_silent_lane_one_second_after_an_accepted_save_is_still_connecting",
    host: "10.0.0.9",
    lane: "ok",
    reading: SILENT,
    at: 1000,
    verdict: "connecting",
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
    await submitForm({ lane: kase.lane }, { host: kase.host, username: "tuner", password: "s3cret" });
    if (kase.reading) reading(kase.reading, kase.at);
    await settle();
    assert.equal(panel.verdict.value, kase.verdict);
  });
}
