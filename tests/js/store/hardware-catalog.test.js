// Behavioral suite for the Hardware acceleration drawer's three engine settings, `multicore`, `ecores` and `cuda`, as
// entries of the engine control catalog (store/schema.js over store/schema/): each entry carries a lane of its own,
// `hardware`, and the catalog's value for it reads the hardware settings' own form, the drawer's draft over the
// engine's reported attributes (store/faceplate/settings/hardware.js).
//
// The value domain of each setting is the catalog's to choose, so the value cases assert a relation between two
// readings (the engine reporting one attribute value against another, the draft edited against not) rather than a
// literal.
//
// The wire is the seam: `GET /api/engine` answers the engine table a case hands the fake, and the form is loaded from
// it through `loadHardware` after a `discardHardware` on every case. Every source signal the catalog reads is
// reassigned, since module-level signals outlive a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/hardware-catalog.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, engineState, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { effective } from "../../../hqptuner/static/store/resolve.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import {
  discardHardware,
  loadHardware,
  setAllStations,
  setHardware,
} from "../../../hqptuner/static/store/faceplate/settings/hardware.js";
import { ok, stagingWire } from "../support/wire/wire.js";

/** @typedef {Record<string, string>} EngineTable  the engine attributes as `GET /api/engine` carries them */

/** The lane the owner names for the Hardware drawer's engine settings. */
const HARDWARE_LANE = "hardware";

//: The engine as the daemon reports it, every attribute off the daemon's default.
const ENGINE = { cuda: "convolution", multicore: "0", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

/** @typedef {import("../../../hqptuner/static/store/faceplate/settings/hardware.js").HardwareKey} HardwareKey */

/**
 * Each catalog id with a second value of its engine attribute, different from the one ENGINE reports.
 *
 * @type {{ id: HardwareKey, other: string }[]}
 */
const SETTINGS = [
  { id: "multicore", other: "1" },
  { id: "ecores", other: "filter" },
  { id: "cuda", other: "1" },
];

/**
 * Reset every source signal the catalog reads and load the engine a fake daemon reports.
 *
 * @param {EngineTable} [engine]
 */
async function reset(engine = ENGINE) {
  stagingWire({ routes: (path) => (path === "/api/engine" ? ok({ engine }) : undefined) });
  engineState.value = {};
  config.value = { fields: [{ name: "direct_sdm", value: false }], file: {}, active: "" };
  matrixConfig.value = { fields: [], active: "[Default]" };
  await discardAll();
  discardHardware();
  setAllStations(false);
  await loadHardware();
}

for (const { id } of SETTINGS) {
  test(`test_the_catalog_gives_${id}_the_hardware_lane`, () => {
    const entry = /** @type {Record<string, { lane?: unknown } | undefined>} */ (schema)[id];
    assert.equal(entry?.lane, HARDWARE_LANE);
  });
}

for (const { id, other } of SETTINGS) {
  test(`test_the_catalog_value_of_${id}_follows_the_engines_reported_attribute`, async () => {
    await reset();
    const reported = effective(id);
    await reset({ ...ENGINE, [id]: other });
    assert.notDeepEqual(effective(id), reported);
  });
}

for (const { id, other } of SETTINGS) {
  test(`test_the_catalog_value_of_${id}_follows_the_hardware_draft_over_the_engine`, async () => {
    await reset();
    const reported = effective(id);
    setHardware(id, other);
    assert.notDeepEqual(effective(id), reported);
  });
}
