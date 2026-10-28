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

/** @typedef {import("../../../hqptuner/static/model/store/reading.js").FieldReading} FieldReading */
const GEN = 61;
const KEY = "volume_max";
const OTHER = "matrix_engine";
const ENGINE = -7;
const FILE = -19;
const STAGED = -23;
const DRAG = -29;

/** @param {Partial<FieldReading>} [over] @returns {FieldReading} */
function reading(over = {}) {
  return {
    engine: { value: ENGINE, name: "fixture", generation: GEN },
    file: { value: FILE, generation: GEN },
    staged: null,
    lane: "restore",
    show: "engine",
    restarts: true,
    diverges: true,
    bounds: { min: -40, max: 0, step: 1 },
    ...over,
  };
}

/** @param {Record<string, FieldReading>} fields */
function serve(fields) {
  readings.value = { generation: GEN, fields };
}

/** @type {ReturnType<typeof stagingWire>} */
let wire;

beforeEach(() => {
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? ok(readings.value) : undefined) });
  health.value = { phase: "Ready", generation: GEN };
  serve({});
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
  serve({ [KEY]: reading() });
  const seen = [effective(KEY)];
  serve({ [KEY]: reading({ show: "file" }) });
  seen.push(effective(KEY));
  assert.deepEqual(seen, [ENGINE, FILE]);
});

// Break: effective ignores the shared drag or continues showing it after release.
test("test_effective_releases_a_drag_to_the_served_staging", () => {
  serve({ [KEY]: reading({ staged: STAGED }) });
  holdDrag(KEY, DRAG);
  const seen = [effective(KEY)];
  dropDrag(KEY);
  seen.push(effective(KEY));
  serve({ [KEY]: reading() });
  seen.push(effective(KEY));
  assert.deepEqual(seen, [DRAG, STAGED, ENGINE]);
});

// Break: runningValue returns the effective edit instead of the shown store.
test("test_running_value_ignores_drag_and_staging", () => {
  serve({ [KEY]: reading({ staged: STAGED }) });
  holdDrag(KEY, DRAG);
  const seen = [runningValue(KEY)];
  serve({ [KEY]: reading({ show: "file", staged: STAGED }) });
  seen.push(runningValue(KEY));
  assert.deepEqual(seen, [ENGINE, FILE]);
});

// Break: isDirty compares values locally instead of respecting served pending state.
test("test_dirty_follows_served_staging_even_when_it_matches_the_shown_value", () => {
  serve({ [KEY]: reading({ staged: ENGINE }) });
  const seen = [isDirty(KEY)];
  serve({ [KEY]: reading() });
  seen.push(isDirty(KEY));
  assert.deepEqual(seen, [true, false]);
});

// Break: stagedCount counts drag or divergence, or counts only schema-known fields.
test("test_staged_count_counts_dirty_served_fields", () => {
  serve({ [KEY]: reading({ staged: STAGED }), [OTHER]: reading({ staged: "FIR" }) });
  const seen = [stagedCount.value];
  serve({ [KEY]: reading(), [OTHER]: reading({ staged: "FIR" }) });
  holdDrag(KEY, DRAG);
  seen.push(stagedCount.value);
  assert.deepEqual(seen, [2, 1]);
});

// Break: the facade blanks a control when its acquisition predates the generation.
test("test_effective_keeps_the_last_known_value_across_a_generation_move", async () => {
  serve({ [KEY]: reading() });
  const seen = [effective(KEY)];
  health.value = { phase: "Ready", generation: GEN + 1 };
  await quiesce(wire);
  seen.push(effective(KEY));
  serve({ [KEY]: reading({ engine: { value: FILE, name: "fresh", generation: GEN + 1 } }) });
  seen.push(effective(KEY));
  assert.deepEqual(seen, [ENGINE, ENGINE, FILE]);
});

// Break: pipeline rows come from a legacy form instead of the served field.
test("test_effective_pipelines_follows_the_served_pipeline_value", () => {
  const first = [{ gain: "-8", gainunit: "dB", mixdown: "0", process: "", source: "0" }];
  const next = [{ gain: "-4", gainunit: "dB", mixdown: "1", process: "", source: "1" }];
  serve({ matrix_pipelines: reading({ file: { value: JSON.stringify(first), generation: GEN }, show: "file" }) });
  const seen = [effectivePipelines.value[0]?.gain];
  serve({ matrix_pipelines: reading({ staged: JSON.stringify(next) }) });
  seen.push(effectivePipelines.value[0]?.gain);
  assert.deepEqual(seen, ["-8", "-4"]);
});
