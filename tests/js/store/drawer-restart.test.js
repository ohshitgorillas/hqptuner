import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { restartLane } from "../../../hqptuner/static/store/faceplate/drawer.js";
import { readings } from "../../../hqptuner/static/store/core/readings.js";
import { health } from "../../../hqptuner/static/store/signals.js";
import { ok, quiesce, stagingWire } from "../support/wire/wire.js";

/** @typedef {import("../../../hqptuner/static/model/store/reading.js").FieldReading} FieldReading */

const GEN = 73;
const KEY = "volume_max";

/** @param {boolean} restarts @returns {FieldReading} */
function reading(restarts) {
  return {
    engine: { value: -5, name: "fixture", generation: GEN },
    file: { value: -5, generation: GEN },
    staged: null,
    lane: "restore",
    show: "engine",
    restarts,
    diverges: false,
    bounds: { min: -40, max: 0, step: 1 },
  };
}

/** @type {ReturnType<typeof stagingWire>} */
let wire;

beforeEach(() => {
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? ok(readings.value) : undefined) });
  health.value = { phase: "Ready", generation: GEN };
  readings.value = { generation: GEN, fields: {} };
});

afterEach(async () => {
  await quiesce(wire);
  health.value = null;
  await quiesce(wire);
});

// Break: restartLane chooses from static schema flags instead of the served verdict.
test("test_restart_lane_tracks_the_served_restart_verdict_for_the_same_field", () => {
  readings.value = { generation: GEN, fields: { [KEY]: reading(true) } };
  const seen = [restartLane(KEY)];
  readings.value = { generation: GEN, fields: { [KEY]: reading(false) } };
  seen.push(restartLane(KEY));
  assert.deepEqual(seen, [true, false]);
});
