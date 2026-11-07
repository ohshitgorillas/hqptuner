import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { restartLane } from "../../../hqptuner/static/store/faceplate/drawer.js";
import { readings } from "../../../hqptuner/static/store/core/readings.js";
import { health } from "../../../hqptuner/static/store/signals.js";
import { ok, quiesce, stagingWire } from "../support/wire/wire.js";
import { fieldReading, seedReadings } from "../support/readings.js";

const GEN = 73;
const KEY = "volume_max";

/** @type {ReturnType<typeof stagingWire>} */
let wire;

beforeEach(async () => {
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? ok(readings.value) : undefined) });
  health.value = { phase: "Ready", generation: GEN };
  await seedReadings({});
});

afterEach(async () => {
  await quiesce(wire);
  health.value = null;
  await quiesce(wire);
});

// Break: restartLane chooses from static schema flags instead of the served verdict.
test("test_restart_lane_tracks_the_served_restart_verdict_for_the_same_field", async () => {
  await seedReadings({ [KEY]: fieldReading(-5, { restarts: true }) });
  const seen = [restartLane(KEY)];
  await seedReadings({ [KEY]: fieldReading(-5, { restarts: false }) });
  seen.push(restartLane(KEY));
  assert.deepEqual(seen, [true, false]);
});
