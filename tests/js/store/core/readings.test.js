import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  readings,
  field,
  holdDrag,
  dropDrag,
  playback,
  status,
  refreshReadings,
} from "../../../../hqptuner/static/store/core/readings.js";
import { health, engineState, engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { ok, stagingWire, quiesce } from "../../support/wire/wire.js";

/** @typedef {import("../../../../hqptuner/static/model/store/reading.js").FieldReading} FieldReading */
const GEN = 47;
const KEY = "gain";
const OTHER = "delay";
const ENGINE = 7;
const FILE = 19;
const NEXT = 11;
const STAGED = 23;
const DRAG = 29;
const CD = "44100";
const PCM = "352800";
const DSD = "11289600";

/**
 * @param {Partial<FieldReading>} [over]
 * @returns {FieldReading}
 */
function reading(over = {}) {
  return {
    engine: { value: ENGINE, name: "fixture", generation: GEN },
    file: { value: FILE, generation: GEN },
    staged: null,
    lane: "live",
    show: "engine",
    restarts: false,
    diverges: true,
    bounds: { min: -31, max: 31, step: 0.5 },
    ...over,
  };
}

/** @param {Record<string, FieldReading>} fields */
function body(fields) {
  return { generation: GEN, fields };
}

/** @type {ReturnType<typeof stagingWire>} */
let wire;
let response = body({});

beforeEach(() => {
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? ok(response) : undefined) });
  response = body({});
  health.value = { phase: "Ready", generation: GEN };
  engineState.value = null;
  engineStatus.value = null;
  readings.value = body({});
  dropDrag(KEY);
  dropDrag(OTHER);
  dropDrag("direct_sdm");
});

afterEach(async () => {
  await quiesce(wire);
  health.value = null;
  engineState.value = null;
  engineStatus.value = null;
  dropDrag(KEY);
  dropDrag(OTHER);
  dropDrag("direct_sdm");
  await quiesce(wire);
});

// Break: refresh unwraps a nonexistent data member or merges absent fields.
test("test_refresh_replaces_the_entire_served_config_body", async () => {
  response = body({ [KEY]: reading(), [OTHER]: reading({ show: "file" }) });
  await refreshReadings();
  const first = readings.value;
  response = body({ [KEY]: reading({ staged: STAGED }) });
  await refreshReadings();
  assert.deepEqual([first, readings.value], [body({ [KEY]: reading(), [OTHER]: reading({ show: "file" }) }), response]);
});

// Break: a previously obtained field stays bound to its first reading.
test("test_an_existing_field_observes_replacement_readings", () => {
  readings.value = body({ [KEY]: reading() });
  const view = field(KEY);
  const seen = [view.value.value];
  readings.value = body({ [KEY]: reading({ show: "file" }) });
  seen.push(view.value.value);
  assert.deepEqual(seen, [ENGINE, FILE]);
});

// Break: an older request arriving last replaces a newer completed reading.
test("test_older_refetch_cannot_overwrite_a_newer_reading", async () => {
  await quiesce(wire);
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const replies = [first, second];
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? replies.shift()?.promise : undefined) });
  const older = refreshReadings();
  const newer = refreshReadings();
  second.resolve(ok(body({ [KEY]: reading({ engine: { value: NEXT, name: "next", generation: GEN } }) })));
  await newer;
  const seen = [field(KEY).value.value];
  first.resolve(ok(body({ [KEY]: reading() })));
  await older;
  seen.push(field(KEY).value.value);
  assert.deepEqual(seen, [NEXT, NEXT]);
});

// Break: field ignores the server's pending value or keeps it after reconciliation.
test("test_served_staging_is_shown_until_the_server_clears_it", () => {
  readings.value = body({ [KEY]: reading({ staged: STAGED }) });
  const view = field(KEY);
  const seen = [view.value.value];
  readings.value = body({ [KEY]: reading() });
  seen.push(view.value.value);
  assert.deepEqual(seen, [STAGED, ENGINE]);
});

// Break: holding a drag writes the served data or fails to release to its latest reading.
test("test_a_drag_releases_to_the_latest_served_value", () => {
  readings.value = body({ [KEY]: reading() });
  const view = field(KEY);
  holdDrag(KEY, DRAG);
  const seen = [view.value.value];
  readings.value = body({ [KEY]: reading({ staged: STAGED }) });
  seen.push(view.value.value);
  dropDrag(KEY);
  seen.push(view.value.value);
  assert.deepEqual(seen, [DRAG, DRAG, STAGED]);
});

// Break: a falsy drag is treated as an absent drag.
test("test_zero_is_a_held_value_until_released", () => {
  readings.value = body({ [KEY]: reading() });
  holdDrag(KEY, 0);
  const seen = [field(KEY).value.value];
  dropDrag(KEY);
  seen.push(field(KEY).value.value);
  assert.deepEqual(seen, [0, ENGINE]);
});

// Break: one field's drag leaks into another field's local state.
test("test_holding_one_field_leaves_other_fields_at_their_readings", () => {
  readings.value = body({ [KEY]: reading(), [OTHER]: reading({ show: "file" }) });
  holdDrag(KEY, DRAG);
  const seen = [field(OTHER).value.value];
  holdDrag(OTHER, STAGED);
  seen.push(field(OTHER).value.value);
  dropDrag(KEY);
  seen.push(field(OTHER).value.value);
  assert.deepEqual(seen, [FILE, STAGED, STAGED]);
});

// Break: the running value follows the held thumb instead of the named served store.
test("test_running_ignores_the_drag_and_served_staging", () => {
  readings.value = body({ [KEY]: reading({ staged: STAGED }) });
  holdDrag(KEY, DRAG);
  const seen = [field(KEY).value.running];
  readings.value = body({ [KEY]: reading({ show: "file", staged: STAGED }) });
  seen.push(field(KEY).value.running);
  assert.deepEqual(seen, [ENGINE, FILE]);
});

// Break: a generation move clears the last reading or never refetches it.
test("test_generation_move_keeps_the_value_until_refresh_replaces_it", async () => {
  response = body({ [KEY]: reading() });
  await refreshReadings();
  const view = field(KEY);
  response = {
    generation: GEN + 1,
    fields: {
      [KEY]: reading({
        engine: { value: NEXT, name: "next", generation: GEN + 1 },
      }),
    },
  };
  health.value = { phase: "Ready", generation: GEN + 1 };
  const seen = [view.value.value];
  await quiesce(wire);
  seen.push(view.value.value);
  assert.deepEqual(seen, [ENGINE, NEXT]);
});

// Break: acquisition stamps are used to blank a retained served value.
test("test_older_acquisition_stamps_keep_the_served_value_visible", async () => {
  response = body({ [KEY]: reading() });
  await refreshReadings();
  health.value = { phase: "Ready", generation: GEN + 1 };
  await quiesce(wire);
  const seen = [field(KEY).value.value];
  response = body({ [KEY]: reading({ show: "file" }) });
  await refreshReadings();
  seen.push(field(KEY).value.value);
  assert.deepEqual(seen, [ENGINE, FILE]);
});

// Break: status reads State or holds onto the first Status object.
test("test_status_reads_each_replacement_status_frame", () => {
  engineState.value = { state: "0" };
  engineStatus.value = { status: { state: "2" } };
  const seen = [status("state")];
  engineStatus.value = { status: { state: "1" } };
  seen.push(status("state"));
  assert.deepEqual(seen, ["2", "1"]);
});

/** @param {string} state @param {string} output @param {string} chain */
function report(state, output, chain) {
  engineState.value = { state: "0", active_chain: chain };
  engineStatus.value = { status: { state, active_rate: output }, metadata: { samplerate: CD } };
}

// Break: playback exposes the wire state instead of the shared transport verdict.
test("test_transport_state_tracks_playing_and_paused_reports", () => {
  report("2", PCM, "pcm");
  const seen = [playback.value.state];
  report("1", PCM, "pcm");
  seen.push(playback.value.state);
  assert.deepEqual(seen, ["playing", "paused"]);
});

// Break: playing follows State, or does not react to a paused Status frame.
test("test_playing_follows_the_status_transport", () => {
  report("2", PCM, "pcm");
  const seen = [playback.value.playing];
  report("1", PCM, "pcm");
  seen.push(playback.value.playing);
  assert.deepEqual(seen, [true, false]);
});

// Break: chain is inferred from the output rate rather than the server's loaded chain.
test("test_chain_follows_the_server_even_when_the_output_family_disagrees", () => {
  report("2", DSD, "pcm");
  const seen = [playback.value.chain];
  report("2", PCM, "sdm");
  seen.push(playback.value.chain);
  assert.deepEqual(seen, ["pcm", "sdm"]);
});

// Break: path is inferred from the loaded chain or fails to react to transport.
test("test_path_tracks_the_playing_source_and_output", () => {
  report("2", DSD, "pcm");
  const seen = [playback.value.path];
  report("2", PCM, "sdm");
  seen.push(playback.value.path);
  report("0", PCM, "sdm");
  seen.push(playback.value.path);
  assert.deepEqual(seen, ["pcm-sdm", "pcm-pcm", "idle"]);
});

// Break: direct playback follows staged or dragged edits instead of the running store.
test("test_direct_path_uses_the_running_reading", () => {
  report("2", DSD, "sdm");
  engineStatus.value = { status: { state: "2", active_rate: DSD }, metadata: { samplerate: "2822400" } };
  readings.value = body({
    direct_sdm: reading({
      engine: { value: false, name: "fixture", generation: GEN },
      staged: true,
    }),
  });
  holdDrag("direct_sdm", true);
  const seen = [playback.value.path];
  readings.value = body({
    direct_sdm: reading({
      engine: { value: true, name: "fixture", generation: GEN },
      staged: null,
    }),
  });
  seen.push(playback.value.path);
  assert.deepEqual(seen, ["sdm-sdm", "direct"]);
});

// Break: field allocates another computed for an existing key or shares one across keys.
test("test_field_reuses_only_the_same_keys_computed", () => {
  const first = field(KEY);
  const other = field(OTHER);
  assert.deepEqual([field(KEY) === first, field(OTHER) === other, first === other], [true, true, false]);
});

// Break: source rate stays a string, uses output rate, or retains a vanished source.
test("test_source_rate_tracks_numeric_metadata_and_absence", () => {
  report("2", DSD, "pcm");
  const seen = [playback.value.srcRate];
  engineStatus.value = { status: { state: "2", active_rate: DSD }, metadata: { samplerate: "96000" } };
  seen.push(playback.value.srcRate);
  engineStatus.value = { status: { state: "2", active_rate: DSD }, metadata: null };
  seen.push(playback.value.srcRate);
  assert.deepEqual(seen, [44100, 96000, null]);
});

// Break: output rate stays a string, uses source rate, or retains a vanished output.
test("test_output_rate_tracks_numeric_status_and_absence", () => {
  report("2", DSD, "pcm");
  const seen = [playback.value.outRate];
  report("2", PCM, "pcm");
  seen.push(playback.value.outRate);
  engineStatus.value = { status: { state: "0" }, metadata: { samplerate: CD } };
  seen.push(playback.value.outRate);
  assert.deepEqual(seen, [11289600, 352800, null]);
});
