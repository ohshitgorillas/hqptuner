// Behavioral suite for the LIVE controls' error map across a daemon reconnect —
// store/live.js's exported `liveErrors`, driven by the `health` signal the
// polling loop writes.
//
// Changing the filter or the output mode takes hqplayerd's audio engine down
// briefly and the daemon can drop the control connection under it; the poll loop
// reconnects within seconds. That drop can be shorter than the frontend's health
// poll interval, so `reachable` may never be observed as false across a
// reconnect — `connected_at` is the field that always changes. So the errors the
// old connection left on the controls are stale exactly when a NEW connection
// appears, and never merely because a poll says the daemon is reachable.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported `health` signal with the shape
// /api/health actually serves and reads the exported `liveErrors` signal; no
// store function is stubbed and there is no network here.
//
// ORDER MATTERS for the first case only: module-level signals live for the life
// of the file, and "no connection has been seen yet" is a state only a freshly
// imported store is in. It therefore runs before any other case writes `health`.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/livereconnect.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../hqptuner/static/store/signals.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live.js";

// /api/health as the frontend receives it. `connected_at` is when the CURRENT
// control connection was established, so a fresh value means a reconnect.
// Writing the same object reference to a signal does not notify, so every
// simulated poll below builds a new one.
const poll = (o = {}) => ({
  reachable: true,
  unreachable_since: null,
  connected_at: 1000,
  alarm: false,
  info: {},
  license: null,
  app_version: "0.0.0-test",
  ...o,
});

// Total reset of every source signal these cases touch. `health` is deliberately
// NOT reset here: the store's memory of which connection it last saw is not
// resettable through the public surface, so each case moves `connected_at`
// forward from wherever the previous one left it rather than pretending to
// rewind. Each case states the connection numbers it uses.
function seed(errors) {
  liveErrors.value = { ...errors };
  liveBusy.value = "";
}

// --- nothing seen yet ---------------------------------------------------------
// Must stay first in the file: it is the only case that runs with no prior
// connection recorded. There is no previous connection, so nothing on the
// controls can be stale, and the first payload drops nothing.

test("test_the_first_health_poll_ever_leaves_an_existing_error_in_place", () => {
  seed({ filter: "filter never converged" });
  health.value = poll({ connected_at: 1000 });
  assert.equal(liveErrors.value.filter, "filter never converged");
});

// --- the connection has not moved ---------------------------------------------

test("test_an_error_survives_a_poll_reporting_the_same_connection", () => {
  seed({ filter: "filter never converged" });
  health.value = poll({ connected_at: 1000 });
  assert.equal(liveErrors.value.filter, "filter never converged");
});

test("test_an_error_survives_repeated_polls_reporting_the_same_connection", () => {
  seed({ filter: "filter never converged" });
  health.value = poll({ connected_at: 1000 });
  health.value = poll({ connected_at: 1000 });
  health.value = poll({ connected_at: 1000 });
  assert.equal(liveErrors.value.filter, "filter never converged");
});

// A poll that reports the daemon reachable is not itself news: the daemon was
// reachable on the poll before it too, on the same connection. A store keyed on
// reachability rather than on the connection clears here and fails.
test("test_a_poll_reporting_the_daemon_still_reachable_clears_nothing", () => {
  seed({ mode: "the pcm chain is not loaded (engine chain: sdm)" });
  health.value = poll({ connected_at: 1000, alarm: true });
  assert.equal(liveErrors.value.mode, "the pcm chain is not loaded (engine chain: sdm)");
});

// --- a new connection ---------------------------------------------------------

test("test_a_reconnect_clears_the_error_on_a_control", () => {
  seed({ filter: "filter never converged" });
  health.value = poll({ connected_at: 1000 });
  health.value = poll({ connected_at: 2000 });
  assert.equal(liveErrors.value.filter, undefined);
});

// The engine restart that drops the connection can be shorter than the poll
// interval, so both polls say reachable and `unreachable_since` stays null
// throughout — `connected_at` is the only field that moved.
test("test_a_reconnect_never_seen_as_unreachable_still_clears_the_error", () => {
  seed({ filter: "filter never converged" });
  health.value = poll({ connected_at: 3000, reachable: true, unreachable_since: null });
  health.value = poll({ connected_at: 4000, reachable: true, unreachable_since: null });
  assert.equal(liveErrors.value.filter, undefined);
});

test("test_a_reconnect_clears_every_controls_error_not_just_one", () => {
  seed({ filter: "filter never converged", mode: "mode never converged", rate: "rate never converged" });
  health.value = poll({ connected_at: 5000 });
  health.value = poll({ connected_at: 6000 });
  assert.equal(Object.keys(liveErrors.value).length, 0);
});
