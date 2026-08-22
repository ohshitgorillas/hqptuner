// Behavioral suite for store/alerts/shaperfit.js's `shaperAlerts` — the rate/shaper
// conflicts the alert strip reports as rows.
//
// Two families, two severities, drawn by product decision rather than by
// anything in the manual (whose wording is "optimized for" throughout):
//
//   * an SDM modulator below its floor is CRITICAL — the engine produces no
//     output at all, so the row says the settings are invalid;
//   * a PCM dither below its floor is a WARNING — the engine plays, less well.
//
// Only the family that will actually produce output can conflict: the LOADED
// chain if there is one, else the configured mode, and `[source]` with nothing
// loaded means either family may be next, so both are reported.
//
// Floors sit BETWEEN tiers by design — the manual states MHz thresholds, not
// tiers — so a floor is read up to the tier above it: 40960000 lies between
// DSD512 and DSD1024, and a modulator carrying it is incompatible with DSD512.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — every input arrives through the exported signals carrying the
// shapes /api/state, /api/enumerations, /api/config and /api/metadata serve, and
// the staged edit rides the real REST path through a staging server.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/shaperfit-alerts.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { shaperAlerts } from "../../../hqptuner/static/store/alerts/shaperfit.js";
import { edit } from "../../../hqptuner/static/store/actions.js";
import { stagingWire, quiesce } from "../support/wire.js";
import {
  reset,
  DSD64,
  DSD512,
  DSD1024,
  PCM_1X,
  PCM_4X,
  PCM_8X,
  MODULATOR,
  OTHER_MODULATOR,
  DITHER,
  SELECTS,
} from "../support/shaperfit-fixtures.js";

/** @typedef {import("../../../hqptuner/static/store/health.js").Alert} Alert */

/** @returns {Alert[]} */
const alerts = () => shaperAlerts.value;
/** @returns {string[]} */
const kinds = () => alerts().map((a) => a.kind);
/** @returns {string[]} */
const sevs = () => alerts().map((a) => a.sev);

// The two alert identities. The sentences they carry are owner copy
// (docs/testing.md rule 9) and are nowhere in this file.
const SDM = "shaper-fit-sdm";
const PCM = "shaper-fit-pcm";

// The floors the two conflicts turn on: 40960000 between DSD512 and DSD1024,
// 352800 the 8x tier's 44.1k member.
const FLOORS = { sdm: { [MODULATOR]: 40960000 }, pcm: { [DITHER]: 352800 } };
// The second pair's: 6144000 is the DSD128 tier, 705600 the 16x tier's 44.1k
// member.
const FLOORS_2 = { sdm: { [OTHER_MODULATOR]: 6144000 }, pcm: { [DITHER]: 705600 } };

// Both families conflicting at once: SDM sits at DSD512 under a 40.96 MHz floor,
// PCM at 4x under an 8x floor.
const BOTH_CONFLICT = { sdmRate: DSD512, pcmRate: PCM_4X, floors: FLOORS };
// Neither does: SDM at DSD1024, PCM at 8x.
const NEITHER_CONFLICTS = { sdmRate: DSD1024, pcmRate: PCM_8X, floors: FLOORS };

// --- the modulator conflict ---------------------------------------------------

test("test_a_modulator_above_the_sdm_rate_raises_one_sdm_alert", async () => {
  await reset({ chain: "sdm", mode: "2", ...BOTH_CONFLICT });
  assert.deepEqual(kinds(), [SDM]);
});

test("test_a_second_modulator_at_a_second_floor_and_rate_raises_it_too", async () => {
  // ASDM5 is the OTHER member of the engine's modulator list, selected by the
  // list index `State` reports; its 6.144 MHz floor is the DSD128 tier, and the
  // engine is one tier below it. Nothing here is shared with the case above, so
  // a store that read one modulator's floor for every modulator fails.
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD64, floors: FLOORS_2, shaper: SELECTS.OTHER });
  assert.deepEqual(kinds(), [SDM]);
});

test("test_a_modulator_conflict_is_critical", async () => {
  await reset({ chain: "sdm", mode: "2", ...BOTH_CONFLICT });
  assert.deepEqual(sevs(), ["crit"]);
});

// --- the ditherer conflict ----------------------------------------------------

test("test_a_ditherer_above_the_pcm_rate_raises_one_pcm_alert", async () => {
  await reset({ chain: "pcm", mode: "1", ...BOTH_CONFLICT });
  assert.deepEqual(kinds(), [PCM]);
});

test("test_a_ditherer_at_a_second_floor_and_rate_raises_it_too", async () => {
  // The same ditherer, a floor three tiers higher and the base rate: neither
  // side of the comparison is the pair the case above states.
  await reset({ chain: "pcm", mode: "1", pcmRate: PCM_1X, floors: FLOORS_2 });
  assert.deepEqual(kinds(), [PCM]);
});

test("test_a_ditherer_conflict_is_a_warning", async () => {
  await reset({ chain: "pcm", mode: "1", ...BOTH_CONFLICT });
  assert.deepEqual(sevs(), ["warn"]);
});

// --- a shaper that fits contributes nothing -----------------------------------

test("test_a_modulator_the_sdm_rate_clears_raises_no_alert", async () => {
  // DSD1024 is 49152000, above the 40.96 MHz floor.
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, floors: FLOORS });
  assert.deepEqual(alerts(), []);
});

test("test_a_modulator_with_no_floor_raises_no_alert_at_the_lowest_dsd_rate", async () => {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD64, floors: { sdm: { [MODULATOR]: null } } });
  assert.deepEqual(alerts(), []);
});

test("test_a_ditherer_with_no_floor_raises_no_alert_at_the_lowest_pcm_rate", async () => {
  await reset({ chain: "pcm", mode: "1", pcmRate: "44100", floors: { pcm: { [DITHER]: null } } });
  assert.deepEqual(alerts(), []);
});

test("test_neither_family_conflicting_leaves_the_list_empty", async () => {
  await reset({ chain: null, mode: "0", ...NEITHER_CONFLICTS });
  assert.deepEqual(alerts(), []);
});

// --- only the family that will produce output speaks ---------------------------

test("test_a_pcm_conflict_raises_nothing_while_the_sdm_chain_is_loaded", async () => {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_4X, floors: FLOORS });
  assert.deepEqual(alerts(), []);
});

test("test_an_sdm_conflict_raises_nothing_while_the_pcm_chain_is_loaded", async () => {
  await reset({ chain: "pcm", mode: "1", sdmRate: DSD512, pcmRate: PCM_8X, floors: FLOORS });
  assert.deepEqual(alerts(), []);
});

test("test_with_no_chain_loaded_pcm_mode_reports_the_pcm_conflict_alone", async () => {
  await reset({ chain: null, mode: "1", ...BOTH_CONFLICT });
  assert.deepEqual(kinds(), [PCM]);
});

test("test_with_no_chain_loaded_sdm_mode_reports_the_sdm_conflict_alone", async () => {
  await reset({ chain: null, mode: "2", ...BOTH_CONFLICT });
  assert.deepEqual(kinds(), [SDM]);
});

test("test_with_no_chain_loaded_source_mode_reports_both_conflicts", async () => {
  // `[source]` follows the track, so either family may be the next one to
  // produce output and neither conflict can be ruled out.
  await reset({ chain: null, mode: "0", ...BOTH_CONFLICT });
  assert.deepEqual(kinds(), [SDM, PCM]);
});

test("test_both_families_conflicting_puts_the_critical_one_first", async () => {
  await reset({ chain: null, mode: "0", ...BOTH_CONFLICT });
  assert.deepEqual(sevs(), ["crit", "warn"]);
});

// --- staged edits count -------------------------------------------------------
// An alert that waited for Apply would tell the user about the conflict only
// after they had committed to it.

test("test_staging_a_rate_below_the_modulators_floor_raises_the_conflict_before_apply", async () => {
  // The engine is running SDM at DSD1024, which clears the floor: nothing is
  // wrong until the edit is staged, and the edit is only staged.
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_8X, floors: FLOORS });
  const w = stagingWire();
  await edit("sdm_rate", DSD512);
  await quiesce(w);
  assert.deepEqual(kinds(), [SDM]);
});
