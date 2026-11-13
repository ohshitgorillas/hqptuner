// Behavioral suite for the modulator list's rate gate (hqptuner/static/store/faceplate/lists/options.js): a modulator
// whose rate floor is above the SDM output rate in force is marked disabled and stays listed; a floor at or below that
// rate, or none, is not marked. The rate in force is the SDM pin when one stands, else the SDM rate limit the engine
// runs while the chain that runs is SDM; a staged limit, the output mode setting and the PCM chain play no part.
//
// The wire is the seam (tests/js/support/listsfixture.js): the loaded SDM chain's <GetShapers/> enumeration widened to
// three tiered modulators and one with no floor, the rate limit served as the `defaults_bitrate` reading, and a pin as
// the State rate index. Every name asserted is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-lists/rate-floor.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { narrowedOptions } from "../../../../hqptuner/static/store/faceplate/lists/options.js";
import { engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { favoritesWire } from "../../support/wire/favoriteswire.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";
import { fieldReading } from "../../support/readings.js";

const MOD_256 = "DSD7 256+fs";
const MOD_512 = "ASDM7EC 512+fs";
const MOD_1024 = "ASDM7EC 1024+fs";
const MOD_NO_FLOOR = "ASDM5";

const DSD256 = "12288000";
const DSD512 = "24576000";
const DSD1024 = "49152000";

/** The modulators with the rate floor each one's overlay records; the last records none. */
const TIERED = [
  { name: MOD_256, min_rate_hz: 10240000 },
  { name: MOD_512, min_rate_hz: 20480000 },
  { name: MOD_1024, min_rate_hz: 40960000 },
  { name: MOD_NO_FLOOR },
];

/** Replace the loaded SDM chain's modulators with the tiered ones, overlays and all. */
function serveTieredModulators() {
  enums.value = {
    ...enums.value,
    shapers: TIERED.map((m, i) => ({ index: String(i), value: String(10 + i), name: m.name })),
  };
  const meta = metadata.value;
  metadata.value = {
    ...meta,
    shapers: {
      ...meta.shapers,
      sdm_modulators: Object.fromEntries(TIERED.map((m) => [m.name, { min_rate_hz: m.min_rate_hz, generation: 4 }])),
    },
  };
}

/**
 * The chain engine with the tiered modulators served.
 *
 * @param {Parameters<typeof loadLists>[0]} [o]
 */
async function serve(o) {
  await loadLists(o);
  serveTieredModulators();
}

/** The option of the modulator list under an engine name. @param {string} name */
const option = (name) => {
  const hit = narrowedOptions("sdm_modulator", "1x").find((o) => o.v === name);
  if (!hit) throw new Error(`the modulator list offers no ${name} row`);
  return hit;
};

/** Whether the list marks an option disabled. @param {string} name */
const grayed = (name) => option(name).disabled === true;

beforeEach(() => {
  favoritesWire();
  resetLists();
});

afterEach(async () => {
  await flushNarrowing();
});

test("test_a_modulator_whose_floor_is_above_the_rate_limit_is_grayed", async () => {
  await serve({ readings: { defaults_bitrate: DSD256 } });
  assert.equal(grayed(MOD_512), true);
});

test("test_a_grayed_modulator_stays_in_the_list", async () => {
  await serve({ readings: { defaults_bitrate: DSD256 } });
  assert.equal(
    narrowedOptions("sdm_modulator", "1x").some((o) => o.v === MOD_1024),
    true,
  );
});

test("test_a_modulator_whose_floor_is_below_the_rate_limit_is_not_grayed", async () => {
  await serve({ readings: { defaults_bitrate: DSD256 } });
  assert.equal(grayed(MOD_256), false);
});

test("test_a_modulator_whose_floor_equals_the_rate_in_force_is_not_grayed", async () => {
  await serve({ readings: { defaults_bitrate: "20480000" } });
  assert.equal(grayed(MOD_512), false);
});

test("test_a_modulator_with_no_floor_is_not_grayed", async () => {
  await serve({ readings: { defaults_bitrate: DSD256 } });
  assert.equal(grayed(MOD_NO_FLOOR), false);
});

test("test_a_grayed_modulator_carries_no_reason", async () => {
  await serve({ readings: { defaults_bitrate: DSD256 } });
  assert.equal("reason" in option(MOD_512), false);
});

test("test_an_sdm_pin_below_the_floor_grays_a_modulator_the_limit_would_allow", async () => {
  await serve({ readings: { defaults_bitrate: DSD1024 }, pin: Number(DSD256) });
  assert.equal(grayed(MOD_512), true);
});

test("test_an_sdm_pin_at_the_floor_ungrays_a_modulator_the_limit_would_gray", async () => {
  await serve({ readings: { defaults_bitrate: DSD256 }, pin: Number(DSD512) });
  assert.equal(grayed(MOD_512), false);
});

test("test_no_rate_in_force_grays_nothing", async () => {
  await serve();
  assert.equal(grayed(MOD_1024), false);
});

test("test_a_zero_rate_limit_grays_nothing", async () => {
  await serve({ readings: { defaults_bitrate: "0" } });
  assert.equal(grayed(MOD_1024), false);
});

test("test_a_staged_rate_limit_is_not_in_force", async () => {
  await serve({ readings: { defaults_bitrate: fieldReading(DSD256, { staged: DSD1024 }) } });
  assert.equal(grayed(MOD_512), true);
});

test("test_an_sdm_limit_with_the_pcm_chain_loaded_grays_nothing", async () => {
  await loadLists({ chain: "pcm", readings: { defaults_bitrate: DSD256 } });
  assert.equal(grayed("ASDM7EC 512+fs"), false);
});

test("test_an_sdm_limit_while_pcm_output_plays_grays_nothing", async () => {
  await serve({ readings: { defaults_bitrate: DSD256 } });
  engineStatus.value = { status: { state: "2", active_rate: "352800" }, metadata: { samplerate: "44100", bits: "16" } };
  assert.equal(grayed(MOD_512), false);
});

test("test_output_mode_on_auto_while_an_sdm_chain_runs_grays_as_sdm_does", async () => {
  await serve({ readings: { defaults_bitrate: DSD256, mode: "[source]" } });
  assert.equal(grayed(MOD_512), true);
});
