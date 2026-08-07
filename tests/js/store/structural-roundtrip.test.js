// Behavioral suite for the staging round trip: an edit that comes back to its
// baseline must stop being staged ON THE SERVER, not merely read clean in the
// UI count. A value left in the server's pending buffer rides along on the next
// unrelated Apply and restarts the daemon for a change nobody made.
//
// The governing invariant, asserted at the wire: after any staging call
// settles, the server's buffer holds no entry that reads clean against its
// baseline. Stage requests may carry `drop` —
// `{live: {liveKey: [argName, …]}, http: [fieldName, …]}` — and the server
// removes those entries; `stagingWire` in ../support/wire.js honours it the way
// the backend does.
//
// The wire is faked, never the store (docs/testing.md rule 4): `stagingWire`
// holds the pending buffer and answers the real REST paths, so `edit`,
// `stagePipelines`, `previewPreset` and `discardAll` all ride them. Assertions
// are on the buffer the server ended up with (`W.staged`) and on the request
// bodies it was handed (`W.stages`) — never on a store internal.
//
// Schema facts leaned on, as documented in store.test.js: `volume_max` is a
// plain http field, `quick_pause` is a checkbox whose config baseline is a bool
// while staging speaks "1"/"0", and `matrix_pipelines` is the whole row set
// staged as one canonical-JSON http field.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test \
//        tests/js/store/structural-roundtrip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { edit, stagePipelines, discardAll, previewPreset } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire, quiesce } from "../support/wire.js";

/**
 * One /config form field, as `field()` below builds it. `value` is a union
 * because the form answers a checkbox with a real bool and everything else
 * with a string.
 *
 * @typedef {{ name: string, value: string | boolean }} FormField
 */

/**
 * One matrix pipeline row: exactly five keys, every value a string.
 *
 * @typedef {{
 *   gain: string,
 *   gainunit: string,
 *   mixdown: string,
 *   process: string,
 *   source: string,
 * }} PipelineRow
 */

/**
 * The staging server `stagingWire` hands back, read through its return type
 * rather than a re-declared shape — the fake in ../support/wire.js is frozen
 * and owns this contract.
 *
 * @typedef {ReturnType<typeof stagingWire>} StagingWire
 */

/**
 * @param {string} name
 * @param {string | boolean} value
 * @returns {FormField}
 */
const field = (name, value) => ({ name, value });

// A pipeline row carries exactly five keys; `gainunit` defaults to dB.
/**
 * @param {Partial<PipelineRow>} [patch]
 * @returns {PipelineRow}
 */
const ROW = (patch) => ({ gain: "0", gainunit: "dB", mixdown: "0", process: "", source: "0", ...patch });

// Full reset of every source signal these read models touch — module-level
// signals outlive a test file — plus the staging server and an empty buffer.
/**
 * @param {{
 *   fields?: FormField[],
 *   file?: Record<string, string>,
 *   rows?: PipelineRow[],
 *   engine?: Record<string, string>,
 *   routes?: (path: string, opts: { method?: string, body?: string }, w: StagingWire) => ReturnType<typeof ok> | undefined,
 * }} [trees]
 * @returns {Promise<StagingWire>}
 */
async function trees({ fields = [], file = {}, rows = [], engine = {}, routes } = {}) {
  engineState.value = engine;
  config.value = { fields, file, active: "" };
  matrixConfig.value = { fields: [], rows, active: "[Default]" };
  const W = stagingWire({
    routes: (path, opts, w) => {
      if (path === "/api/config") return ok({ data: config.value });
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return routes ? routes(path, opts, w) : undefined;
    },
  });
  await discardAll();
  return W;
}

/**
 * @param {StagingWire} W
 * @param {string} name
 * @returns {boolean}
 */
const staged = (W, name) => Object.hasOwn(W.staged.http, name);

// --- an edit that returns to its baseline ------------------------------------

test("test_an_edit_returned_to_its_baseline_leaves_nothing_in_the_server_buffer", async () => {
  const W = await trees({ fields: [field("volume_max", "-3")] });
  await edit("volume_max", "-6");
  await edit("volume_max", "-3");
  await quiesce(W);
  assert.equal(staged(W, "volume_max"), false);
});

test("test_returning_an_edit_to_its_baseline_asks_the_server_to_drop_that_field", async () => {
  const W = await trees({ fields: [field("volume_max", "-3")] });
  await edit("volume_max", "-6");
  await edit("volume_max", "-3");
  await quiesce(W);
  assert.equal(((W.stages[1].drop || {}).http || []).includes("volume_max"), true);
});

test("test_pipelines_staged_back_to_their_baseline_rows_leave_nothing_in_the_server_buffer", async () => {
  const W = await trees({ rows: [ROW({ gain: "-6" })] });
  await stagePipelines([ROW({ gain: "-3" })]);
  await stagePipelines([ROW({ gain: "-6" })]);
  await quiesce(W);
  assert.equal(staged(W, "matrix_pipelines"), false);
});

// --- what must NOT be dropped -------------------------------------------------

test("test_an_edit_that_still_differs_from_its_baseline_stays_in_the_server_buffer", async () => {
  const W = await trees({ fields: [field("volume_max", "-3")] });
  await edit("volume_max", "-6");
  await quiesce(W);
  assert.equal(W.staged.http.volume_max, "-6");
});

// The buffer is swept whole, not just the field the user happened to touch: a
// field that went clean because the DAEMON moved under it is just as stale.
test("test_editing_one_field_clears_an_unrelated_field_that_has_gone_clean", async () => {
  const W = await trees({ fields: [field("volume_max", "-3"), field("quick_pause", true)] });
  await edit("volume_max", "-6");
  config.value = { fields: [field("volume_max", "-6"), field("quick_pause", true)], file: {}, active: "" };
  await edit("quick_pause", "0");
  await quiesce(W);
  assert.equal(staged(W, "volume_max"), false);
});

// An entry the schema does not know has no baseline to compare against, so it
// cannot be judged clean — it is left alone even while its neighbours go.
test("test_a_staged_field_the_schema_does_not_know_is_never_dropped", async () => {
  const W = await trees({ fields: [field("volume_max", "-3")] });
  W.staged = { live: {}, http: { no_such_control: "zzz" } };
  await edit("volume_max", "-6");
  await edit("volume_max", "-3");
  await quiesce(W);
  assert.equal(W.staged.http.no_such_control, "zzz");
});

// Under a preview the PRESET's value is the baseline, so an edit back to what
// the daemon is running right now is a real override and has to survive.
test("test_under_a_preview_an_edit_matching_the_running_config_is_not_dropped", async () => {
  const W = await trees({
    fields: [field("volume_max", "-3")],
    routes: (/** @type {string} */ path) =>
      path === "/api/preset/Night" ? ok({ name: "Night", config: { volume_max: "-9" } }) : undefined,
  });
  await previewPreset("Night");
  await edit("volume_max", "-3");
  await quiesce(W);
  assert.equal(W.staged.http.volume_max, "-3");
});

// The compare happens in the control's own domain: the form baseline is a bool
// and the staged value is "1", which is the same state written two ways.
test("test_a_checkbox_toggled_off_and_back_on_leaves_nothing_in_the_server_buffer", async () => {
  const W = await trees({ fields: [field("quick_pause", true)] });
  await edit("quick_pause", "0");
  await edit("quick_pause", "1");
  await quiesce(W);
  assert.equal(staged(W, "quick_pause"), false);
});

// --- the live lane ------------------------------------------------------------
//
// A live setting stages into its own bucket — `{live: {liveKey: {argName:
// "value"}}}`, the argument named "value" unless the schema names another — and
// its baseline is the running engine's state, not the config form. Its removal
// rides `drop.live`, keyed the same way, so a client that only ever builds
// `drop.http` leaves live settings rotting in the buffer.
//
// The live key is read back off the FIRST request rather than written in here:
// the schema owns that name, and a test that hardcodes it would be asserting on
// the schema instead of on the round trip.
/** @param {{ live?: Record<string, unknown> }} request */
const liveKeyOf = (request) => Object.keys(request.live || {})[0];

test("test_a_live_setting_returned_to_its_baseline_leaves_nothing_in_the_server_buffer", async () => {
  const W = await trees({ engine: { adaptive: "1" } });
  await edit("adaptive_volume", "0");
  await edit("adaptive_volume", "1");
  await quiesce(W);
  assert.equal(Object.keys(W.staged.live).length, 0);
});

test("test_returning_a_live_setting_to_its_baseline_asks_the_server_to_drop_that_argument", async () => {
  const W = await trees({ engine: { adaptive: "1" } });
  await edit("adaptive_volume", "0");
  await edit("adaptive_volume", "1");
  await quiesce(W);
  const dropped = ((W.stages[1].drop || {}).live || {})[liveKeyOf(W.stages[0])] || [];
  assert.equal(dropped.includes("value"), true);
});
