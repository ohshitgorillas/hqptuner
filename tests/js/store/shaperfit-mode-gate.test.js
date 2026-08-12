// Which FAMILY `shaperAlerts` judges when the settings the user is holding
// disagree with the chain the engine happens to be running.
//
// The engine answers for the chain it has LOADED and nothing else
// (architecture §2, protocol.md §4), but the settings about to be applied are
// the ones the user is being warned about — so the family judged follows the
// EFFECTIVE output mode: a staged or previewed edit when there is one, the
// running configuration otherwise. `[source]` (auto) names no family at all
// (HQPlayer manual §4.4), so there the loaded chain is the only thing that
// does, and with nothing loaded either family may be next.
//
// Sibling suite shaperfit-alerts.test.js pins the conflicts themselves and
// their wording; this one pins only WHICH family gets judged. Severities are
// the existing product rule and stand in for the family here: an SDM modulator
// below its floor is `crit`, a PCM ditherer below its floor is `warn`. Row text
// is prose that may be reworded, so where a test looks at text at all it looks
// for the shaper's NAME and nothing else.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the scenario arrives through the exported signals carrying the
// /api/state, /api/enumerations, /api/config and /api/metadata shapes, the
// staged edit rides the real REST staging path, and a previewed preset arrives
// as the preview signals a preset click leaves behind.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/shaperfit-mode-gate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { shaperAlerts } from "../../../hqptuner/static/store/shaperfit.js";
import { previewConfig, pendingPreset } from "../../../hqptuner/static/store/signals.js";
import { edit } from "../../../hqptuner/static/store/actions.js";
import { stagingWire, quiesce } from "../support/wire.js";
import { PCM_SHAPERS, SDM_SHAPERS } from "../support/chainenums.js";
import { reset, DSD512, DSD1024, PCM_4X, PCM_8X, MODULATOR, DITHER, SELECTS } from "../support/shaperfit-fixtures.js";

/**
 * One alert row.
 *
 * @typedef {{ sev: string, text: string }} Alert
 */

/** @returns {Alert[]} */
const alerts = () => shaperAlerts.value;
/** @returns {string[]} */
const sevs = () => alerts().map((a) => a.sev);
/**
 * How many rows name the given shaper — the only thing this suite reads out of
 * the prose.
 *
 * @param {string} name
 * @returns {number}
 */
const naming = (name) => alerts().filter((a) => a.text.includes(name)).length;

// The floors the two conflicts turn on: 40.96 MHz sits between DSD512 and
// DSD1024, 352800 is the 8x tier's 44.1k member.
const FLOORS = { sdm: { [MODULATOR]: 40960000 }, pcm: { [DITHER]: 352800 } };

// Three rate pairs against those floors: only SDM conflicts, only PCM
// conflicts, and both at once.
const SDM_CONFLICTS = { sdmRate: DSD512, pcmRate: PCM_8X, floors: FLOORS };
const PCM_CONFLICTS = { sdmRate: DSD1024, pcmRate: PCM_4X, floors: FLOORS };
const BOTH_CONFLICT = { sdmRate: DSD512, pcmRate: PCM_4X, floors: FLOORS };

/**
 * A scenario at the wire with the preview signals cleared too — they are
 * module-level and outlive a test file, so a suite that stages preview state
 * must clear it itself or its cases pass alone and fail in sequence.
 *
 * @param {import("../support/shaperfit-fixtures.js").Scenario} scenario
 * @returns {Promise<void>}
 */
async function scene(scenario) {
  await reset(scenario);
  previewConfig.value = null;
  pendingPreset.value = null;
}

/**
 * Stage one schema key's edit through the real REST staging path.
 *
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
async function stageEdit(key, value) {
  const w = stagingWire();
  await edit(key, value);
  await quiesce(w);
}

/**
 * A previewed preset, as one click on a preset leaves the store: its field
 * values keyed by the daemon's own form-field names, and its name pending. The
 * rates and shapers restate the running configuration, so the preset moves the
 * output mode and nothing else.
 *
 * @param {string} mode
 * @param {{ sdmRate: string, pcmRate: string }} rates
 * @returns {void}
 */
function previewMode(mode, { sdmRate, pcmRate }) {
  previewConfig.value = {
    mode,
    defaults_bitrate: sdmRate,
    defaults_samplerate: pcmRate,
    modulator: SDM_SHAPERS[Number(SELECTS.MAIN)].value,
    dither: PCM_SHAPERS[Number(SELECTS.MAIN)].value,
  };
  pendingPreset.value = "Night";
}

// --- a staged mode overrides the loaded chain ---------------------------------

test("test_staged_sdm_mode_reports_the_sdm_conflict_while_the_engine_runs_pcm", async () => {
  await scene({ chain: "pcm", mode: "1", ...SDM_CONFLICTS });
  await stageEdit("output_mode", "sdm");
  assert.deepEqual(sevs(), ["crit"]);
});

test("test_the_row_a_staged_sdm_mode_raises_names_the_modulator", async () => {
  await scene({ chain: "pcm", mode: "1", ...SDM_CONFLICTS });
  await stageEdit("output_mode", "sdm");
  assert.equal(naming(MODULATOR), 1);
});

test("test_staged_sdm_mode_silences_the_pcm_conflict_the_running_engine_would_show", async () => {
  // The engine is on PCM below the ditherer's floor, but the staged mode says
  // the PCM chain is not the one that will run.
  await scene({ chain: "pcm", mode: "1", ...PCM_CONFLICTS });
  await stageEdit("output_mode", "sdm");
  assert.deepEqual(alerts(), []);
});

test("test_staged_pcm_mode_reports_the_pcm_conflict_while_the_engine_runs_sdm", async () => {
  await scene({ chain: "sdm", mode: "2", ...PCM_CONFLICTS });
  await stageEdit("output_mode", "pcm");
  assert.deepEqual(sevs(), ["warn"]);
});

test("test_the_row_a_staged_pcm_mode_raises_names_the_ditherer", async () => {
  await scene({ chain: "sdm", mode: "2", ...PCM_CONFLICTS });
  await stageEdit("output_mode", "pcm");
  assert.equal(naming(DITHER), 1);
});

test("test_staged_pcm_mode_silences_the_sdm_conflict_the_running_engine_would_show", async () => {
  await scene({ chain: "sdm", mode: "2", ...SDM_CONFLICTS });
  await stageEdit("output_mode", "pcm");
  assert.deepEqual(alerts(), []);
});

// --- auto names no family, so the loaded chain decides -------------------------

test("test_staged_auto_mode_reports_the_loaded_chains_conflict", async () => {
  await scene({ chain: "sdm", mode: "1", ...BOTH_CONFLICT });
  await stageEdit("output_mode", "auto");
  assert.deepEqual(sevs(), ["crit"]);
});

test("test_staged_auto_mode_silences_the_dormant_familys_conflict", async () => {
  await scene({ chain: "sdm", mode: "1", ...PCM_CONFLICTS });
  await stageEdit("output_mode", "auto");
  assert.deepEqual(alerts(), []);
});

test("test_staged_auto_mode_with_no_chain_loaded_reports_both_families", async () => {
  await scene({ chain: null, mode: "1", ...BOTH_CONFLICT });
  await stageEdit("output_mode", "auto");
  assert.deepEqual(sevs(), ["crit", "warn"]);
});

// --- a previewed preset stages the same way ------------------------------------

test("test_a_previewed_sdm_preset_reports_the_sdm_conflict_while_the_engine_runs_pcm", async () => {
  await scene({ chain: "pcm", mode: "1", ...SDM_CONFLICTS });
  previewMode("sdm", SDM_CONFLICTS);
  assert.deepEqual(sevs(), ["crit"]);
});

test("test_a_previewed_sdm_preset_silences_the_pcm_conflict", async () => {
  await scene({ chain: "pcm", mode: "1", ...PCM_CONFLICTS });
  previewMode("sdm", PCM_CONFLICTS);
  assert.deepEqual(alerts(), []);
});

test("test_a_previewed_pcm_preset_reports_the_pcm_conflict_while_the_engine_runs_sdm", async () => {
  await scene({ chain: "sdm", mode: "2", ...PCM_CONFLICTS });
  previewMode("pcm", PCM_CONFLICTS);
  assert.deepEqual(sevs(), ["warn"]);
});

test("test_a_previewed_pcm_preset_silences_the_sdm_conflict", async () => {
  await scene({ chain: "sdm", mode: "2", ...SDM_CONFLICTS });
  previewMode("pcm", SDM_CONFLICTS);
  assert.deepEqual(alerts(), []);
});

test("test_a_previewed_mode_and_a_staged_mode_choose_the_same_family", async () => {
  // The same mode by the two staging routes against the same scenario: whatever
  // the family choice is, it cannot depend on which route the mode arrived by.
  await scene({ chain: "pcm", mode: "1", ...BOTH_CONFLICT });
  await stageEdit("output_mode", "sdm");
  const staged = sevs();
  await scene({ chain: "pcm", mode: "1", ...BOTH_CONFLICT });
  previewMode("sdm", BOTH_CONFLICT);
  assert.deepEqual(sevs(), staged);
});

// --- nothing staged, nothing previewed: the engine is the answer ---------------

test("test_with_nothing_staged_the_running_sdm_engines_modulator_conflict_still_raises", async () => {
  await scene({ chain: "sdm", mode: "2", ...SDM_CONFLICTS });
  assert.deepEqual(sevs(), ["crit"]);
});
