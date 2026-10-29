import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  effective,
  runningValue,
  isDirty,
  stagedCount,
  effectivePipelines,
} from "../../../hqptuner/static/store/resolve.js";
import { readings, holdDrag, dropDrag } from "../../../hqptuner/static/store/core/readings.js";
import { health } from "../../../hqptuner/static/store/signals.js";
import { ok, stagingWire, quiesce } from "../support/wire/wire.js";
import { fieldReading, seedReadings } from "../support/readings.js";

const GEN = 61;
const KEY = "volume_max";
const OTHER = "matrix_engine";
const ENGINE = -7;
const FILE = -19;
const STAGED = -23;
const DRAG = -29;
const ENGINE_STORE = { value: ENGINE, name: "fixture", generation: GEN };
const FILE_STORE = { value: FILE, generation: GEN };

/** @type {ReturnType<typeof stagingWire>} */
let wire;

beforeEach(() => {
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? ok(readings.value) : undefined) });
  health.value = { phase: "Ready", generation: GEN };
  seedReadings({});
  dropDrag(KEY);
});

afterEach(async () => {
  await quiesce(wire);
  dropDrag(KEY);
  health.value = null;
  await quiesce(wire);
});

// Break: effective chooses a store from the lane instead of the served show key.
test("test_effective_follows_the_servers_shown_store", () => {
  seedReadings({ [KEY]: fieldReading(ENGINE, { file: FILE_STORE }) });
  const seen = [effective(KEY)];
  seedReadings({ [KEY]: fieldReading(FILE, { show: "file", engine: ENGINE_STORE }) });
  seen.push(effective(KEY));
  assert.deepEqual(seen, [ENGINE, FILE]);
});

// Break: effective ignores the shared drag or continues showing it after release.
test("test_effective_releases_a_drag_to_the_served_staging", () => {
  seedReadings({ [KEY]: fieldReading(ENGINE, { staged: STAGED }) });
  holdDrag(KEY, DRAG);
  const seen = [effective(KEY)];
  dropDrag(KEY);
  seen.push(effective(KEY));
  seedReadings({ [KEY]: ENGINE });
  seen.push(effective(KEY));
  assert.deepEqual(seen, [DRAG, STAGED, ENGINE]);
});

// Break: runningValue returns the effective edit instead of the shown store.
test("test_running_value_ignores_drag_and_staging", () => {
  seedReadings({ [KEY]: fieldReading(ENGINE, { staged: STAGED, file: FILE_STORE }) });
  holdDrag(KEY, DRAG);
  const seen = [runningValue(KEY)];
  seedReadings({ [KEY]: fieldReading(FILE, { show: "file", staged: STAGED, engine: ENGINE_STORE }) });
  seen.push(runningValue(KEY));
  assert.deepEqual(seen, [ENGINE, FILE]);
});

// Break: isDirty compares values locally instead of respecting served pending state.
test("test_dirty_follows_served_staging_even_when_it_matches_the_shown_value", () => {
  seedReadings({ [KEY]: fieldReading(ENGINE, { staged: ENGINE }) });
  const seen = [isDirty(KEY)];
  seedReadings({ [KEY]: fieldReading(ENGINE, { file: FILE_STORE, diverges: true }) });
  seen.push(isDirty(KEY));
  assert.deepEqual(seen, [true, false]);
});

// Break: stagedCount counts drag or divergence, or counts only schema-known fields.
test("test_staged_count_counts_dirty_served_fields", () => {
  seedReadings({ [KEY]: fieldReading(ENGINE, { staged: STAGED }), [OTHER]: fieldReading(ENGINE, { staged: "FIR" }) });
  const seen = [stagedCount.value];
  seedReadings({
    [KEY]: fieldReading(ENGINE, { file: FILE_STORE, diverges: true }),
    [OTHER]: fieldReading(ENGINE, { staged: "FIR" }),
  });
  holdDrag(KEY, DRAG);
  seen.push(stagedCount.value);
  assert.deepEqual(seen, [2, 1]);
});

// Break: the facade blanks a control when its acquisition predates the generation.
test("test_effective_keeps_the_last_known_value_across_a_generation_move", async () => {
  seedReadings({ [KEY]: ENGINE });
  const seen = [effective(KEY)];
  health.value = { phase: "Ready", generation: GEN + 1 };
  await quiesce(wire);
  seen.push(effective(KEY));
  seedReadings({ [KEY]: fieldReading(FILE, { name: "fresh", generation: GEN + 1 }) }, GEN);
  seen.push(effective(KEY));
  assert.deepEqual(seen, [ENGINE, ENGINE, FILE]);
});

// Break: pipeline rows come from a legacy form instead of the served field.
test("test_effective_pipelines_follows_the_served_pipeline_value", () => {
  const first = [{ gain: "-8", gainunit: "dB", mixdown: "0", process: "", source: "0" }];
  const next = [{ gain: "-4", gainunit: "dB", mixdown: "1", process: "", source: "1" }];
  seedReadings({ matrix_pipelines: fieldReading(JSON.stringify(first), { show: "file" }) });
  const seen = [effectivePipelines.value[0]?.gain];
  seedReadings({ matrix_pipelines: fieldReading(ENGINE, { staged: JSON.stringify(next) }) });
  seen.push(effectivePipelines.value[0]?.gain);
  assert.deepEqual(seen, ["-8", "-4"]);
});
