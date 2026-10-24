import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { config, matrixConfig, enums } from "../../../../hqptuner/static/store/signals.js";
import { readings } from "../../../../hqptuner/static/store/core/readings.js";
import { inFlight, failures } from "../../../../hqptuner/static/store/core/ops.js";
import { switchProfile, profileChoices } from "../../../../hqptuner/static/store/faceplate/page/profile.js";
import { saveProfile, meta } from "../../../../hqptuner/static/store/faceplate/builders/profile.js";
import { cur, staged, ask, refused } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { matrixActiveProfile, isLiveProfile } from "../../../../hqptuner/static/store/matrix/profiles.js";
import { stagingWire, ok, bad, quiesce } from "../../support/wire/wire.js";

const FIRST = "fixture-nearfield";
const SECOND = "fixture-sofa";
const OLD = "fixture-obsolete-form";
const REFUSAL = "fixture-profile-refusal";
const REAL_FETCH = globalThis.fetch;
/** @type {ReturnType<typeof stagingWire>} */
let wire;
/** @type {Promise<import("../../support/wire/wire.js").FakeResponse> | null} */
let answer = null;
let reached = hold();

/** @returns {{ promise: Promise<void>, resolve: () => void }} */
function hold() {
  let resolve = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

/** @param {string} name */
function serve(name) {
  readings.value = {
    generation: 0,
    fields: {
      active_preset: { value: FIRST, readonly: true },
      matrix_profile: {
        engine: { value: name, name, generation: 0 },
        file: { value: OLD, generation: 0 },
        staged: null,
        lane: "matrix",
        show: "engine",
        restarts: false,
        diverges: true,
        bounds: null,
      },
    },
  };
}

beforeEach(() => {
  config.value = { fields: [], file: {}, active: FIRST, profiles: { options: [{ value: FIRST }] } };
  matrixConfig.value = {
    fields: [],
    rows: [],
    file_profiles: {},
    preset_profiles: { [FIRST]: [] },
    live_profiles: [FIRST, SECOND],
    live_active: OLD,
    active: OLD,
  };
  enums.value = { matrix_profiles: [FIRST, SECOND] };
  serve(FIRST);
  answer = null;
  reached = hold();
  cur.value = { st: FIRST, name: SECOND };
  staged.value = new Map();
  ask.value = null;
  refused.value = false;
  meta.value = { name: SECOND, stations: [FIRST], desc: "", listen: "speakers" };
  wire = stagingWire({
    routes: (path) => {
      if (path === "/api/matrix/profile") {
        reached.resolve();
        return answer ?? ok({ ok: true });
      }
      if (path === "/api/descriptions") return ok({ profiles: {} });
      if (path === "/api/config") return ok(readings.value);
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: enums.value });
      return undefined;
    },
  });
});

afterEach(async () => {
  await quiesce(wire);
  globalThis.fetch = REAL_FETCH;
});

// Break: the active profile still reads the matrix form's stale name.
test("test_active_profile_follows_replacement_served_readings", () => {
  const seen = [matrixActiveProfile.value];
  serve(SECOND);
  seen.push(matrixActiveProfile.value);
  assert.deepEqual(seen, [FIRST, SECOND]);
});

// Break: live-switch eligibility follows a stale matrix form list.
test("test_live_profile_eligibility_follows_replacement_enumerations", () => {
  enums.value = { matrix_profiles: [FIRST] };
  const seen = [isLiveProfile(FIRST), isLiveProfile(SECOND)];
  enums.value = { matrix_profiles: [SECOND] };
  seen.push(isLiveProfile(FIRST), isLiveProfile(SECOND));
  assert.deepEqual(seen, [true, false, false, true]);
});

// Break: a profile switch has local busy state but never marks the engine in flight.
test("test_page_switch_marks_engine_in_flight_until_it_settles", async () => {
  const held = hold();
  answer = held.promise.then(() => ok({ ok: true }));
  const seen = [inFlight.value];
  const pending = switchProfile(SECOND);
  seen.push(inFlight.value);
  held.resolve();
  await pending;
  seen.push(inFlight.value);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: a profile refusal stays local or survives a successful retry on the live line.
test("test_page_switch_refusal_reaches_live_line_and_retry_clears_it", async () => {
  answer = Promise.resolve(bad(502, REFUSAL));
  await switchProfile(SECOND);
  const seen = [failures.value.filter((entry) => entry.area === "live").map((entry) => entry.area)];
  answer = null;
  await switchProfile(FIRST);
  seen.push(failures.value.filter((entry) => entry.area === "live").map((entry) => entry.area));
  assert.deepEqual(seen, [["live"], []]);
});

// Break: the builder's live switch does not share the page picker's busy state.
test("test_builder_live_switch_marks_the_page_picker_busy", async () => {
  const held = hold();
  answer = held.promise.then(() => ok({ ok: true }));
  const seen = [profileChoices().busy];
  const pending = saveProfile();
  await reached.promise;
  seen.push(profileChoices().busy);
  held.resolve();
  await pending;
  seen.push(profileChoices().busy);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: a builder switch refusal bypasses the shared live failure area.
test("test_builder_switch_refusal_reaches_live_line_and_page_retry_clears_it", async () => {
  answer = Promise.resolve(bad(502, REFUSAL));
  await Promise.allSettled([saveProfile()]);
  const seen = [failures.value.filter((entry) => entry.area === "live").map((entry) => entry.area)];
  answer = null;
  await switchProfile(FIRST);
  seen.push(failures.value.filter((entry) => entry.area === "live").map((entry) => entry.area));
  assert.deepEqual(seen, [["live"], []]);
});
