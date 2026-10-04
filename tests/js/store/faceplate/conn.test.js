// Behavioral suite for hqptuner/static/store/faceplate/conn.js: the brand knob's connection state. A write in flight
// reads busy whatever the daemon's readiness, an engine that is not ready reads lost, and a ready idle engine reads ok.
//
// Driven by assigning the exported signals the state is read from: the health reading the poll writes, the apply
// lifecycle and the engine-write lifecycle.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/conn.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../../hqptuner/static/store/signals.js";
import { applying } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import { connState } from "../../../../hqptuner/static/store/faceplate/conn.js";

/** A health reading as the poll writes it: fresh each time, so the signal notifies. */
const reading = (/** @type {boolean} */ ready) => ({ reachable: true, ready, info: {} });

beforeEach(() => {
  health.value = reading(true);
  applying.value = false;
  engineBusy.value = false;
});

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
  applying.value = true;
  assert.equal(connState(), "busy");
});

test("test_an_engine_write_started_elsewhere_reads_busy", () => {
  engineBusy.value = true;
  assert.equal(connState(), "busy");
});

test("test_an_apply_while_the_engine_is_down_reads_busy", () => {
  health.value = reading(false);
  applying.value = true;
  assert.equal(connState(), "busy");
});
