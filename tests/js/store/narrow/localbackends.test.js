// Behavioral suite for the narrowing a Windows daemon's local backends take part
// in. ASIO and WASAPI carry the same per-backend settings ALSA does, under their
// own field names, so each question the store asks of "the active backend" has
// to reach that backend's own field: its device (store/narrow/devicecaps.js),
// its DoP switch (same module) and its DSD rate-family flag
// (store/narrow/match.js).
//
// Every case seeds the /api/config payload whole, through the exported `config`
// signal over a staging wire, and clears the pending buffer first (the shared
// harness's own order, tests/js/support/devicecaps-harness.js).

import test from "node:test";
import assert from "node:assert/strict";

import { config } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { schema } from "../../../../hqptuner/static/store/schema.js";
import { grayRatesByDevice } from "../../../../hqptuner/static/store/narrow/devicecaps.js";
import { dsd44kOnly } from "../../../../hqptuner/static/store/narrow/match.js";
import { stagingWire } from "../../support/wire/wire.js";
import {
  caps,
  tick,
  DSD64,
  DSD128,
  NET_DEVICE,
  PCM_8X,
  PCM_OPTIONS,
  PCM_TO_192,
} from "../../support/devicecaps-harness.js";

/** @typedef {import("../../support/devicecaps-harness.js").MenuOption} MenuOption */

const SDM_OPTIONS = /** @type {MenuOption[]} */ (schema.sdm_rate.options);
const LOCAL = ["asio", "wasapi"];
// A device name no other field in a fixture carries.
const DEVICE = "Studio interface";

/**
 * @param {Record<string, string | boolean>} fields
 * @param {ReturnType<typeof caps> | null} [deviceCaps]
 */
async function seed(fields, deviceCaps = null) {
  stagingWire();
  config.value = { fields: [], file: {}, active: "", profiles: null, device_caps: null };
  await discardAll();
  config.value = {
    fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
    file: {},
    active: "",
    profiles: null,
    device_caps: deviceCaps,
  };
  await tick();
}

// Whether the menu grays the tier, strictly: an option no pass marked carries
// no `disabled` at all.
/**
 * @param {MenuOption[]} options
 * @param {string} tier
 */
const grayed = (options, tier) => options.find((o) => o.value === tier)?.disabled === true;

for (const backend of LOCAL) {
  test(`test_the_${backend}_backend_matches_the_capability_against_its_own_device`, async () => {
    await seed({ backend, [`${backend}_device`]: DEVICE, net_device: NET_DEVICE }, caps(DEVICE, PCM_TO_192, []));
    assert.equal(grayed(grayRatesByDevice(PCM_OPTIONS, "pcm"), PCM_8X), true);
  });

  // DSD64 rides a 176.4 kHz carrier the device announced; DSD128 needs 352.8,
  // which it did not. Only a store reading this backend's own DoP switch tells
  // the two apart.
  test(`test_the_${backend}_backend_answers_the_dop_question_with_its_own_switch`, async () => {
    await seed(
      { backend, [`${backend}_device`]: DEVICE, [`${backend}_dop`]: true, net_dop: false },
      caps(DEVICE, PCM_TO_192, []),
    );
    const out = grayRatesByDevice(SDM_OPTIONS, "sdm");
    assert.deepEqual([grayed(out, DSD64), grayed(out, DSD128)], [false, true]);
  });

  test(`test_the_${backend}_backend_is_44_1k_only_when_its_own_dsd_rates_flag_is_off`, async () => {
    await seed({ mode: "sdm", backend, [`${backend}_anydsd`]: "0", net_anydsd: "1" });
    assert.equal(dsd44kOnly.value, true);
  });
}
