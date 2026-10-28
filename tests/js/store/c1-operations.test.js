import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { failures, op } from "../../../hqptuner/static/store/core/ops.js";
import { faceplateAlerts } from "../../../hqptuner/static/store/faceplate/alerts.js";
import { config, engineState, enums, lastApply } from "../../../hqptuner/static/store/signals.js";
import { unreadWire, CONFIG, STATE, ENUMS } from "../support/wire/unreadwire.js";
import { fail, succeed } from "../support/unreadareas.js";

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const originalFetch = env.fetch;
/** @type {import("../support/wire/wire.js").StagingWire} */
let wire;
const applyArea = op("fixture-c1-apply", { alert: "apply" });
const liveArea = op("fixture-c1-live", { alert: "live" });

beforeEach(async () => {
  wire = unreadWire();
  config.value = CONFIG();
  engineState.value = STATE();
  enums.value = ENUMS();
  lastApply.value = null;
  applyArea.clear();
  liveArea.clear();
  await succeed(wire, "apply");
  await succeed(wire, "live");
});

afterEach(() => {
  applyArea.clear();
  liveArea.clear();
  env.fetch = originalFetch;
});

for (const [area, failure] of [
  ["apply", "a_failed_apply"],
  ["live", "a_live_write_hqplayer_refused"],
  ["live", "a_live_write_that_threw"],
]) {
  // Break: a failed write records only a private error, hiding it from shared consumers.
  test(`test_${failure}_joins_shared_failures`, async () => {
    await fail(wire, failure);
    assert.deepEqual(
      failures.value.map((entry) => entry.area),
      [area],
    );
  });
}

for (const area of /** @type {const} */ (["apply", "live"])) {
  // Break: successful writes leave a failure from another operation in the same area.
  test(`test_${area}_success_clears_its_shared_area`, async () => {
    const item = area === "apply" ? applyArea : liveArea;
    const error = new Error(`fixture ${area} failure`);
    await item.run(async () => {
      throw error;
    });
    const seen = [failures.value.map((entry) => entry.error)];
    await succeed(wire, area);
    seen.push(failures.value.map((entry) => entry.error));
    assert.deepEqual(seen, [[error], []]);
  });

  // Break: the alert consumer ignores failures raised by other shared operations.
  test(`test_shared_${area}_failure_reaches_the_faceplate`, async () => {
    const item = area === "apply" ? applyArea : liveArea;
    const base = faceplateAlerts().length;
    await item.run(async () => {
      throw new Error(`fixture ${area} alert`);
    });
    const failed = faceplateAlerts().length - base;
    item.clear();
    assert.deepEqual([failed, faceplateAlerts().length - base], [1, 0]);
  });
}
