// Behavioral suite for the staging round trip: an edit that still differs from its
// baseline stays in the server's pending buffer, and an entry the schema does not
// know is never dropped. The stored buffer keeps an entry that has gone clean;
// only the `staged` reading the server serves reconciles it.
//
// `stagingWire` in ../support/wire/wire.js holds the pending buffer and answers
// the real REST paths, so `edit`, `previewPreset` and `discardAll` all ride them.
// Assertions are on the buffer the server ended up with (`W.staged`).
//
// Schema fact leaned on, as documented in resolve.test.js: `volume_max` is a
// plain http field.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test \
//        tests/js/store/structural-roundtrip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { edit, discardAll, previewPreset } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire, quiesce } from "../support/wire/wire.js";
import { fieldReading, seedReadings } from "../support/readings.js";
import { readings } from "../../../hqptuner/static/store/core/readings.js";

/**
 * One /config form field, as `field()` below builds it. `value` is a union
 * because the form answers a checkbox with a real bool and everything else
 * with a string.
 *
 * @typedef {{ name: string, value: string | boolean }} FormField
 */

/**
 * The staging server `stagingWire` hands back, read through its return type
 * rather than a re-declared shape — the fake in ../support/wire/wire.js is frozen
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

// Full reset of every source signal these read models touch — module-level
// signals outlive a test file — plus the staging server and an empty buffer.
/**
 * @param {{
 *   fields?: FormField[],
 *   file?: Record<string, string>,
 *   engine?: Record<string, string>,
 *   routes?: (path: string, opts: { method?: string, body?: string }, w: StagingWire) => ReturnType<typeof ok> | undefined,
 * }} [trees]
 * @returns {Promise<StagingWire>}
 */
async function trees({ fields = [], file = {}, engine = {}, routes } = {}) {
  engineState.value = engine;
  config.value = { fields: fields.map(({ name }) => ({ name })) };
  matrixConfig.value = { fields: [] };
  seedReadings({
    ...Object.fromEntries(fields.map(({ name, value }) => [name, value])),
    ...Object.fromEntries(Object.entries(file).map(([name, value]) => [name, fieldReading(value, { show: "file" })])),
  });
  const W = stagingWire({
    routes: (path, opts, w) => {
      if (path === "/api/config") return ok(readings.value);
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return routes ? routes(path, opts, w) : undefined;
    },
  });
  await discardAll();
  return W;
}

// --- what must NOT be dropped -------------------------------------------------

test("test_an_edit_that_still_differs_from_its_baseline_stays_in_the_server_buffer", async () => {
  const W = await trees({ fields: [field("volume_max", "-3")] });
  await edit("volume_max", "-6");
  await quiesce(W);
  assert.equal(W.staged.http.volume_max, "-6");
});

// An entry the schema does not know has no baseline to compare against, so it
// cannot be judged clean — it is left alone even while its neighbors go.
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
