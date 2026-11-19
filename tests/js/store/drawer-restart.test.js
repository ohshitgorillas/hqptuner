import test from "node:test";
import assert from "node:assert/strict";
import { restartLane } from "../../../hqptuner/static/store/faceplate/drawer.js";
import { fieldReading, seedReadings, servedPage } from "../support/readings.js";

const GEN = 73;
const KEY = "volume_max";

servedPage(GEN);

// Break: restartLane chooses from static schema flags instead of the served verdict.
test("test_restart_lane_tracks_the_served_restart_verdict_for_the_same_field", async () => {
  await seedReadings({ [KEY]: fieldReading(-5, { restarts: true }) });
  const seen = [restartLane(KEY)];
  await seedReadings({ [KEY]: fieldReading(-5, { restarts: false }) });
  seen.push(restartLane(KEY));
  assert.deepEqual(seen, [true, false]);
});
