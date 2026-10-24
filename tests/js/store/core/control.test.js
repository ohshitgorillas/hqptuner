import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { control, drawerSession } from "../../../../hqptuner/static/store/faceplate/drawer/control.js";
import { readings, dropDrag } from "../../../../hqptuner/static/store/core/readings.js";
import { health, config } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { ok, bad, stagingWire, quiesce } from "../../support/wire/wire.js";
import { fakeClock } from "../../support/clock.js";

const KEY = "volume_max";
const GEN = 81;
const ENGINE = -3;
const FILE = -9;
const HELD = -6;
const BOUNDS = { min: -60, max: 0, step: 0.5 };
const NEXT_BOUNDS = { min: -48, max: -2, step: 1 };
/** @typedef {import("../../../../hqptuner/static/model/store/reading.js").FieldReading} FieldReading */

/** @param {Partial<FieldReading>} [over] */
function serve(over = {}) {
  readings.value = {
    generation: GEN,
    fields: {
      [KEY]: {
        engine: { value: ENGINE, name: "fixture", generation: GEN },
        file: { value: FILE, generation: GEN },
        staged: null,
        lane: "form",
        show: "file",
        restarts: true,
        diverges: true,
        bounds: BOUNDS,
        ...over,
      },
    },
  };
}

/** @type {ReturnType<typeof stagingWire>} */
let wire;
beforeEach(async () => {
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? ok(readings.value) : undefined) });
  dropDrag(KEY);
  serve();
  health.value = { phase: "Ready", generation: GEN };
  config.value = { fields: [{ name: KEY, type: "number", value: FILE }], file: {} };
  await discardAll();
  await quiesce(wire);
});
afterEach(async () => {
  dropDrag(KEY);
  health.value = null;
  config.value = null;
  await quiesce(wire);
});

// Break: a binding keeps its first reading or chooses Engine over the named File.
test("test_control_value_follows_the_served_display_store", () => {
  const item = control(KEY, {});
  const seen = [item.value];
  serve({ show: "engine" });
  seen.push(item.value);
  assert.deepEqual(seen, [FILE, ENGINE]);
});

// Break: the dirty mark ignores served staging or stays lit after reconciliation.
test("test_control_dirty_follows_served_staging", () => {
  const item = control(KEY, {});
  const seen = [item.dirty];
  serve({ staged: HELD });
  seen.push(item.dirty);
  serve();
  seen.push(item.dirty);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: the restart mark is inferred locally or only appears after an edit.
test("test_restart_mark_follows_the_server_before_an_edit", () => {
  const item = control(KEY, {});
  const seen = [item.restart];
  serve({ restarts: false });
  seen.push(item.restart);
  assert.deepEqual(seen, [true, false]);
});

// Break: a control substitutes local limits or retains outdated daemon bounds.
test("test_bounds_follow_each_served_range", () => {
  const item = control(KEY, {});
  const seen = [item.bounds];
  serve({ bounds: NEXT_BOUNDS });
  seen.push(item.bounds);
  assert.deepEqual(seen, [BOUNDS, NEXT_BOUNDS]);
});

// Break: an older generation blanks a control instead of retaining its reading.
test("test_generation_change_keeps_last_known_control_value", async () => {
  const item = control(KEY, {});
  health.value = { phase: "Ready", generation: GEN + 1 };
  const seen = [item.value];
  await quiesce(wire);
  serve({ file: { value: HELD, generation: GEN + 1 } });
  seen.push(item.value);
  assert.deepEqual(seen, [FILE, HELD]);
});

// Break: dragging fails to hold the pointer value over a subsequent server frame.
test("test_stage_drag_holds_over_a_replacement_reading", () => {
  const item = control(KEY, { drag: "stage" });
  item.move(HELD);
  const seen = [item.value];
  serve({ file: { value: ENGINE, generation: GEN } });
  seen.push(item.value);
  assert.deepEqual(seen, [HELD, HELD]);
});

// Break: resetting the opening leaves a drag overriding the latest field.
test("test_session_reset_releases_its_control_drag", () => {
  const session = drawerSession("volume");
  const item = control(KEY, { session });
  item.move(HELD);
  const seen = [item.value];
  session.reset();
  seen.push(item.value);
  assert.deepEqual(seen, [HELD, FILE]);
});

// Break: get recreates named state or overwrites it with a later initializer.
test("test_session_keeps_a_named_signal_until_reset", () => {
  const session = drawerSession("output");
  const first = session.get("family", "44100");
  if (first !== null) first.value = "48000";
  const again = session.get("family", "96000");
  assert.equal(again?.value, "48000");
});

// Break: reset mutates old state instead of starting a fresh opening signal.
test("test_session_reset_starts_fresh_named_state", () => {
  const session = drawerSession("output");
  session.get("family", "44100");
  session.reset();
  assert.equal(session.get("family", "96000")?.value, "96000");
});

// Break: picking an unchanged value posts, or a changed pick never stages.
test("test_pick_stages_only_a_changed_value", async () => {
  const item = control(KEY, {});
  await item.pick(FILE);
  await quiesce(wire);
  const seen = [wire.stages.length];
  await item.pick(HELD);
  await quiesce(wire);
  seen.push(wire.stages.length);
  assert.deepEqual(seen, [0, 1]);
});

/** @type {Array<["stage" | "stage-each", string[][]]>} */
const STAGING = [
  ["stage", [[], [String(HELD)]]],
  ["stage-each", [[String(ENGINE)], [String(ENGINE), String(HELD)]]],
];
for (const [mode, expected] of STAGING) {
  // Break: a mode stages at the wrong gesture boundary or loses the final value.
  test(`test_${mode}_writes_at_its_gesture_boundaries`, async () => {
    const item = control(KEY, { drag: mode });
    await item.move(ENGINE);
    await quiesce(wire);
    const seen = [wire.stages.map((body) => body.http?.[KEY])];
    await item.drop(HELD);
    await quiesce(wire);
    seen.push(wire.stages.map((body) => body.http?.[KEY]));
    assert.deepEqual(seen, expected);
  });
}

/** @param {boolean} [refuse] */
function liveWire(refuse = false) {
  wire = stagingWire({
    routes: (path, opts, w) => {
      if (opts.method === "POST") {
        w.posts.push({ path, body: JSON.parse(String(opts.body)) });
        return refuse ? bad(502, "fixture refusal") : ok({});
      }
      if (path === "/api/config") return ok(readings.value);
      return undefined;
    },
  });
  return wire;
}

// Break: preview writes while dragging or sends its release through staging.
test("test_preview_commits_live_on_release", async () => {
  const w = liveWire();
  const item = control(KEY, { drag: "preview" });
  await item.move(ENGINE);
  await quiesce(w);
  const seen = [w.posts.length];
  await item.drop(HELD);
  await quiesce(w);
  seen.push(w.posts.length);
  assert.deepEqual(seen, [0, 1]);
});

// Break: a live field is written on a staging or volume endpoint.
test("test_preview_posts_the_catalog_field_on_the_live_lane", async () => {
  const w = liveWire();
  const item = control(KEY, { drag: "preview" });
  await item.drop(HELD);
  await quiesce(w);
  assert.deepEqual(w.posts, [{ path: "/api/config/live", body: { fields: { [KEY]: String(HELD) } } }]);
});

for (const refuse of [false, true]) {
  // Break: a completed live write leaves a value held that no served store owns.
  test(`test_live_release_returns_to_readback_after_${refuse ? "failure" : "success"}`, async () => {
    const w = liveWire(refuse);
    const item = control(KEY, { drag: "preview" });
    item.move(HELD);
    const seen = [item.value];
    await item.drop(HELD);
    await quiesce(w);
    seen.push(item.value);
    assert.deepEqual(seen, [HELD, FILE]);
  });
}

// Break: every pointer movement writes immediately instead of observing the throttle.
test("test_throttle_coalesces_moves_and_writes_the_release", async () => {
  serve({ lane: "volume" });
  const w = liveWire();
  const clock = fakeClock();
  const item = control(KEY, { drag: "throttle", clock: clock.clock });
  item.move(ENGINE);
  await quiesce(w);
  item.move(HELD);
  await quiesce(w);
  const seen = [w.posts.length];
  clock.advance(100);
  await quiesce(w);
  seen.push(w.posts.length);
  await item.drop(FILE);
  await quiesce(w);
  seen.push(w.posts.length);
  assert.deepEqual(seen, [1, 2, 3]);
});

// Break: the dedicated volume lane is routed through config/live.
test("test_volume_lane_uses_the_immediate_volume_endpoint", async () => {
  serve({ lane: "volume" });
  const w = liveWire();
  const item = control(KEY, { drag: "throttle", clock: fakeClock().clock });
  await item.drop(HELD);
  await quiesce(w);
  assert.deepEqual(w.posts, [{ path: "/api/volume", body: { level: String(HELD) } }]);
});

// Break: disclosure follows the running flag instead of its staged override.
test("test_gray_follows_the_staged_fixed_volume_flag", () => {
  const item = control(KEY, {});
  const base = readings.value.fields[KEY];
  readings.value = {
    generation: GEN,
    fields: {
      [KEY]: base,
      fixed_volume_enabled: {
        ...base,
        engine: { value: false, generation: GEN },
        file: { value: false, generation: GEN },
        staged: true,
      },
    },
  };
  const seen = [Boolean(item.gray)];
  readings.value = {
    generation: GEN,
    fields: {
      [KEY]: base,
      fixed_volume_enabled: {
        ...base,
        engine: { value: true, generation: GEN },
        file: { value: true, generation: GEN },
        staged: false,
      },
    },
  };
  seen.push(Boolean(item.gray));
  assert.deepEqual(seen, [true, false]);
});

// Break: the release clears its hold after the POST but before the refetch lands.
test("test_live_hold_lasts_until_the_readback_lands", async () => {
  const reply = Promise.withResolvers();
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? reply.promise : ok({})) });
  const item = control(KEY, { drag: "preview" });
  const run = item.drop(HELD);
  await new Promise((resolve) => setImmediate(resolve));
  const seen = [item.value];
  reply.resolve(ok(readings.value));
  await run;
  await quiesce(wire);
  seen.push(item.value);
  assert.deepEqual(seen, [HELD, FILE]);
});

// Break: staging clears the thumb before a fresh reading can carry the edit.
test("test_stage_release_keeps_the_edit_until_fresh_reading", async () => {
  const reply = Promise.withResolvers();
  wire = stagingWire({ routes: (path) => (path === "/api/config" ? reply.promise : undefined) });
  const item = control(KEY, { drag: "stage" });
  item.move(HELD);
  const run = item.drop(HELD);
  await new Promise((resolve) => setImmediate(resolve));
  const seen = [Number(item.value)];
  const fresh = {
    ...readings.value,
    fields: { [KEY]: { ...readings.value.fields[KEY], staged: HELD } },
  };
  reply.resolve(ok(fresh));
  await run;
  await quiesce(wire);
  seen.push(Number(item.value));
  assert.deepEqual(seen, [HELD, HELD]);
});

// Break: a completed release clears a newly started drag that has not written yet.
test("test_earlier_release_preserves_a_new_unreleased_drag", async () => {
  const reply = Promise.withResolvers();
  wire = stagingWire({
    routes: (path, opts) => {
      if (opts.method === "POST") return reply.promise;
      return path === "/api/config" ? ok(readings.value) : undefined;
    },
  });
  const item = control(KEY, { drag: "preview" });
  const released = item.drop(ENGINE);
  item.move(HELD);
  const seen = [item.value];
  reply.resolve(ok({}));
  await released;
  await quiesce(wire);
  seen.push(item.value);
  assert.deepEqual(seen, [HELD, HELD]);
});

// Break: one binding's completed release clears another binding's newer drag.
test("test_release_preserves_a_new_drag_from_another_binding", async () => {
  const reply = Promise.withResolvers();
  wire = stagingWire({
    routes: (path, opts) => {
      if (opts.method === "POST") return reply.promise;
      return path === "/api/config" ? ok(readings.value) : undefined;
    },
  });
  const earlier = control(KEY, { drag: "preview" });
  const later = control(KEY, { drag: "preview" });
  const released = earlier.drop(ENGINE);
  later.move(HELD);
  const seen = [later.value];
  reply.resolve(ok({}));
  await released;
  await quiesce(wire);
  seen.push(later.value);
  assert.deepEqual(seen, [HELD, HELD]);
});

// Break: an older completed write releases the drag owned by a newer write.
test("test_stale_write_leaves_the_later_hold_in_place", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const replies = [first, second];
  wire = stagingWire({
    routes: (path, opts) => {
      if (opts.method === "POST") return replies.shift()?.promise;
      return path === "/api/config" ? ok(readings.value) : undefined;
    },
  });
  const item = control(KEY, { drag: "preview" });
  const older = item.drop(ENGINE);
  const newer = item.drop(HELD);
  first.resolve(ok({}));
  await older;
  const seen = [item.value];
  second.resolve(ok({}));
  await newer;
  await quiesce(wire);
  seen.push(item.value);
  assert.deepEqual(seen, [HELD, FILE]);
});
