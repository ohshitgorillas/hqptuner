// Behavioral suite for hqptuner/static/store/faceplate/conn.js: the brand knob's connection state. A write in flight
// reads busy whatever the daemon's readiness, an engine that is not ready reads lost, and a ready idle engine reads ok.
//
// Driven by assigning the health reading the poll writes and by holding an engine operation in flight through its own
// lifecycle: the apply operation, and the live operation another page starts.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/conn.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../../hqptuner/static/store/signals.js";
import { applyOp } from "../../../../hqptuner/static/store/actions.js";
import { liveOp } from "../../../../hqptuner/static/store/live/write.js";
import { connState } from "../../../../hqptuner/static/store/faceplate/conn.js";

/** A health reading as the poll writes it: fresh each time, so the signal notifies. */
const reading = (/** @type {boolean} */ ready) => ({ phase: ready ? "Ready" : "Reachable", info: {} });

let release = async () => {};

/**
 * Hold an engine operation in flight through its real lifecycle; `afterEach` lets it finish.
 *
 * @param {{ run: (fn: () => Promise<unknown>) => Promise<unknown> }} operation
 */
function hold(operation) {
  /** @type {() => void} */
  let finish = () => {};
  const running = operation.run(() => new Promise((resolve) => (finish = () => resolve(undefined))));
  release = async () => {
    finish();
    await running;
    release = async () => {};
  };
}

beforeEach(() => {
  health.value = reading(true);
});

afterEach(() => release());

test("test_a_ready_idle_engine_reads_ok", () => {
  assert.equal(connState(), "ok");
});

test("test_an_engine_that_is_not_ready_reads_lost", () => {
  health.value = reading(false);
  assert.equal(connState(), "lost");
});

test("test_no_health_reading_yet_reads_lost", () => {
  health.value = null;
  assert.equal(connState(), "lost");
});

test("test_an_apply_in_flight_reads_busy", () => {
  hold(applyOp);
  assert.equal(connState(), "busy");
});

test("test_an_engine_write_started_elsewhere_reads_busy", () => {
  hold(liveOp);
  assert.equal(connState(), "busy");
});

test("test_an_apply_while_the_engine_is_down_reads_busy", () => {
  health.value = reading(false);
  hold(applyOp);
  assert.equal(connState(), "busy");
});
