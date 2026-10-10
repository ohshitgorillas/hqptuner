// Behavioral suite for how the store's apply lane words a failed request in its
// verdict (`lastApply`, the pending bar's status line).
//
// A failure from HQPTuner's own side carries no backend sentence, HQPTuner not
// reachable at all or a failed response with no usable detail, and is reported
// behind a prefix naming the lane that failed. What follows it is the client's
// own description of the failure, read off the client's public surface over the
// same wire: an unreachable backend and an unexplained status each read the same
// from any endpoint (tests/js/lib/api.test.js), so `api.status()` gives the
// message the lane's own request rejects with. These cases pin that the verdict
// puts something in front of that message.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apply-failure-prefix.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../../hqptuner/static/lib/api.js";
import { applyAll, lastApply } from "../../../hqptuner/static/store/actions.js";
import { bad } from "../support/wire/wire.js";
import { env, route, trees } from "../support/threetrees.js";

/** @typedef {import("../support/wire/wire.js").FakeResponse} FakeResponse */
/** @typedef {() => FakeResponse | Promise<never>} Failure */

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

//: The REST path the apply lane posts to: wire identity.
const APPLY = "/api/config/apply";

//: The browser's wording for a fetch that never reached HQPTuner.
const NETWORK_ERROR = "Failed to fetch";

//: A server error whose body is not JSON at all, so it has no usable detail.
const UNEXPLAINED = 503;

//: HQPTuner not reachable: the request rejects before any response.
/** @type {Failure} */
const unreachable = () => Promise.reject(new TypeError(NETWORK_ERROR));

//: A failed response with no usable detail.
/** @type {Failure} */
const unexplained = () => bad(UNEXPLAINED);

/**
 * Put the three-tree wire in place, with every request to `path` failing as
 * `failure` does.
 *
 * @param {string} path
 * @param {Failure} failure
 */
function failingAt(path, failure) {
  route();
  const answered = /** @type {(p: string, o?: unknown) => Promise<FakeResponse>} */ (env.fetch);
  env.fetch = async (/** @type {string} */ asked, /** @type {unknown} */ opts) =>
    asked === path ? failure() : answered(asked, opts);
}

/**
 * The message the client rejects with when a request fails as `failure` does.
 *
 * @param {Failure} failure
 * @returns {Promise<string>}
 */
async function clientMessage(failure) {
  failingAt("/api/status", failure);
  const outcome = await api.status().then(
    () => null,
    (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e)),
  );
  if (outcome === null) throw new Error("the client resolved; there is no rejection to read");
  return outcome;
}

/**
 * The text of the verdict the last lane recorded. A case whose lane recorded
 * nothing has lost its own premise rather than its assertion.
 *
 * @returns {string}
 */
function verdictText() {
  if (lastApply.value === null) throw new Error("expected a verdict, none was recorded");
  return String(lastApply.value.text);
}

/**
 * Apply over a wire on which the apply request fails as `failure` does.
 *
 * @param {Failure} failure
 * @returns {Promise<string>}
 */
async function applyFailingWith(failure) {
  await trees();
  failingAt(APPLY, failure);
  await applyAll().catch(() => {});
  return verdictText();
}

/**
 * How many characters a text carries in front of `message`, or -1 when the
 * text does not end with it.
 *
 * @param {string} said
 * @param {string} message
 * @returns {number}
 */
const lengthBefore = (said, message) => (said.endsWith(message) ? said.length - message.length : -1);

test("test_an_apply_that_cannot_reach_hqptuner_is_reported_behind_the_lanes_prefix", async () => {
  const message = await clientMessage(unreachable);
  const said = await applyFailingWith(unreachable);
  assert.ok(lengthBefore(said, message) > 0, said);
});

test("test_an_apply_refused_with_no_usable_detail_is_reported_behind_the_lanes_prefix", async () => {
  const message = await clientMessage(unexplained);
  const said = await applyFailingWith(unexplained);
  assert.ok(lengthBefore(said, message) > 0, said);
});
