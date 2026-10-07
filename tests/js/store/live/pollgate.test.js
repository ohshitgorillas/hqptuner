// Behavioral suite for store/sync.js viewed through what it asks the REST wire
// for, where node gives it no document: every snapshot arrives on the push
// stream, so the only request startSync makes is the one metadata prime, and
// with no document it opens no stream at all.
//
// Fakes go at the wire and the environment seams only (docs/testing.md rule 4):
// globalThis.fetch answers the real REST paths with real shapes and records each
// path it was asked for, over a daemon reading reachable and ready so nothing on
// the wire stands in the way of a request; the EventSource fake
// (tests/js/support/eventsource.js) is installed and no document is.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/pollgate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { startSync } from "../../../../hqptuner/static/store/sync.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { ok } from "../../support/wire/wire.js";

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares it returning a real `Response`, which this fake does not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/** @type {Record<string, unknown>} */
const ANSWERS = {
  "/api/health": {
    reachable: true,
    ready: true,
    credentials_ok: true,
    alarm: false,
    unreachable_since: null,
    info: {},
  },
  "/api/metadata": { filters: [] },
  "/api/config": { data: { fields: [], file: {}, active: "" } },
};

/** @type {string[]} */
const requested = [];
env.fetch = async (/** @type {string} */ path) => {
  requested.push(path);
  return ok(ANSWERS[path] ?? {});
};

// Event-loop turns, never a duration (docs/testing.md rule 7): the fake wire
// resolves in microtasks, so a few macrotask turns drain every await chain.
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

useEventSource();
startSync();
await settle();

test("test_sync_asks_the_rest_wire_for_the_metadata_alone", () => {
  assert.deepEqual([...new Set(requested)], ["/api/metadata"]);
});

test("test_no_stream_is_opened_where_there_is_no_document", () => {
  assert.equal(lastStream(), null);
});
